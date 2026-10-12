import type { ResumeProfile, ResumeProfileSection } from "@pytorch-ph/domain-protocol/career-evidence";
import type { ResumeTemplateId } from "@pytorch-ph/domain-protocol/resumes";

const renderCvAssetRoot = `${process.env.NEXT_PUBLIC_BASE_PATH ?? ""}/vendor/rendercv/v2.8`;
const compilerAsset = `${process.env.NEXT_PUBLIC_BASE_PATH ?? ""}/vendor/typst/0.7.0/typst_ts_web_compiler_bg.wasm`;
const fontAwesomeFiles = ["lib.typ", "lib-gen-func.typ", "lib-gen-map.typ", "lib-impl.typ"];
const typstMarkupCharacters = new Set(["\\", "#", "$", "[", "]", "@", "*", "_", "<", ">"]);

let compiler: Promise<import("@myriaddreamin/typst.ts/contrib/snippet").TypstSnippet> | undefined;

export function renderCvTypst(profile: ResumeProfile, templateId: ResumeTemplateId) {
  const style = renderCvStyle(templateId);
  const connections = [
    profile.location,
    typstLink(`mailto:${profile.email}`, profile.email),
    ...(profile.phone ? [profile.phone] : []),
    ...(profile.personalWebsite ? [typstLink(profile.personalWebsite, profile.personalWebsite)] : []),
    ...(profile.links || []).map((link) => typstLink(link.url, link.label)),
  ];
  const sections = profile.sections?.length ? profile.sections : legacySections(profile);

  return `#import "/rendercv/lib.typ": *

#show: rendercv.with(
  name: ${typstString(profile.fullName)},
  page-size: "a4",
  page-top-margin: ${style.margin},
  page-bottom-margin: ${style.margin},
  page-left-margin: ${style.margin},
  page-right-margin: ${style.margin},
  page-show-footer: false,
  page-show-top-note: false,
  typography-font-family-body: "Source Sans 3",
  typography-font-family-name: "Source Sans 3",
  typography-font-family-headline: "Source Sans 3",
  typography-font-family-connections: "Source Sans 3",
  typography-font-family-section-titles: "Source Sans 3",
  typography-font-size-body: ${style.bodySize},
  typography-font-size-name: ${style.nameSize},
  typography-font-size-section-titles: ${style.sectionSize},
  typography-line-spacing: ${style.lineSpacing},
  typography-alignment: "left",
  colors-name: ${style.color},
  colors-headline: ${style.color},
  colors-section-titles: ${style.color},
  colors-links: ${style.color},
  section-titles-type: "${style.sectionType}",
  sections-space-between-regular-entries: ${style.entrySpacing},
  entries-highlights-space-between-items: ${style.bulletSpacing},
  header-alignment: ${style.headerAlignment},
  links-show-external-link-icon: false,
)

= ${typstContent(profile.fullName)}

#headline[${typstContent(profile.headline)}]

#connections(
${connections.map((connection) => `  [${connection}],`).join("\n")}
)
${profile.summary ? `\n== Professional Summary\n\n#content-area[${typstContent(profile.summary)}]\n` : ""}
${sections.map(renderSection).join("\n")}`;
}

export async function renderCvPdfBytes(profile: ResumeProfile, templateId: ResumeTemplateId) {
  const typst = await browserCompiler();
  const pdf = await typst.pdf({ mainContent: renderCvTypst(profile, templateId) });
  if (!pdf) throw new Error("Hindi nakagawa ng PDF ang Typst renderer.");
  return Uint8Array.from(pdf).buffer;
}

async function browserCompiler() {
  if (!compiler) compiler = createBrowserCompiler();
  return compiler;
}

async function createBrowserCompiler() {
  const { TypstSnippet } = await import("@myriaddreamin/typst.ts/contrib/snippet");
  const typst = new TypstSnippet();
  typst.setCompilerInitOptions({
    getModule: async () => responseBytes(await fetch(compilerAsset), "Typst compiler"),
  });
  typst.use(TypstSnippet.disableDefaultFontAssets());
  const [renderCvLibrary, font, ...fontAwesome] = await Promise.all([
    fetchText(`${renderCvAssetRoot}/lib.typ`, "RenderCV template"),
    fetchBytes(`${renderCvAssetRoot}/SourceSans3-Variable.ttf`, "Source Sans 3"),
    ...fontAwesomeFiles.map((file) => fetchText(`${renderCvAssetRoot}/fontawesome/${file}`, `Font Awesome ${file}`)),
  ]);
  typst.use(TypstSnippet.preloadFontData(font));
  await typst.addSource("/rendercv/lib.typ", renderCvLibrary.replace(
    '"@preview/fontawesome:0.6.0"',
    '"/rendercv/fontawesome/lib.typ"',
  ));
  await Promise.all(fontAwesomeFiles.map((file, index) =>
    typst.addSource(`/rendercv/fontawesome/${file}`, fontAwesome[index])));
  return typst;
}

async function fetchText(url: string, label: string) {
  const response = await fetch(url);
  if (!response.ok) throw new Error(`Hindi ma-load ang ${label} (${response.status}).`);
  return response.text();
}

async function fetchBytes(url: string, label: string) {
  return responseBytes(await fetch(url), label);
}

async function responseBytes(response: Response, label: string) {
  if (!response.ok) throw new Error(`Hindi ma-load ang ${label} (${response.status}).`);
  return new Uint8Array(await response.arrayBuffer());
}

function renderSection(section: ResumeProfileSection) {
  return `\n== ${typstContent(section.title)}\n\n${section.items.map((item) => {
    if (section.id === "skill_group") return `*${typstContent(item.heading)}:* ${typstContent(item.inlineItems.join(", "))}`;
    const heading = item.links[0]?.url ? typstLink(item.links[0].url, item.heading) : `*${typstContent(item.heading)}*`;
    const subheading = item.subheading ? `, ${typstContent(item.subheading)}` : "";
    const details = [
      ...(item.summary ? [`#summary[${typstContent(item.summary)}]`] : []),
      ...item.inlineItems.map((value) => `- ${typstContent(value)}`),
      ...item.bullets.map((value) => `- ${typstContent(value)}`),
    ];
    return `#regular-entry(\n  [${heading}${subheading}],\n  [${typstContent(item.dateLabel || "")}],${details.length ? `\n  main-column-second-row: [\n    ${details.join("\n    ")}\n  ],` : ""}\n)`;
  }).join("\n\n")}`;
}

function legacySections(profile: ResumeProfile): ResumeProfileSection[] {
  return [
    ...(profile.experience.length ? [{ id: "experience", title: "Experience", items: profile.experience.map((item, index) => ({ id: `experience-${index}`, heading: item.title, subheading: item.organization, dateLabel: item.dateLabel, bullets: item.bullets, inlineItems: [], links: [] })) }] : []),
    ...(profile.projects.length ? [{ id: "project", title: "Projects", items: profile.projects.map((item, index) => ({ id: `project-${index}`, heading: item.title, summary: item.summary, bullets: item.bullets, inlineItems: [], links: [] })) }] : []),
    ...(profile.skillGroups.length ? [{ id: "skill_group", title: "Skills", items: profile.skillGroups.map((item, index) => ({ id: `skill-${index}`, heading: item.name, bullets: [], inlineItems: item.items, links: [] })) }] : []),
    ...(profile.education.length ? [{ id: "education", title: "Education", items: profile.education.map((item, index) => ({ id: `education-${index}`, heading: item.program, subheading: item.school, dateLabel: item.dateLabel, bullets: [], inlineItems: [], links: [] })) }] : []),
  ];
}

function renderCvStyle(templateId: ResumeTemplateId) {
  if (templateId === "moderncv" || templateId === "modern") return { margin: "1.6cm", bodySize: "10pt", nameSize: "28pt", sectionSize: "1.35em", lineSpacing: "0.55em", color: "rgb(0, 79, 144)", sectionType: "moderncv", entrySpacing: "1em", bulletSpacing: "0.1cm", headerAlignment: "left" };
  if (templateId === "engineeringresumes" || templateId === "compact") return { margin: "1.25cm", bodySize: "9pt", nameSize: "24pt", sectionSize: "1.2em", lineSpacing: "0.4em", color: "rgb(0, 0, 0)", sectionType: "with_full_line", entrySpacing: "0.7em", bulletSpacing: "0.06cm", headerAlignment: "center" };
  if (templateId === "engineeringclassic") return { margin: "1.45cm", bodySize: "9.5pt", nameSize: "25pt", sectionSize: "1.25em", lineSpacing: "0.45em", color: "rgb(31, 41, 55)", sectionType: "with_full_line", entrySpacing: "0.8em", bulletSpacing: "0.08cm", headerAlignment: "left" };
  if (templateId === "sb2nov") return { margin: "1.2cm", bodySize: "9pt", nameSize: "23pt", sectionSize: "1.15em", lineSpacing: "0.38em", color: "rgb(0, 0, 0)", sectionType: "with_full_line", entrySpacing: "0.65em", bulletSpacing: "0.05cm", headerAlignment: "center" };
  if (templateId === "harvard") return { margin: "1.75cm", bodySize: "10pt", nameSize: "27pt", sectionSize: "1.3em", lineSpacing: "0.58em", color: "rgb(122, 0, 25)", sectionType: "with_full_line", entrySpacing: "1em", bulletSpacing: "0.1cm", headerAlignment: "center" };
  if (templateId === "ember") return { margin: "1.5cm", bodySize: "9.7pt", nameSize: "27pt", sectionSize: "1.28em", lineSpacing: "0.5em", color: "rgb(180, 83, 9)", sectionType: "with_full_line", entrySpacing: "0.85em", bulletSpacing: "0.08cm", headerAlignment: "left" };
  if (templateId === "ink") return { margin: "1.55cm", bodySize: "9.8pt", nameSize: "26pt", sectionSize: "1.25em", lineSpacing: "0.5em", color: "rgb(17, 17, 17)", sectionType: "with_full_line", entrySpacing: "0.9em", bulletSpacing: "0.08cm", headerAlignment: "left" };
  if (templateId === "opal") return { margin: "1.7cm", bodySize: "10pt", nameSize: "29pt", sectionSize: "1.35em", lineSpacing: "0.58em", color: "rgb(15, 118, 110)", sectionType: "with_full_line", entrySpacing: "1.05em", bulletSpacing: "0.1cm", headerAlignment: "center" };
  return { margin: "1.8cm", bodySize: "10pt", nameSize: "30pt", sectionSize: "1.4em", lineSpacing: "0.6em", color: "rgb(0, 79, 144)", sectionType: "with_full_line", entrySpacing: "1.2em", bulletSpacing: "0.12cm", headerAlignment: "center" };
}

function typstString(value: string) {
  return JSON.stringify(value);
}

function typstLink(url: string, label: string) {
  return `#link(${typstString(url)})[${typstContent(label)}]`;
}

function typstContent(value: string) {
  return [...value].map((character) =>
    typstMarkupCharacters.has(character) ? `\\${character}` : character === "\n" ? " " : character
  ).join("");
}
