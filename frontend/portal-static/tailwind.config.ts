import base from "../portal/tailwind.config";

export default {
  ...base,
  content: ["./app/**/*.{ts,tsx}", "../portal/app/**/*.{ts,tsx}", "../portal/components/**/*.{ts,tsx}", "../../frontend/features/**/*.{ts,tsx}", "../design-system/src/**/*.{ts,tsx}"],
};
