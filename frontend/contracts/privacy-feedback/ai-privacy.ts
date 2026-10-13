export type AiPurpose = "learning_recommendations" | "officer_assistant";
export type AiConsents = Record<AiPurpose, boolean> & { model_training: false };
export type AiProjectionTicket = { id: string; proof: string };
export type AiProjectionEnvelope = { ticket: AiProjectionTicket; projection: Record<string, unknown> };
export type AiFieldPolicy = { version: string; default: "deny"; fields: Record<string, { sensitive_data: boolean; transform: string }> };
