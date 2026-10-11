import { ExternalHyperlink, HeadingLevel, Paragraph, TabStopType, TextRun, type ParagraphChild } from "docx";
import type { ResumeProfileSection } from "@pytorch-ph/domain-protocol/career-evidence";
import { awardParagraphRuns, entryTitleRuns, type ResumeTextRun } from "./entry-presentation";

export function renderDocxSections(sections: ResumeProfileSection[], contentWidth: number) {
  return sections.flatMap((section) => [
    new Paragraph({ heading: HeadingLevel.HEADING_1, text: section.title }),
    ...(section.id === "award"
      ? [new Paragraph({ children: docxRuns(awardParagraphRuns(section)), spacing: { after: 80 } })]
      : section.items.flatMap((item) => [
        new Paragraph({
          heading: HeadingLevel.HEADING_2,
          children: [...docxRuns(entryTitleRuns(item, section.id === "project")), ...(item.dateLabel ? [new TextRun(`\t${item.dateLabel}`)] : [])],
          tabStops: [{ type: TabStopType.RIGHT, position: contentWidth }],
          spacing: { before: 100, after: 40 },
        }),
        ...(item.summary && section.id !== "project" ? [new Paragraph({ text: item.summary, spacing: { after: 40 } })] : []),
        ...(item.inlineItems.length ? [new Paragraph({ text: item.inlineItems.join(", "), spacing: { after: 40 } })] : []),
        ...item.bullets.map((bullet) => new Paragraph({ text: bullet, bullet: { level: 0 }, spacing: { after: 40 } })),
        ...(item.links.length > 1 ? [new Paragraph({ children: docxRuns(item.links.slice(1).flatMap((link, index) => [...(index ? [{ text: " · " }] : []), { text: link.label, url: link.url }])) })] : []),
      ])),
  ]);
}

function docxRuns(runs: ResumeTextRun[]): ParagraphChild[] {
  return runs.map((run) => {
    const text = new TextRun({ text: run.text, bold: run.bold, color: "172033", underline: { type: "none" } });
    return run.url ? new ExternalHyperlink({ link: run.url, children: [text] }) : text;
  });
}
