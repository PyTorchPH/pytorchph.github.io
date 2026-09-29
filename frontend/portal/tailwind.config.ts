import type { Config } from "tailwindcss";

const config: Config = {
  darkMode: ["class"],
  content: [
    "./app/**/*.{ts,tsx}",
    "./components/**/*.{ts,tsx}",
    "../../frontend/features/**/*.{ts,tsx}",
    "../design-system/src/**/*.{ts,tsx}"
  ],
  theme: {
    // Square corners match the pytorch.org card style; pills and avatars keep rounded-full.
    borderRadius: { none: "0", sm: "0", DEFAULT: "0", md: "0", lg: "0", xl: "0", "2xl": "0", "3xl": "0", full: "9999px" },
    extend: {
      colors: {
        canvas: "rgb(var(--canvas-rgb) / <alpha-value>)",
        surface: "rgb(var(--surface-rgb) / <alpha-value>)",
        elevated: "rgb(var(--elevated-rgb) / <alpha-value>)",
        chrome: "rgb(var(--chrome-rgb) / <alpha-value>)",
        onAccent: "rgb(var(--on-accent-rgb) / <alpha-value>)",
        border: "var(--border)",
        ink: "rgb(var(--ink-rgb) / <alpha-value>)",
        muted: "rgb(var(--muted-rgb) / <alpha-value>)",
        accent: "rgb(var(--accent-rgb) / <alpha-value>)",
        accentSoft: "rgb(var(--accent-soft-rgb) / <alpha-value>)",
        success: "rgb(var(--success-rgb) / <alpha-value>)",
        warning: "rgb(var(--warning-rgb) / <alpha-value>)",
        danger: "rgb(var(--danger-rgb) / <alpha-value>)",
        info: "rgb(var(--info-rgb) / <alpha-value>)"
      },
      fontFamily: {
        heading: ["var(--font-heading)", "var(--font-sans)", "sans-serif"],
        sans: ["var(--font-sans)", "ui-sans-serif", "system-ui", "sans-serif"],
        mono: ["var(--font-mono)", "ui-monospace", "SFMono-Regular", "monospace"]
      },
      boxShadow: {
        lift: "0 8px 20px rgb(0 0 0 / 0.08)",
        glow: "0 0 36px rgb(var(--accent-rgb) / 0.18)"
      }
    }
  },
  plugins: []
};

export default config;
