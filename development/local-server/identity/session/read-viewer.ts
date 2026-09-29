import type { PortalAudience, UserTier } from "@pytorch-ph/domain-protocol/identity";
import { portalAudience } from "@pytorch-ph/domain-server/identity";
import { authenticationProvider, LOCAL_SESSION_COOKIE, readLocalSession } from "@pytorch-ph/domain-server/identity";
import { cookies, headers } from "next/headers";

export type ProductRole = "member" | "premium" | "research" | "moderator" | "admin" | "super_admin";

export type ViewerContext = {
  userId: string | null;
  audience: PortalAudience;
  role: ProductRole | "anonymous";
  isOfficer: boolean;
  isAdmin: boolean;
  canViewDiagnostics: boolean;
  userTier: UserTier;
  localDevelopment: boolean;
};

function tierFor(role: ProductRole | "anonymous", isOfficer: boolean): UserTier {
  if (isOfficer || role === "admin" || role === "super_admin") return "admin";
  if (role === "premium" || role === "research") return "leaderboard";
  if (role === "moderator") return "active";
  return "general";
}

export async function currentViewer(): Promise<ViewerContext> {
  const audience = await portalAudience();
  const headerStore = await headers();
  if (authenticationProvider(headerStore.get("host")) === "local") {
    const cookieStore = await cookies();
    const account = readLocalSession(cookieStore.get(LOCAL_SESSION_COOKIE)?.value);
    if (!account) return anonymousViewer(audience);
    return {
      userId: account.userId, audience, role: account.role, isOfficer: account.isOfficer,
      isAdmin: account.role === "admin", canViewDiagnostics: account.isOfficer,
      userTier: tierFor(account.role, account.isOfficer), localDevelopment: true,
    };
  }
  // Deployed hosts authenticate through the Rust API (`/auth/me`); this server module holds no remote session.
  return anonymousViewer(audience);
}

function anonymousViewer(audience: PortalAudience): ViewerContext {
  return {
    userId: null,
    audience,
    role: "anonymous",
    isOfficer: false,
    isAdmin: false,
    canViewDiagnostics: false,
    userTier: "general",
    localDevelopment: false,
  };
}

export function viewerMayUseOfficerPortal(viewer: ViewerContext) {
  return viewer.audience === "officer" && viewer.isOfficer;
}
