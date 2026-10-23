import { OfficialAuthError } from "../official-auth";

const unavailableMessages = new Set([
  "Email verification is unavailable",
  "Registration verification service is temporarily unavailable. Please try again later.",
]);
const validationMessages = new Set(["Invalid email address", "Invalid registration details"]);

export function registrationErrorMessage(reason: unknown): string {
  if (reason instanceof OfficialAuthError) return reason.message;
  if (!(reason instanceof Error)) return "Hindi natuloy ang registration. Subukan ulit.";
  if (unavailableMessages.has(reason.message)) return new OfficialAuthError("signup", 503).message;
  if (validationMessages.has(reason.message)) return new OfficialAuthError("signup", 400).message;
  if (reason.message === "Account creation is disabled in this static demo. Use an example account on the sign-in page.") {
    return "Hindi available ang registration sa read-only demo. Gamitin ang example account sa sign-in page.";
  }
  return "Hindi natuloy ang registration. Subukan ulit.";
}
