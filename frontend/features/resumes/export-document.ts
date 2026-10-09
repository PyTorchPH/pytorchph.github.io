import type { ResumeProfile, ResumeProfileSection } from "@pytorch-ph/domain-protocol/career-evidence";
import { resumeTemplates, type ResumeTemplateId } from "@pytorch-ph/domain-protocol/resumes";

export { resumeTemplates, type ResumeTemplateId };

function escapeHtml(value: string) {
  return value.replace(/[&<>'"]/g, (character) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", "'": "&#39;", '"': "&quot;" })[character] || character);
}

function list(items: string[]) {
  return `<ul>${items.map((item) => `<li>${escapeHtml(item)}</li>`).join("")}</ul>`;
}

function contactItems(profile: ResumeProfile) {
  return [...new Set([
    profile.email,
    profile.phone,
    profile.location,
    profile.personalWebsite,
    profile.linkedIn,
    ...(profile.links || []).map((link) => link.url),
  ].filter((item): item is string => Boolean(item)))];
}

function genericSectionHtml(section: ResumeProfileSection) {
  const columns = section.layout === "columns" ? ` style="--columns:${section.columns || 2}"` : "";
  const className = section.layout ? ` class="section-items ${section.layout}"` : " class=\"section-items\"";
  const items = section.items.map((item) => {
    const heading = [item.heading, item.subheading].filter(Boolean).map((value) => escapeHtml(value!)).join(" · ");
    const links = item.links.length ? `<p class="links">${item.links.map((link) => `<a href="${escapeHtml(link.url)}">${escapeHtml(link.label)}</a>`).join(" · ")}</p>` : "";
    return `<article><div class="entry-heading"><h3>${heading}</h3>${item.dateLabel ? `<span class="date">${escapeHtml(item.dateLabel)}</span>` : ""}</div>${item.summary ? `<p>${escapeHtml(item.summary)}</p>` : ""}${item.inlineItems.length ? `<p>${item.inlineItems.map(escapeHtml).join(", ")}</p>` : ""}${item.bullets.length ? list(item.bullets) : ""}${links}</article>`;
  }).join("");
  return `<section><h2>${escapeHtml(section.title)}</h2><div${className}${columns}>${items}</div></section>`;
}

export function resumeHtml(profile: ResumeProfile, templateId: ResumeTemplateId) {
  const template = resumeTemplates.find((item) => item.id === templateId) || resumeTemplates[0];
  const compact = templateId === "compact";
  const dense = profile.presentation?.density === "dense";
  const legacySections = [
    profile.summary ? `<section><h2>Professional summary</h2><p>${escapeHtml(profile.summary)}</p></section>` : "",
    profile.experience.length ? `<section><h2>Experience</h2>${profile.experience.map((item) => `<article><h3>${escapeHtml(item.title)} · ${escapeHtml(item.organization)}</h3><p class="date">${escapeHtml(item.dateLabel)}</p>${list(item.bullets)}</article>`).join("")}</section>` : "",
    profile.projects.length ? `<section><h2>Projects</h2>${profile.projects.map((item) => `<article><h3>${escapeHtml(item.title)}</h3><p>${escapeHtml(item.summary)}</p>${list(item.bullets)}</article>`).join("")}</section>` : "",
    profile.skillGroups.length ? `<section><h2>Skills</h2>${profile.skillGroups.map((group) => `<p><strong>${escapeHtml(group.name)}:</strong> ${group.items.map(escapeHtml).join(", ")}</p>`).join("")}</section>` : "",
    profile.education.length ? `<section><h2>Education</h2>${profile.education.map((item) => `<article><h3>${escapeHtml(item.school)}</h3><p>${escapeHtml(item.program)} · ${escapeHtml(item.dateLabel)}</p></article>`).join("")}</section>` : "",
  ].filter(Boolean).join("");
  const sections = profile.sections?.length ? profile.sections.map(genericSectionHtml).join("") : legacySections;
  const contacts = contactItems(profile).map(escapeHtml).join(" · ");
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><title>${escapeHtml(profile.fullName)} resume</title><style>
  @page{size:A4;margin:${dense ? "8mm" : "15mm"}}*{box-sizing:border-box}body{max-width:790px;margin:0 auto;color:#172033;font-family:Arial,Helvetica,sans-serif;font-size:${dense ? "8.1pt" : compact ? "10.2pt" : "10.8pt"};line-height:${dense ? "1.18" : compact ? "1.32" : "1.45"}}header{border-bottom:2px solid ${template.accent};padding-bottom:${dense ? "5px" : "10px"};margin-bottom:${dense ? "6px" : "14px"}}h1{font-size:${dense ? "18pt" : compact ? "22pt" : "25pt"};margin:0;color:${template.accent}}header p{margin:${dense ? "1px" : "4px"} 0}h2{font-size:${dense ? "9pt" : "11.5pt"};text-transform:uppercase;letter-spacing:.08em;color:${template.accent};border-bottom:1px solid #cbd5e1;padding-bottom:2px;margin:${dense ? "6px" : compact ? "11px" : "16px"} 0 ${dense ? "3px" : "7px"}}h3{font-size:${dense ? "8.4pt" : "10.8pt"};margin:0}.entry-heading{display:flex;align-items:baseline;justify-content:space-between;gap:12px;margin-top:${dense ? "3px" : "7px"}}.date{color:#526176;white-space:nowrap}.section-items.columns{display:grid;grid-template-columns:repeat(var(--columns),minmax(0,1fr));gap:${dense ? "1px 12px" : "4px 20px"}}.section-items.compact_list article{break-inside:avoid}.links a{color:inherit}p{margin:${dense ? "1px" : "3px"} 0}ul{margin:${dense ? "1px" : "4px"} 0 ${dense ? "3px" : "7px"};padding-left:18px}li{margin:${dense ? "0" : "2px"} 0}@media print{body{max-width:none}}
  </style></head><body><header><h1>${escapeHtml(profile.fullName)}</h1><p><strong>${escapeHtml(profile.headline)}</strong></p><p>${contacts}</p></header>${sections}</body></html>`;
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
  const legacyChildren = [
    new Paragraph({ heading: HeadingLevel.TITLE, children: [new TextRun({ text: profile.fullName, bold: true })] }),
    new Paragraph({ children: [new TextRun({ text: profile.headline, bold: true })] }),
    new Paragraph(contactItems(profile).join(" · ")),
    ...(profile.summary ? [new Paragraph({ heading: HeadingLevel.HEADING_1, text: "Professional summary" }), new Paragraph(profile.summary)] : []),
    ...(profile.experience.length ? [new Paragraph({ heading: HeadingLevel.HEADING_1, text: "Experience" }), ...profile.experience.flatMap((item) => [new Paragraph({ heading: HeadingLevel.HEADING_2, text: `${item.title} · ${item.organization}` }), new Paragraph(item.dateLabel), ...item.bullets.map((bullet) => new Paragraph({ text: bullet, bullet: { level: 0 } }))])] : []),
    ...(profile.projects.length ? [new Paragraph({ heading: HeadingLevel.HEADING_1, text: "Projects" }), ...profile.projects.flatMap((item) => [new Paragraph({ heading: HeadingLevel.HEADING_2, text: item.title }), new Paragraph(item.summary), ...item.bullets.map((bullet) => new Paragraph({ text: bullet, bullet: { level: 0 } }))])] : []),
    ...(profile.skillGroups.length ? [new Paragraph({ heading: HeadingLevel.HEADING_1, text: "Skills" }), ...profile.skillGroups.map((group) => new Paragraph({ children: [new TextRun({ text: `${group.name}: `, bold: true }), new TextRun(group.items.join(", "))] }))] : []),
    ...(profile.education.length ? [new Paragraph({ heading: HeadingLevel.HEADING_1, text: "Education" }), ...profile.education.map((item) => new Paragraph(`${item.school} · ${item.program} · ${item.dateLabel}`))] : []),
  ];
  const genericChildren = profile.sections?.flatMap((section) => [
    new Paragraph({ heading: HeadingLevel.HEADING_1, text: section.title }),
    ...section.items.flatMap((item) => [
      new Paragraph({ heading: HeadingLevel.HEADING_2, text: [item.heading, item.subheading].filter(Boolean).join(" · ") }),
      ...(item.dateLabel ? [new Paragraph(item.dateLabel)] : []),
      ...(item.summary ? [new Paragraph(item.summary)] : []),
      ...(item.inlineItems.length ? [new Paragraph(item.inlineItems.join(", "))] : []),
      ...item.bullets.map((bullet) => new Paragraph({ text: bullet, bullet: { level: 0 } })),
      ...(item.links.length ? [new Paragraph(item.links.map((link) => `${link.label}: ${link.url}`).join(" · "))] : []),
    ]),
  ]);
  const children = profile.sections?.length
    ? [
      new Paragraph({ heading: HeadingLevel.TITLE, children: [new TextRun({ text: profile.fullName, bold: true })] }),
      new Paragraph({ children: [new TextRun({ text: profile.headline, bold: true })] }),
      new Paragraph(contactItems(profile).join(" · ")),
      ...(profile.summary ? [new Paragraph({ heading: HeadingLevel.HEADING_1, text: "Professional summary" }), new Paragraph(profile.summary)] : []),
      ...(genericChildren || []),
    ]
    : legacyChildren;
  const document = new Document({ creator: "PyTorch PH Resume Studio", title: `${profile.fullName} resume`, sections: [{ children }] });
  download(await Packer.toBlob(document), exportName(templateId, "docx", demo));
}

export async function createResumePdf(profile: ResumeProfile, templateId: ResumeTemplateId) {
  const { jsPDF } = await import("jspdf");
  const template = resumeTemplates.find((item) => item.id === templateId) || resumeTemplates[0];
  const pdf = new jsPDF({ unit: "pt", format: "a4" });
  const dense = profile.presentation?.density === "dense";
  const margin = dense ? 28 : 44;
  const width = pdf.internal.pageSize.getWidth() - margin * 2;
  let y = 48;
  const pageBottom = dense ? 814 : 790;
  const ensure = (height: number) => { if (y + height > pageBottom) { pdf.addPage(); y = dense ? 30 : 48; } };
  const line = (value: string, size = 10, bold = false, gap = 15) => {
    pdf.setFont("helvetica", bold ? "bold" : "normal"); pdf.setFontSize(size);
    const rows = pdf.splitTextToSize(value, width) as string[];
    ensure(rows.length * gap + 4); pdf.text(rows, margin, y); y += rows.length * gap;
  };
  pdf.setTextColor(template.accent);
  line(profile.fullName, dense ? 18 : 24, true, dense ? 19 : 25);
  pdf.setTextColor("#172033"); line(profile.headline, dense ? 8.5 : 11, true, dense ? 10 : 15); line(contactItems(profile).join(" · "), dense ? 7 : 9, false, dense ? 9 : 15); y += dense ? 1 : 4;
  const heading = (value: string) => { y += dense ? 3 : 7; ensure(dense ? 18 : 28); pdf.setTextColor(template.accent); line(value.toUpperCase(), dense ? 8 : 10, true, dense ? 9 : 14); pdf.setDrawColor(template.accent); pdf.line(margin, y - (dense ? 6 : 9), margin + width, y - (dense ? 6 : 9)); pdf.setTextColor("#172033"); };
  const bullets = (values: string[]) => values.forEach((value) => line(`• ${value}`, dense ? 7.2 : 9.5, false, dense ? 9 : 13));
  if (profile.summary) { heading("Professional summary"); line(profile.summary, dense ? 7.2 : 9.5, false, dense ? 9 : 13); }
  if (profile.sections?.length) {
    profile.sections.forEach((section) => {
      heading(section.title);
      section.items.forEach((item) => {
        line([item.heading, item.subheading].filter(Boolean).join(" · "), dense ? 7.6 : 10, true, dense ? 9 : 14);
        if (item.dateLabel) line(item.dateLabel, dense ? 7 : 9, false, dense ? 8 : 15);
        if (item.summary) line(item.summary, dense ? 7.2 : 9.5, false, dense ? 9 : 13);
        if (item.inlineItems.length) line(item.inlineItems.join(", "), dense ? 7.2 : 9.5, false, dense ? 9 : 13);
        bullets(item.bullets);
        if (item.links.length) line(item.links.map((link) => `${link.label}: ${link.url}`).join(" · "), dense ? 6.8 : 8.5, false, dense ? 8 : 12);
      });
    });
  } else {
    if (profile.experience.length) { heading("Experience"); profile.experience.forEach((item) => { line(`${item.title} · ${item.organization}`, 10, true, 14); line(item.dateLabel, 9); bullets(item.bullets); }); }
    if (profile.projects.length) { heading("Projects"); profile.projects.forEach((item) => { line(item.title, 10, true, 14); line(item.summary, 9.5, false, 13); bullets(item.bullets); }); }
    if (profile.skillGroups.length) { heading("Skills"); profile.skillGroups.forEach((group) => line(`${group.name}: ${group.items.join(", ")}`, 9.5, false, 13)); }
    if (profile.education.length) { heading("Education"); profile.education.forEach((item) => line(`${item.school} · ${item.program} · ${item.dateLabel}`, 9.5, false, 13)); }
  }
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
