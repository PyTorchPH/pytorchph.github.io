import type { ResumeProfile, ResumeProfileSection } from "@pytorch-ph/domain-protocol/career-evidence";
import type { ResumeTemplateId } from "@pytorch-ph/domain-protocol/resumes";
import { isValidPhoneNumber } from "libphonenumber-js/max";
import { stringify } from "yaml";

const schemaUrl = "https://raw.githubusercontent.com/rendercv/rendercv/refs/tags/v2.8/schema.json";

const renderCvTheme: Record<ResumeTemplateId, string> = {
  classic: "classic",
  moderncv: "moderncv",
  engineeringresumes: "engineeringresumes",
  engineeringclassic: "engineeringclassic",
  sb2nov: "sb2nov",
  harvard: "harvard",
  ember: "ember",
  ink: "ink",
  opal: "opal",
  modern: "moderncv",
  compact: "engineeringresumes",
};

export function renderCvYaml(profile: ResumeProfile, templateId: ResumeTemplateId) {
  const yaml = stringify(buildRenderCvDocument(profile, templateId), { lineWidth: 0 });
  const warnings = renderCvCompatibilityIssues(profile).map((issue) => `# RenderCV warning: ${issue}\n`).join("");
  return `# yaml-language-server: $schema=${schemaUrl}\n${warnings}${yaml}`;
}

export function renderCvCompatibilityIssues(profile: ResumeProfile) {
  return profile.phone && !isValidPhoneNumber(profile.phone)
    ? ["phone was omitted because RenderCV rejected its international number format"]
    : [];
}

export function buildRenderCvDocument(profile: ResumeProfile, templateId: ResumeTemplateId) {
  return {
    cv: {
      name: profile.fullName,
      headline: profile.headline,
      location: profile.location,
      email: profile.email,
      ...(profile.phone && isValidPhoneNumber(profile.phone) ? { phone: profile.phone } : {}),
      ...(profile.personalWebsite ? { website: profile.personalWebsite } : {}),
      social_networks: socialNetworks(profile),
      custom_connections: customConnections(profile),
      sections: renderCvSections(profile),
    },
    design: { theme: renderCvTheme[templateId] },
    locale: { language: "english" },
    settings: {
      current_date: "today",
      render_command: {
        output_folder: "rendercv_output",
        typst_path: "OUTPUT_FOLDER/NAME_IN_SNAKE_CASE_CV.typ",
        pdf_path: "OUTPUT_FOLDER/NAME_IN_SNAKE_CASE_CV.pdf",
        markdown_path: "OUTPUT_FOLDER/NAME_IN_SNAKE_CASE_CV.md",
        html_path: "OUTPUT_FOLDER/NAME_IN_SNAKE_CASE_CV.html",
        png_path: "OUTPUT_FOLDER/NAME_IN_SNAKE_CASE_CV.png",
        dont_generate_markdown: false,
        dont_generate_html: false,
        dont_generate_typst: false,
        dont_generate_pdf: false,
        dont_generate_png: false,
      },
      bold_keywords: [],
      pdf_title: `${profile.fullName} - CV`,
    },
  };
}

function renderCvSections(profile: ResumeProfile) {
  const summary = profile.summary ? { "Professional Summary": [profile.summary] } : {};
  if (profile.sections?.length) {
    return Object.assign(summary, ...profile.sections.map((section) => ({
      [section.title]: renderSection(section),
    })));
  }
  return {
    ...summary,
    ...(profile.experience.length ? {
      Experience: profile.experience.map((item) => ({
        company: item.organization,
        position: item.title,
        date: item.dateLabel,
        highlights: item.bullets,
      })),
    } : {}),
    ...(profile.projects.length ? {
      Projects: profile.projects.map((item) => ({
        name: item.title,
        summary: item.summary || undefined,
        highlights: item.bullets,
      })),
    } : {}),
    ...(profile.skillGroups.length ? {
      Skills: profile.skillGroups.map((group) => ({ label: group.name, details: group.items.join(", ") })),
    } : {}),
    ...(profile.education.length ? {
      Education: profile.education.map((item) => ({
        institution: item.school,
        area: item.program,
        date: item.dateLabel,
      })),
    } : {}),
  };
}

function renderSection(section: ResumeProfileSection) {
  if (section.id === "experience") return section.items.map((item) => ({
    company: item.subheading || "Independent",
    position: item.heading,
    ...(item.dateLabel ? { date: item.dateLabel } : {}),
    ...(item.summary ? { summary: item.summary } : {}),
    highlights: item.bullets,
  }));
  if (section.id === "education") return section.items.map((item) => ({
    institution: item.subheading || item.heading,
    area: item.subheading ? item.heading : "",
    ...(item.dateLabel ? { date: item.dateLabel } : {}),
    ...(item.summary ? { summary: item.summary } : {}),
    highlights: item.bullets,
  }));
  if (section.id === "project") return section.items.map((item) => ({
    name: linkedName(item.heading, item.links[0]?.url),
    ...(item.dateLabel ? { date: item.dateLabel } : {}),
    ...(item.summary ? { summary: item.summary } : {}),
    highlights: item.bullets,
  }));
  if (section.id === "skill_group") return section.items.map((item) => ({
    label: item.heading,
    details: item.inlineItems.join(", "),
  }));
  return section.items.map((item) => ({
    name: linkedName(item.heading, item.links[0]?.url),
    ...(item.subheading ? { location: item.subheading } : {}),
    ...(item.dateLabel ? { date: item.dateLabel } : {}),
    ...(item.summary ? { summary: item.summary } : {}),
    highlights: [...item.inlineItems, ...item.bullets],
  }));
}

function socialNetworks(profile: ResumeProfile) {
  const candidates = [
    ...(profile.linkedIn ? [{ label: "LinkedIn", url: profile.linkedIn }] : []),
    ...(profile.links || []),
  ];
  const supported = new Map([
    ["linkedin", "LinkedIn"], ["github", "GitHub"], ["gitlab", "GitLab"],
    ["orcid", "ORCID"], ["youtube", "YouTube"], ["x", "X"],
  ]);
  return candidates.flatMap((link) => {
    const network = supported.get(link.label.toLowerCase());
    const username = network ? usernameFromUrl(link.url) : undefined;
    return network && username ? [{ network, username }] : [];
  }).filter((item, index, items) => items.findIndex((candidate) =>
    candidate.network === item.network && candidate.username === item.username) === index);
}

function customConnections(profile: ResumeProfile) {
  const socialUrls = new Set([profile.linkedIn, profile.personalWebsite].filter(Boolean));
  return (profile.links || [])
    .filter((link) => !socialUrls.has(link.url) && !["linkedin", "github", "gitlab", "orcid", "youtube", "x"].includes(link.label.toLowerCase()))
    .map((link) => ({ fontawesome_icon: "link", placeholder: link.label, url: link.url }));
}

function usernameFromUrl(value: string) {
  try {
    return new URL(value).pathname.replace(/^\/+|\/+$/g, "") || undefined;
  } catch {
    return undefined;
  }
}

function linkedName(name: string, url?: string) {
  return url ? `[${name.replaceAll("]", "\\]")}](${url})` : name;
}
