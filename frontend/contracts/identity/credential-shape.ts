import { z } from "zod";
import { leaderboardUsernameSchema } from "@pytorch-ph/domain-protocol/leaderboards";

// New passwords must meet every rule below; the Rust API enforces the same policy on sign-up.
export const MIN_PASSWORD_LENGTH = 8;

export const passwordRules = [
  { label: `At least ${MIN_PASSWORD_LENGTH} characters`, test: (value: string) => value.length >= MIN_PASSWORD_LENGTH },
  { label: "An uppercase letter", test: (value: string) => /[A-Z]/.test(value) },
  { label: "A lowercase letter", test: (value: string) => /[a-z]/.test(value) },
  { label: "A number", test: (value: string) => /\d/.test(value) },
  { label: "A symbol", test: (value: string) => /[^A-Za-z0-9\s]/.test(value) },
] as const;

export const newPasswordSchema = z.string().refine(
  (value) => passwordRules.every((rule) => rule.test(value)),
  "Use at least 8 characters with an uppercase letter, a lowercase letter, a number, and a symbol.",
);

export const emailSchema = z.string().trim().email("Enter a valid email address.");
export const loginSchema = z.object({ email: emailSchema, password: z.string().min(MIN_PASSWORD_LENGTH, `Passwords have at least ${MIN_PASSWORD_LENGTH} characters.`), remember: z.boolean() });
export const registerSchema = z.object({ name: z.string().trim().min(2, "Enter your full name."), username: leaderboardUsernameSchema, email: emailSchema, password: newPasswordSchema, confirm: z.string(), terms: z.boolean().refine(Boolean, "Accept the Terms and Privacy Notice to continue.") }).refine((value) => value.password === value.confirm, { message: "Passwords must match.", path: ["confirm"] });
export type LoginValues = z.infer<typeof loginSchema>;
export type RegisterValues = z.infer<typeof registerSchema>;
