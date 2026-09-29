import type { ResumeProfile } from "@pytorch-ph/domain-protocol/career-evidence";
import { resumeTemplates, type ResumeTemplateId } from "@pytorch-ph/domain-protocol/resumes";

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
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><title>${escapeHtml(profile.fullName)} resume</title><style>@page{size:A4;margin:15mm}body{font-family:Arial,sans-serif;color:#172033;font-size:${compact ? "10.2pt" : "10.8pt"}}h1,h2{color:${template.accent}}</style></head><body><header><h1>${escapeHtml(profile.fullName)}</h1><p>${escapeHtml(profile.headline)}</p></header>${sections}</body></html>`;
}

async function createResumePdf(profile: ResumeProfile, templateId: ResumeTemplateId) {
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
  const heading = (value: string) => { y += 7; ensure(28); pdf.setTextColor(template.accent); line(value.toUpperCase(), 10, true, 14); pdf.setTextColor("#172033"); };
  const bullets = (values: string[]) => values.forEach((value) => line(`• ${value}`, 9.5, false, 13));
  heading("Professional summary"); line(profile.summary, 9.5, false, 13);
  heading("Experience"); profile.experience.forEach((item) => { line(`${item.title} · ${item.organization}`, 10, true, 14); line(item.dateLabel, 9); bullets(item.bullets); });
  heading("Projects"); profile.projects.forEach((item) => { line(item.title, 10, true, 14); line(item.summary, 9.5, false, 13); bullets(item.bullets); });
  heading("Skills"); profile.skillGroups.forEach((group) => line(`${group.name}: ${group.items.join(", ")}`, 9.5, false, 13));
  heading("Education"); profile.education.forEach((item) => line(`${item.school} · ${item.program} · ${item.dateLabel}`, 9.5, false, 13));
  return pdf;
}

export async function resumePdfPageCount(profile: ResumeProfile, templateId: ResumeTemplateId) {
  return (await createResumePdf(profile, templateId)).getNumberOfPages();
}

export async function resumePdfBytes(profile: ResumeProfile, templateId: ResumeTemplateId) {
  return new Uint8Array((await createResumePdf(profile, templateId)).output("arraybuffer"));
}

export { resumeTemplates };
