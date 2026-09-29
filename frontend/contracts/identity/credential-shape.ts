import { z } from "zod";
import { leaderboardUsernameSchema } from "@pytorch-ph/domain-protocol/leaderboards";

export const emailSchema = z.string().trim().email("Enter a valid email address.");
export const loginSchema = z.object({ email: emailSchema, password: z.string().min(1, "Enter your password."), remember: z.boolean() });
export const registerSchema = z.object({ name: z.string().trim().min(2, "Enter your full name."), username: leaderboardUsernameSchema, email: emailSchema, password: z.string().min(8, "Password must have at least 8 characters."), confirm: z.string(), terms: z.boolean().refine(Boolean, "Accept the Terms and Privacy Notice to continue.") }).refine((value) => value.password === value.confirm, { message: "Passwords must match.", path: ["confirm"] });
export type LoginValues = z.infer<typeof loginSchema>;
export type RegisterValues = z.infer<typeof registerSchema>;
