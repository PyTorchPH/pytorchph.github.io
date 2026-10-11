import type { jsPDF } from "jspdf";
import type { ResumeTextRun } from "./entry-presentation";

export function wrapPdfParagraph(
  pdf: jsPDF,
  runs: ResumeTextRun[],
  fontSize: number,
  width: number,
  firstLineReservation = 0,
) {
  const rows: ResumeTextRun[][] = [[]];
  let usedWidth = 0;
  const rowWidth = () => Math.max(fontSize, width - (rows.length === 1 ? firstLineReservation : 0));
  const nextRow = () => { rows.push([]); usedWidth = 0; };
  for (const run of runs) {
    pdf.setFont("helvetica", run.bold ? "bold" : "normal");
    pdf.setFontSize(fontSize);
    for (const token of run.text.split(/(\s+)/).filter(Boolean)) {
      if (!usedWidth && /^\s+$/.test(token)) continue;
      if (usedWidth && usedWidth + pdf.getTextWidth(token) > rowWidth()) {
        nextRow();
        if (/^\s+$/.test(token)) continue;
      }
      const pieces = pdf.splitTextToSize(token, rowWidth()) as string[];
      pieces.forEach((text, index) => {
        if (index) nextRow();
        rows[rows.length - 1].push({ ...run, text });
        usedWidth += pdf.getTextWidth(text);
      });
    }
  }
  return rows.filter((row) => row.length);
}

export function drawPdfParagraphRow(
  pdf: jsPDF,
  row: ResumeTextRun[],
  x: number,
  y: number,
  fontSize: number,
) {
  pdf.setFontSize(fontSize);
  for (const run of row) {
    pdf.setFont("helvetica", run.bold ? "bold" : "normal");
    if (run.url) pdf.textWithLink(run.text, x, y, { url: run.url });
    else pdf.text(run.text, x, y);
    x += pdf.getTextWidth(run.text);
  }
}
