export type ContentRow = Record<string, string>;
export type Collection = "about" | "leadership" | "events" | "chapters" | "articles";
export type WebsiteDocument = Record<Collection, ContentRow[]> & { branding: ContentRow; contacts: ContentRow };
export type WebsiteDraft = { revision: number; publishedRevision: number; document: WebsiteDocument; approvals: number; requiredApprovals: number; canApprove: boolean };
export const collectionFields: Record<Collection, string[]> = {
  about: ["heading", "text"],
  leadership: ["id", "name", "title", "affiliation", "group", "department", "photoUrl"],
  events: ["id", "title", "eventType", "topic", "startsAt", "dateStatus", "scheduleLabel", "venue", "registrationUrl", "series", "modules", "photoUrl"],
  chapters: ["id", "university", "chapter", "island", "status", "photoUrl"],
  articles: ["id", "title", "kind", "publishedAt", "eventDate", "venue", "speakers", "topics", "highlights", "takeaways", "acknowledgments", "photoUrl"],
};
export const labels: Record<string, string> = { about:"About narrative", leadership:"Ambassadors, core team & departments", events:"Upcoming events & learning programs", chapters:"Campus Labs directory", articles:"News & past-event recaps", photoUrl:"Photo / image URL", startsAt:"Event sort date (YYYY-MM-DD or RFC3339)", scheduleLabel:"Public schedule label", series:"Learning series / tab", modules:"Modules or lesson coverage", dateStatus:"Date status", eventType:"Event / program type", registrationUrl:"Registration URL", publishedAt:"Article publication date", eventDate:"Recap event date", id:"Entry ID", group:"Leadership group", island:"Island group" };
export const options: Record<string, string[]> = { eventType:["training","program","workshop","hackathon","study-group","talk","meetup"], group:["ambassador","core","department"], dateStatus:["coming_soon","tentative","confirmed"], island:["Luzon","Visayas","Mindanao"], kind:["news","recap"] };
export function newEntry(collection: Collection): ContentRow {
  return Object.fromEntries(collectionFields[collection].map(key => [key, key==="id" ? crypto.randomUUID() : options[key]?.[0] ?? ""]));
}
