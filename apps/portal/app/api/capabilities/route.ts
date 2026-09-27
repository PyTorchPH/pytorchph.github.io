import { access, constants } from "node:fs/promises";
import path from "node:path";
import { NextResponse } from "next/server";
import { buildCapabilityManifest } from "@pytorch-ph/domain-protocol/identity";
import { currentViewer } from "@pytorch-ph/domain-server/identity";
import { configuredProductProvider } from "@pytorch-ph/domain-server/career-evidence";

const backend = () => process.env.PYTORCH_PH_API_URL || "http://127.0.0.1:8000";

async function backendJson(route: string): Promise<Record<string, unknown>> {
  try {
    const response = await fetch(`${backend()}${route}`, {
      cache: "no-store",
      signal: AbortSignal.timeout(5_000),
    });
    if (!response.ok) return {};
    return await response.json() as Record<string, unknown>;
  } catch {
    return {};
  }
}

async function normalizedProfileReady() {
  const configured = process.env.JOB_MARKET_PROFILE_JSON?.trim();
  const artifactRoot = process.env.JOB_FINDER_ARTIFACT_DIR?.trim();
  const candidate = configured
    ? path.resolve(configured)
    : path.resolve(process.cwd(), "../..", artifactRoot || "out/application-resumes", "user_profile.json");
  try {
    await access(candidate, constants.R_OK);
    return true;
  } catch {
    return false;
  }
}

export async function GET() {
  const viewer = await currentViewer();
  const developmentOwner = viewer.localDevelopment && viewer.isOfficer;
  const localDemo = viewer.localDevelopment && configuredProductProvider() === "local";
  const [auth, onboarding, control, ai, profileReady] = await Promise.all([
    backendJson("/api/auth/status"),
    backendJson("/api/onboarding/state"),
    backendJson("/api/job-finder/control-state"),
    backendJson("/api/local-ai/status"),
    normalizedProfileReady(),
  ]);
  const identity = auth.identity as Record<string, { connected?: boolean }> | undefined;
  const social = auth.social as Record<string, { connected?: boolean }> | undefined;
  const sessions = control.sessions as { job_sites?: Record<string, { connected?: boolean }> } | undefined;
  const source = onboarding.source as { master_loaded?: boolean; resumes?: Array<{ artifact_ready?: boolean }> } | undefined;

  return NextResponse.json(buildCapabilityManifest({
    developmentOwner,
    authenticatedUser: Boolean(viewer.userId),
    audience: viewer.audience,
    role: viewer.role,
    isOfficer: viewer.isOfficer,
    canViewDiagnostics: viewer.canViewDiagnostics && viewer.audience === "officer",
    userTier: viewer.userTier,
    identityConnected: localDemo || Object.values(identity || {}).some((item) => item.connected),
    socialConnected: localDemo || Object.values(social || {}).some((item) => item.connected),
    jobSiteConnected: localDemo || Object.values(sessions?.job_sites || {}).some((item) => item.connected),
    evidenceReady: localDemo || Boolean(onboarding.ready && source?.master_loaded),
    normalizedProfileReady: localDemo || profileReady,
    resumeArtifactsReady: localDemo || Boolean(source?.resumes?.some((item) => item.artifact_ready)),
    aiConfigured: ai.configured === true,
    visualDemo: localDemo,
    localDemo,
  }), { headers: { "Cache-Control": "no-store" } });
}
