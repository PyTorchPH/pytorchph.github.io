"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { ChevronLeft, ChevronRight, Download, ExternalLink, Maximize2, Minus, Plus, Rows3 } from "lucide-react";
import type { PDFDocumentProxy, PDFPageProxy, RenderTask } from "pdfjs-dist";
import { Button } from "@pytorch-ph/design-system/button";
import type { ResumeTemplateId } from "@pytorch-ph/domain-protocol/resumes";

type FitMode = "page" | "width" | "manual";

export function ResumePdfViewer({ template }: { template: ResumeTemplateId }) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const surfaceRef = useRef<HTMLDivElement>(null);
  const renderRef = useRef<RenderTask | null>(null);
  const [document, setDocument] = useState<PDFDocumentProxy | null>(null);
  const [page, setPage] = useState(1);
  const [fitMode, setFitMode] = useState<FitMode>("page");
  const [manualScale, setManualScale] = useState(1);
  const [surfaceSize, setSurfaceSize] = useState({ width: 0, height: 0 });
  const [shownScale, setShownScale] = useState(1);
  const [error, setError] = useState("");
  const pdfUrl = `/api/product/resume-preview?template=${template}&disposition=inline`;
  const downloadUrl = `/api/product/resume-preview?template=${template}&disposition=attachment`;

  useEffect(() => {
    let active = true;
    let loaded: PDFDocumentProxy | null = null;
    void import("pdfjs-dist").then(async (pdfjs) => {
      pdfjs.GlobalWorkerOptions.workerSrc = new URL("pdfjs-dist/build/pdf.worker.min.mjs", import.meta.url).toString();
      loaded = await pdfjs.getDocument({ url: pdfUrl, withCredentials: true }).promise;
      if (active) setDocument(loaded);
    }).catch((reason) => { if (active) setError(reason instanceof Error ? reason.message : "Could not load the PDF preview."); });
    return () => { active = false; void loaded?.cleanup(); };
  }, [pdfUrl]);

  useEffect(() => {
    const surface = surfaceRef.current;
    if (!surface) return;
    const observer = new ResizeObserver(([entry]) => setSurfaceSize({ width: entry.contentRect.width, height: entry.contentRect.height }));
    observer.observe(surface);
    return () => observer.disconnect();
  }, []);

  useEffect(() => {
    if (!document || !canvasRef.current || !surfaceSize.width || !surfaceSize.height) return;
    let active = true;
    let loadedPage: PDFPageProxy | null = null;
    void document.getPage(page).then((pdfPage) => {
      if (!active || !canvasRef.current) return;
      loadedPage = pdfPage;
      const base = pdfPage.getViewport({ scale: 1 });
      const widthScale = Math.max(0.25, (surfaceSize.width - 32) / base.width);
      const pageScale = Math.min(widthScale, Math.max(0.25, (surfaceSize.height - 32) / base.height));
      const scale = fitMode === "page" ? pageScale : fitMode === "width" ? widthScale : manualScale;
      setShownScale(scale);
      const viewport = pdfPage.getViewport({ scale });
      const outputScale = Math.min(window.devicePixelRatio || 1, 2);
      const canvas = canvasRef.current;
      canvas.width = Math.floor(viewport.width * outputScale);
      canvas.height = Math.floor(viewport.height * outputScale);
      canvas.style.width = `${Math.floor(viewport.width)}px`;
      canvas.style.height = `${Math.floor(viewport.height)}px`;
      const context = canvas.getContext("2d");
      if (!context) throw new Error("Canvas rendering is unavailable.");
      void renderRef.current?.cancel();
      renderRef.current = pdfPage.render({ canvas, canvasContext: context, transform: outputScale === 1 ? undefined : [outputScale, 0, 0, outputScale, 0, 0], viewport });
      return renderRef.current.promise;
    }).catch((reason) => {
      if (active && reason?.name !== "RenderingCancelledException") setError(reason instanceof Error ? reason.message : "Could not render this PDF page.");
    });
    return () => { active = false; renderRef.current?.cancel(); loadedPage?.cleanup(); };
  }, [document, fitMode, manualScale, page, surfaceSize]);

  const zoom = useCallback((delta: number) => {
    setManualScale((current) => Math.min(2, Math.max(0.25, (fitMode === "manual" ? current : shownScale) + delta)));
    setFitMode("manual");
  }, [fitMode, shownScale]);

  return <main className="flex h-dvh flex-col overflow-hidden bg-[#202124] text-white" data-fit-mode={fitMode}>
    <header className="flex min-h-14 flex-wrap items-center justify-between gap-2 border-b border-white/10 bg-[#2b2c2f] px-3 py-2" aria-label="PDF controls">
      <div className="flex items-center gap-1"><Button aria-label="Previous page" disabled={page <= 1} onClick={() => setPage((value) => value - 1)} size="icon" variant="ghost"><ChevronLeft /></Button><span className="min-w-20 text-center font-mono text-xs">{page} / {document?.numPages || "—"}</span><Button aria-label="Next page" disabled={!document || page >= document.numPages} onClick={() => setPage((value) => value + 1)} size="icon" variant="ghost"><ChevronRight /></Button></div>
      <div className="flex items-center gap-1 text-white/80"><Button aria-label="Zoom out" className="text-white/80" onClick={() => zoom(-0.1)} size="icon" variant="ghost"><Minus /></Button><span className="min-w-14 text-center font-mono text-xs">{Math.round(shownScale * 100)}%</span><Button aria-label="Zoom in" className="text-white/80" onClick={() => zoom(0.1)} size="icon" variant="ghost"><Plus /></Button><Button aria-label="Fit whole page" className={fitMode === "page" ? undefined : "text-white/80"} onClick={() => setFitMode("page")} size="sm" variant={fitMode === "page" ? "secondary" : "ghost"}><Maximize2 size={15} />Fit Page</Button><Button aria-label="Fit page width" className={fitMode === "width" ? undefined : "text-white/80"} onClick={() => setFitMode("width")} size="sm" variant={fitMode === "width" ? "secondary" : "ghost"}><Rows3 size={15} />Fit Width</Button></div>
      <div className="flex items-center gap-1"><Button asChild size="icon" variant="ghost"><a aria-label="Open PDF in new tab" href={pdfUrl} rel="noreferrer" target="_blank"><ExternalLink /></a></Button><Button asChild size="icon" variant="ghost"><a aria-label="Download PDF" download href={downloadUrl}><Download /></a></Button></div>
    </header>
    <div className="relative flex min-h-0 flex-1 items-start justify-center overflow-auto p-4" data-testid="pdf-surface" ref={surfaceRef}>
      {error ? <div className="m-auto max-w-md rounded-xl border border-red-400/30 bg-red-950/30 p-5 text-sm"><strong>PDF preview unavailable</strong><p className="mt-2 text-white/70">{error}</p><div className="mt-4 flex gap-2"><Button asChild size="sm" variant="secondary"><a href={pdfUrl} target="_blank">Open PDF</a></Button><Button asChild size="sm"><a download href={downloadUrl}>Download</a></Button></div></div> : !document ? <p className="m-auto text-sm text-white/60">Loading actual PDF…</p> : <canvas className="bg-white shadow-2xl" ref={canvasRef} />}
    </div>
  </main>;
}
