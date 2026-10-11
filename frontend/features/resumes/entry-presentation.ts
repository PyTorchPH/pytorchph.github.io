import type { ResumeProfileSection } from "@pytorch-ph/domain-protocol/career-evidence";

export type ResumeEntry = ResumeProfileSection["items"][number];
export type ResumeTextRun = { text: string; bold?: boolean; url?: string };

export function entryTitleRuns(item: ResumeEntry, project: boolean): ResumeTextRun[] {
  const title: ResumeTextRun = { text: item.heading, bold: true, url: item.links[0]?.url };
  return [
    title,
    ...(item.subheading ? [{ text: ` · ${item.subheading}`, bold: true }] : []),
    ...(project && item.summary ? [{ text: `, ${item.summary}`, bold: false }] : []),
  ];
}

export function awardParagraphRuns(section: ResumeProfileSection): ResumeTextRun[] {
  return section.items.flatMap((item, index) => {
    const details = [item.subheading, item.dateLabel, item.summary, ...item.inlineItems, ...item.bullets].filter(Boolean).join(" · ").replace(/[.;]$/, "");
    return [
      ...(index ? [{ text: "; " }] : []),
      ...entryTitleRuns(item, false).slice(0, 1),
      ...(details ? [{ text: ` — ${details}` }] : []),
      ...item.links.slice(1).flatMap((link) => [{ text: " · " }, { text: link.label, url: link.url }]),
    ];
  });
}
