// How verified evidence turns into points. The multipliers mirror the officer review rubric
// (the point rubric in backend/api/migrations and the review units in the local server's organization module).
export const rankingLevels = [
  { level: "participation", label: "Participation", multiplier: 1, example: "You joined a workshop, study group, or competition." },
  { level: "contributor", label: "Contributor", multiplier: 2, example: "You contributed work: a talk, a project, or a pull request." },
  { level: "finalist_lead", label: "Finalist or lead", multiplier: 3, example: "You reached the finals or led a team or session." },
  { level: "winner_top_award", label: "Winner or top award", multiplier: 4, example: "You won a competition or received a top award." },
] as const;

export const rankingSteps = [
  "Join a PyTorch Philippines competition. Results are easy to verify, and a win raises your rank the most.",
  "Add evidence of what you did in Career Evidence, manually or from a connected source.",
  "An officer verifies the evidence. Only verified points count toward your tier; pending points are shown separately.",
  "Stay active each week to keep your streak.",
] as const;

export const TIER_STEP_POINTS = 250;
