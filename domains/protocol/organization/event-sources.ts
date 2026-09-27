// Event pages that AI can read automatically. Both publish structured, public event details.
export const automaticEventSources = [
  { name: "Luma", hosts: ["lu.ma", "luma.com"] },
  { name: "Meetup", hosts: ["meetup.com"] },
] as const;

export type AutomaticEventSource = (typeof automaticEventSources)[number]["name"];

// Returns the supported source for an event link, or null when details must be entered manually.
export function automaticEventSource(link: string): AutomaticEventSource | null {
  let host: string;
  try {
    const url = new URL(link);
    if (url.protocol !== "https:") return null;
    host = url.hostname.toLowerCase().replace(/^www\./, "");
  } catch {
    return null;
  }
  const match = automaticEventSources.find((source) => source.hosts.some((name) => host === name || host.endsWith(`.${name}`)));
  return match?.name ?? null;
}
