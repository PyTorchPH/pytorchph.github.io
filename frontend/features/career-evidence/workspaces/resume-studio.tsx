"use client";

// Resume Studio: pick a template, preview the actual PDF, check its page fit, and export.
// Module map (caller-first):
//   ResumeStudioView     template grid plus the preview dialog for the chosen template
//   usePdfPageCount      measures the generated PDF for the chosen template
//   useExportRunner      one export at a time, labelled while it runs
//   TemplateCard         one template with its thumbnail and density
//   TemplateThumbnail    a drawn miniature of the template layout
//   ResumeDialog         preview frame beside the fit and export panels
//   ResumePreview        the actual PDF in a sandboxed frame
//   PdfFitPanel, ExportPanel
//   pageFitText, pageFitTone  how the measured page count reads

import Link from "next/link";
import { useEffect, useState } from "react";
import { CheckCircle2, ChevronRight, Download, ExternalLink, FileText } from "lucide-react";
import { Badge } from "@pytorch-ph/design-system/badge";
import { Button } from "@pytorch-ph/design-system/button";
import { Card } from "@pytorch-ph/design-system/card";
import { AppDialog } from "@pytorch-ph/design-system/dialog";
import type { ProductViewData } from "@pytorch-ph/domain-protocol/career-evidence";
import {
  downloadDocx,
  downloadHtml,
  downloadPdf,
  resumePdfPageCount,
  resumeTemplates,
  type ResumeTemplateId,
} from "@pytorch-ph/domain-client/resumes";

type ResumeProfile = NonNullable<ProductViewData["resumeProfile"]>;
type ResumeTemplate = (typeof resumeTemplates)[number];

// Mental model: approved evidence becomes one normalized profile; every template, preview and export reads it.
export function ResumeStudioView({ data }: { data: ProductViewData }) {
  const [templateId, setTemplateId] = useState<ResumeTemplateId | null>(null);
  const profile = data.resumeProfile;
  const pageCount = usePdfPageCount(profile, templateId);
  const exporter = useExportRunner();
  const template = resumeTemplates.find((item) => item.id === templateId);
  const demo = data.meta.mode === "local_demo";
  if (!profile)
    return (
      <Card className="border-dashed bg-surface py-12 text-center">
        <FileText className="mx-auto text-muted" />
        <h2 className="mt-4 font-bold">No verified resume snapshot</h2>
        <p className="mt-2 text-sm text-muted">
          Approve evidence in Career Evidence before selecting a template.
        </p>
      </Card>
    );
  return (
    <>
      <section className="grid gap-4 md:grid-cols-3">
        {resumeTemplates.map((item, index) => <TemplateCard index={index} item={item} key={item.id} onOpen={setTemplateId} />)}
      </section>
      {templateId && template && (
        <ResumeDialog demo={demo} exporter={exporter} onClose={() => setTemplateId(null)} pageCount={pageCount} profile={profile} template={template} templateId={templateId} />
      )}
    </>
  );
}

// Mental model: re-measure whenever the template changes; null while measuring, 0 when measuring failed.
function usePdfPageCount(profile: ProductViewData["resumeProfile"], templateId: ResumeTemplateId | null) {
  const [pageCount, setPageCount] = useState<number | null>(null);
  useEffect(() => {
    let active = true;
    setPageCount(null);
    if (profile && templateId)
      void resumePdfPageCount(profile, templateId)
        .then((count) => {
          if (active) setPageCount(count);
        })
        .catch(() => {
          if (active) setPageCount(0);
        });
    return () => {
      active = false;
    };
  }, [profile, templateId]);
  return pageCount;
}

function useExportRunner() {
  const [busy, setBusy] = useState("");
  const run = async (label: string, action: () => void | Promise<void>) => {
    setBusy(label);
    try {
      await action();
    } finally {
      setBusy("");
    }
  };
  return { busy, run };
}

type ExportRunner = ReturnType<typeof useExportRunner>;

function TemplateCard({ item, index, onOpen }: { item: ResumeTemplate; index: number; onOpen: (id: ResumeTemplateId) => void }) {
  return (
    <button
      className="focus-ring group text-left"
      onClick={() => onOpen(item.id)}
    >
      <Card className="h-full bg-surface group-hover:border-accent/40">
        <TemplateThumbnail accent={item.accent} sectionCount={index === 2 ? 6 : 5} />
        <div className="mt-4 flex items-start justify-between gap-3">
          <div>
            <p className="font-bold">{item.name}</p>
            <p className="mt-1 text-sm leading-6 text-muted">
              {item.description}
            </p>
          </div>
          <Badge variant="success">ATS ready</Badge>
        </div>
        <p className="mt-4 flex items-center justify-between text-xs text-accent">
          <span>{item.density} density</span>
          <span className="flex items-center gap-1">
            Preview <ChevronRight size={14} />
          </span>
        </p>
      </Card>
    </button>
  );
}

