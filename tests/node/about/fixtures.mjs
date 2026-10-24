export const JOHN_TOKEN = "a".repeat(64);
export const JANE_TOKEN = "b".repeat(64);
export const KAI_TOKEN = "c".repeat(64);
export const JOHN_NAME = "John Andrew Balbarosa";
export const API_ORIGIN = "https://api.pytorch.ph";

export function publishedLeadership() {
  return [
    {
      id: `cto-${JOHN_TOKEN}`, name: JOHN_NAME, title: "Chief Technology Officer",
      position: "cto", group: "core", department: "Technology", affiliation: "PyTorch Philippines",
      photoUrl: `/public/organization-photos/${JOHN_TOKEN}`,
    },
    {
      id: `campus_labs_lead-${JOHN_TOKEN}`, name: JOHN_NAME, title: "Campus Labs Lead",
      position: "campus_labs_lead", group: "department", department: "Education", affiliation: "Campus Labs",
      photoUrl: `/public/organization-photos/${JOHN_TOKEN}`,
    },
    {
      id: `ambassador-${JANE_TOKEN}`, name: "Jane Rivera", title: "Community Ambassador",
      position: "ambassador", group: "ambassador", department: "Community", affiliation: "A Test University",
      photoUrl: `/public/organization-photos/${JANE_TOKEN}`,
    },
    {
      id: `department_lead-${KAI_TOKEN}`, name: "Kai Santos", title: "Learning Coordinator",
      position: "department_lead", group: "department", department: "Learning", affiliation: "A Test Chapter",
      photoUrl: null,
    },
  ];
}

export function publishedDocument(leadership = publishedLeadership()) {
  return { leadership, chapters: [], events: [], articles: [] };
}

export const DETAILS_TEMPLATE = `
  <template id="community-people-details">
    <div data-person-name="John Andrew Balbarosa">
      <p data-person-bio>John Andrew Balbarosa created the community website and member portal for PyTorch Philippines.</p>
      <a data-person-link="GitHub" href="https://github.com/about-fixture">Source code</a>
      <a data-person-link="Unsafe" href="javascript:window.metadataExecuted=true">Unsafe link</a>
      <img src="/assets/images/maintainers/legacy-john.jpg" alt="Unpublished metadata portrait">
    </div>
    <div data-person-name="Kai Santos">
      <p data-person-bio>Helps people learn through community activities.</p>
      <img src="/assets/images/maintainers/legacy-kai.jpg" alt="Withheld metadata portrait">
    </div>
    <div data-person-name="Alpha Romer Coma">
      <p data-person-bio>Unpublished static member must stay inert.</p>
      <a data-person-link="GitHub" href="https://github.com/unpublished-fixture">GitHub</a>
    </div>
  </template>`;

export const PHOTO_SVG = '<svg xmlns="http://www.w3.org/2000/svg" width="160" height="160"><rect width="160" height="160" fill="#e9e7e5"/><circle cx="80" cy="60" r="28" fill="#8b939c"/><path d="M25 160v-20a55 55 0 0 1 110 0v20" fill="#8b939c"/></svg>';
