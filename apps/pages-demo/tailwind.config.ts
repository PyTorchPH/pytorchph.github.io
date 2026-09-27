import base from "../portal/tailwind.config";

export default {
  ...base,
  content: ["./app/**/*.{ts,tsx}", "../portal/app/page.tsx", "../../domains/client/public-site/**/*.{ts,tsx}", "../../domains/client/organization/**/*.{ts,tsx}", "../../domains/client/leaderboards/**/*.{ts,tsx}", "../../design-system/src/**/*.{ts,tsx}"],
};
