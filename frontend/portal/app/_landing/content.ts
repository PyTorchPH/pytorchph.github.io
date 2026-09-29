// Landing page copy and sample figures (the page labels them as sample data).
// Module map:
//   faq                 questions and answers
//   testimonials        demo-persona quotes
//   heroStats           sample community counters
//   leaderboardSample   sample ranking rows
//   kanbanColumns       event workflow columns for the preview

export const faq = [
  {
    q: "Who can join PyTorch Philippines?",
    a: "Everyone interested in learning, researching, teaching, or building with PyTorch across the Philippines. Students and professionals are welcome; no school affiliation or school email is required."
  },
  {
    q: "How does the leaderboard work?",
    a: "The prototype models ranks from event participation, reviewed achievements, and public-safe activity signals. Private source data is never exposed on public tables."
  },
  {
    q: "What unlocks specialty analytics?",
    a: "General members unlock deeper analytics after at least one community event. Active, Elite, and Officer roles see progressively richer data."
  },
  {
    q: "Does AI post or approve actions automatically?",
    a: "No. AI can draft recommendations and summaries, but humans approve final event posts, awards, and generated artifacts."
  }
];

export const testimonials = [
  {
    name: "Camille Aquino",
    role: "Community learner · Demo persona",
    quote: "The community finally feels like an engineering org. Events, skills, and merit all point to one growth path."
  },
  {
    name: "Jared Sison",
    role: "Software developer · Demo persona",
    quote: "Seeing my PyTorch and MLOps bars move after every workshop made progress concrete."
  },
  {
    name: "Mika Domingo",
    role: "Community organizer · Demo persona",
    quote: "Officer planning became easier once events, approvals, and member readiness lived in one place."
  }
];

export const heroStats = [
  { value: 1284, suffix: "", label: "Members" },
  { value: 847, suffix: "", label: "Active weekly" },
  { value: 96, suffix: "%", label: "Retention" },
  { value: 42, suffix: "", label: "Events hosted" }
];

export const leaderboardSample = [
  { rank: 1, name: "Mika_7A82F", score: 982 },
  { rank: 2, name: "Member #18C2A", score: 941 },
  { rank: 3, name: "Daniel_P", score: 918 },
  { rank: 4, name: "Member #4D91B", score: 877 }
];

export const kanbanColumns = ["Plan", "Approve", "Live", "Done"];

export const sectionAnchors = ["features", "leaderboard", "voices", "faq"];