function TemplateThumbnail({ accent, sectionCount }: { accent: string; sectionCount: number }) {
  return (
    <div className="aspect-[3/4] rounded-xl border border-border bg-white p-5 text-slate-800 shadow-sm">
      <div
        className="h-4 w-2/3 rounded"
        style={{ backgroundColor: accent }}
      />
      <div className="mt-2 h-1.5 w-1/2 rounded bg-slate-300" />
      <div className="mt-6 space-y-4">
        {Array.from({ length: sectionCount }).map(
          (_, lineIndex) => (
            <div key={lineIndex}>
              <div
                className="h-1.5 w-1/3 rounded"
                style={{ backgroundColor: accent }}
              />
              <div className="mt-2 h-1 w-full rounded bg-slate-200" />
              <div className="mt-1 h-1 w-5/6 rounded bg-slate-200" />
            </div>
          ),
        )}
      </div>
    </div>
  );
}

type ResumeDialogProps = {
  template: ResumeTemplate;
  templateId: ResumeTemplateId;
  profile: ResumeProfile;
  pageCount: number | null;
  exporter: ExportRunner;
  demo: boolean;
  onClose: () => void;
};

function ResumeDialog({ template, templateId, profile, pageCount, exporter, demo, onClose }: ResumeDialogProps) {
  return (
    <AppDialog
      className="sm:max-w-[min(96vw,1440px)]"
      description={`${template.description} The preview is the actual generated PDF and opens fitted to the whole page.`}
      onClose={onClose}
      title={`${template.name} resume`}
      wide
    >
      <div className="grid gap-5 xl:grid-cols-[minmax(0,1fr)_260px]">
        <ResumePreview templateId={templateId} />
        <aside className="space-y-4">
          <PdfFitPanel pageCount={pageCount} />
          <ExportPanel demo={demo} exporter={exporter} pageCount={pageCount} profile={profile} templateId={templateId} />
          <Link
          className="focus-ring flex items-center justify-between rounded-xl border border-accent/30 bg-accentSoft p-4 text-sm font-semibold text-accent"
            href="/career/evidence"
          >
            Edit source evidence <ExternalLink size={15} />
          </Link>
        </aside>
      </div>
    </AppDialog>
  );
}

function ResumePreview({ templateId }: { templateId: ResumeTemplateId }) {
  return (
    <iframe
      allow="fullscreen"
      className="h-[72dvh] min-h-[520px] w-full rounded-xl border border-border bg-elevated"
      data-testid="resume-pdf-frame"
      sandbox="allow-downloads allow-popups allow-same-origin allow-scripts"
      src={`/career/resume-viewer?template=${templateId}`}
      title={`${templateId} actual PDF resume preview`}
    />
  );
}

function PdfFitPanel({ pageCount }: { pageCount: number | null }) {
  return (
    <div className="rounded-xl border border-border bg-elevated p-4">
      <p className="text-xs uppercase tracking-widest text-muted">
        Measured PDF fit
      </p>
      <p
        className={`mt-3 flex items-center gap-2 font-semibold ${pageFitTone(pageCount)}`}
      >
        <CheckCircle2 size={17} />
        {pageFitText(pageCount)}
      </p>
      <p className="mt-2 text-xs leading-5 text-muted">
        Preview, page count, and PDF export share the same normalized
        data and generator.
      </p>
    </div>
  );
}

const pageFitTone = (pageCount: number | null) =>
  pageCount === 1 ? "text-success" : pageCount && pageCount > 1 ? "text-warning" : "text-muted";

const pageFitText = (pageCount: number | null) =>
  pageCount === null
    ? "Measuring generated PDF…"
    : pageCount === 0
      ? "Measurement unavailable"
      : `${pageCount}-page PDF generated`;

type ExportPanelProps = { profile: ResumeProfile; templateId: ResumeTemplateId; pageCount: number | null; exporter: ExportRunner; demo: boolean };

function ExportPanel({ profile, templateId, pageCount, exporter, demo }: ExportPanelProps) {
  const { busy, run } = exporter;
  return (
    <div className="rounded-xl border border-border p-4">
      <p className="font-semibold">Export this result</p>
      <div className="mt-4 grid gap-2">
        <Button
          disabled={Boolean(busy)}
          onClick={() =>
            run("HTML", () => downloadHtml(profile, templateId, demo))
          }
          variant="secondary"
        >
          <Download size={15} />
          HTML
        </Button>
        <Button
          disabled={Boolean(busy)}
          onClick={() =>
            run("DOCX", () => downloadDocx(profile, templateId, demo))
          }
          variant="secondary"
        >
          <Download size={15} />
          Editable DOCX
        </Button>
        <Button
          disabled={Boolean(busy) || pageCount === null}
          onClick={() =>
            run("PDF", () => downloadPdf(profile, templateId, demo))
          }
        >
          <Download size={15} />
          {busy || "PDF"}
        </Button>
      </div>
    </div>
  );
}
