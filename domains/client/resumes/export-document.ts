import type { ResumeProfile } from "@pytorch-ph/domain-protocol/career-evidence";
import { resumeTemplates, type ResumeTemplateId } from "@pytorch-ph/domain-protocol/resumes";

export { resumeTemplates, type ResumeTemplateId };

function escapeHtml(value: string) {
  return value.replace(/[&<>'"]/g, (character) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", "'": "&#39;", '"': "&quot;" })[character] || character);
}

function list(items: string[]) {
  return `<ul>${items.map((item) => `<li>${escapeHtml(item)}</li>`).join("")}</ul>`;
}

export function resumeHtml(profile: ResumeProfile, templateId: ResumeTemplateId) {
  const template = resumeTemplates.find((item) => item.id === templateId) || resumeTemplates[0];
  const compact = templateId === "compact";
  const sections = [
    `<section><h2>Professional summary</h2><p>${escapeHtml(profile.summary)}</p></section>`,
    `<section><h2>Experience</h2>${profile.experience.map((item) => `<article><h3>${escapeHtml(item.title)} · ${escapeHtml(item.organization)}</h3><p class="date">${escapeHtml(item.dateLabel)}</p>${list(item.bullets)}</article>`).join("")}</section>`,
    `<section><h2>Projects</h2>${profile.projects.map((item) => `<article><h3>${escapeHtml(item.title)}</h3><p>${escapeHtml(item.summary)}</p>${list(item.bullets)}</article>`).join("")}</section>`,
    `<section><h2>Skills</h2>${profile.skillGroups.map((group) => `<p><strong>${escapeHtml(group.name)}:</strong> ${group.items.map(escapeHtml).join(", ")}</p>`).join("")}</section>`,
    `<section><h2>Education</h2>${profile.education.map((item) => `<article><h3>${escapeHtml(item.school)}</h3><p>${escapeHtml(item.program)} · ${escapeHtml(item.dateLabel)}</p></article>`).join("")}</section>`,
  ].join("");
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><title>${escapeHtml(profile.fullName)} resume</title><style>
  @page{size:A4;margin:15mm}*{box-sizing:border-box}body{max-width:790px;margin:0 auto;color:#172033;font-family:Arial,Helvetica,sans-serif;font-size:${compact ? "10.2pt" : "10.8pt"};line-height:${compact ? "1.32" : "1.45"}}header{border-bottom:2px solid ${template.accent};padding-bottom:10px;margin-bottom:14px}h1{font-size:${compact ? "22pt" : "25pt"};margin:0;color:${template.accent}}header p{margin:4px 0}h2{font-size:11.5pt;text-transform:uppercase;letter-spacing:.08em;color:${template.accent};border-bottom:1px solid #cbd5e1;padding-bottom:3px;margin:${compact ? "11px" : "16px"} 0 7px}h3{font-size:10.8pt;margin:7px 0 2px}p{margin:3px 0}.date{color:#526176}ul{margin:4px 0 7px;padding-left:18px}li{margin:2px 0}@media print{body{max-width:none}}
  </style></head><body><header><h1>${escapeHtml(profile.fullName)}</h1><p><strong>${escapeHtml(profile.headline)}</strong></p><p>${escapeHtml(profile.email)} · ${escapeHtml(profile.location)}</p></header>${sections}</body></html>`;
}

function download(blob: Blob, filename: string) {
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = filename;
  anchor.click();
  setTimeout(() => URL.revokeObjectURL(url), 1_000);
}

function exportName(templateId: ResumeTemplateId, extension: string, demo = false) {
  return `${demo ? "DEMO-" : ""}${templateId}-resume.${extension}`;
}

export function downloadHtml(profile: ResumeProfile, templateId: ResumeTemplateId, demo = false) {
  download(new Blob([resumeHtml(profile, templateId)], { type: "text/html;charset=utf-8" }), exportName(templateId, "html", demo));
}

export async function downloadDocx(profile: ResumeProfile, templateId: ResumeTemplateId, demo = false) {
  const { Document, HeadingLevel, Packer, Paragraph, TextRun } = await import("docx");
  const children = [
    new Paragraph({ heading: HeadingLevel.TITLE, children: [new TextRun({ text: profile.fullName, bold: true })] }),
    new Paragraph({ children: [new TextRun({ text: profile.headline, bold: true })] }),
    new Paragraph(`${profile.email} · ${profile.location}`),
    new Paragraph({ heading: HeadingLevel.HEADING_1, text: "Professional summary" }),
    new Paragraph(profile.summary),
    new Paragraph({ heading: HeadingLevel.HEADING_1, text: "Experience" }),
    ...profile.experience.flatMap((item) => [new Paragraph({ heading: HeadingLevel.HEADING_2, text: `${item.title} · ${item.organization}` }), new Paragraph(item.dateLabel), ...item.bullets.map((bullet) => new Paragraph({ text: bullet, bullet: { level: 0 } }))]),
    new Paragraph({ heading: HeadingLevel.HEADING_1, text: "Projects" }),
    ...profile.projects.flatMap((item) => [new Paragraph({ heading: HeadingLevel.HEADING_2, text: item.title }), new Paragraph(item.summary), ...item.bullets.map((bullet) => new Paragraph({ text: bullet, bullet: { level: 0 } }))]),
    new Paragraph({ heading: HeadingLevel.HEADING_1, text: "Skills" }),
    ...profile.skillGroups.map((group) => new Paragraph({ children: [new TextRun({ text: `${group.name}: `, bold: true }), new TextRun(group.items.join(", "))] })),
    new Paragraph({ heading: HeadingLevel.HEADING_1, text: "Education" }),
    ...profile.education.map((item) => new Paragraph(`${item.school} · ${item.program} · ${item.dateLabel}`)),
  ];
  const document = new Document({ creator: "PyTorch PH Resume Studio", title: `${profile.fullName} resume`, sections: [{ children }] });
  download(await Packer.toBlob(document), exportName(templateId, "docx", demo));
}

export async function createResumePdf(profile: ResumeProfile, templateId: ResumeTemplateId) {
  const { jsPDF } = await import("jspdf");
  const template = resumeTemplates.find((item) => item.id === templateId) || resumeTemplates[0];
  const pdf = new jsPDF({ unit: "pt", format: "a4" });
  const margin = 44;
  const width = pdf.internal.pageSize.getWidth() - margin * 2;
  let y = 48;
  const ensure = (height: number) => { if (y + height > 790) { pdf.addPage(); y = 48; } };
  const line = (value: string, size = 10, bold = false, gap = 15) => {
    pdf.setFont("helvetica", bold ? "bold" : "normal"); pdf.setFontSize(size);
    const rows = pdf.splitTextToSize(value, width) as string[];
    ensure(rows.length * gap + 4); pdf.text(rows, margin, y); y += rows.length * gap;
  };
  pdf.setTextColor(template.accent);
  line(profile.fullName, 24, true, 25);
  pdf.setTextColor("#172033"); line(profile.headline, 11, true); line(`${profile.email} · ${profile.location}`, 9); y += 4;
  const heading = (value: string) => { y += 7; ensure(28); pdf.setTextColor(template.accent); line(value.toUpperCase(), 10, true, 14); pdf.setDrawColor(template.accent); pdf.line(margin, y - 9, margin + width, y - 9); pdf.setTextColor("#172033"); };
  const bullets = (values: string[]) => values.forEach((value) => line(`• ${value}`, 9.5, false, 13));
  heading("Professional summary"); line(profile.summary, 9.5, false, 13);
  heading("Experience"); profile.experience.forEach((item) => { line(`${item.title} · ${item.organization}`, 10, true, 14); line(item.dateLabel, 9); bullets(item.bullets); });
  heading("Projects"); profile.projects.forEach((item) => { line(item.title, 10, true, 14); line(item.summary, 9.5, false, 13); bullets(item.bullets); });
  heading("Skills"); profile.skillGroups.forEach((group) => line(`${group.name}: ${group.items.join(", ")}`, 9.5, false, 13));
  heading("Education"); profile.education.forEach((item) => line(`${item.school} · ${item.program} · ${item.dateLabel}`, 9.5, false, 13));
  return pdf;
}

export async function resumePdfPageCount(profile: ResumeProfile, templateId: ResumeTemplateId) {
  const pdf = await createResumePdf(profile, templateId);
  return pdf.getNumberOfPages();
}

export async function resumePdfBytes(profile: ResumeProfile, templateId: ResumeTemplateId) {
  const pdf = await createResumePdf(profile, templateId);
  return new Uint8Array(pdf.output("arraybuffer"));
}

export async function downloadPdf(profile: ResumeProfile, templateId: ResumeTemplateId, demo = false) {
  const pdf = await createResumePdf(profile, templateId);
  pdf.save(exportName(templateId, "pdf", demo));
}
