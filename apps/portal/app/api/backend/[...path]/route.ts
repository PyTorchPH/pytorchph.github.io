import { NextRequest, NextResponse } from "next/server";
import { officerApiError } from "@pytorch-ph/domain-server/identity";
import { currentViewer } from "@pytorch-ph/domain-server/identity";

const endpoints: Record<string, string> = {
  "job-finder/control-state": "/api/job-finder/control-state",
  "job-finder/market-fit": "/api/job-finder/market-fit",
  "onboarding/state": "/api/onboarding/state",
  "resumes": "/api/resumes",
  "auth/status": "/api/auth/status",
  "local-ai/status": "/api/local-ai/status",
  "local-ai/providers": "/api/local-ai/providers",
  "local-ai/settings": "/api/local-ai/settings",
  "local-ai/test": "/api/local-ai/test",
  "local-ai/upskill": "/api/local-ai/upskill"
};

async function localAIError(endpoint: string) {
  if (!endpoint.startsWith("local-ai/")) return null;
  const viewer = await currentViewer();
  if (viewer.localDevelopment && viewer.userId) return null;
  return NextResponse.json({ error: "Local AI settings require an authenticated local session." }, { status: 403 });
}

export async function GET(_request: NextRequest, context: { params: Promise<{ path: string[] }> }) {
  const { path } = await context.params;
  const endpoint = path.join("/");
  const target = endpoints[endpoint];
  if (!target) return NextResponse.json({ error: "Unsupported service route." }, { status: 404 });
  const localDenied = await localAIError(endpoint);
  if (localDenied) return localDenied;
  if (endpoint.startsWith("job-finder/") || endpoint === "onboarding/state") {
    const denied = await officerApiError();
    if (denied) return denied;
  }
  const backend = process.env.PYTORCH_PH_API_URL || "http://127.0.0.1:8000";
  try {
    const response = await fetch(`${backend}${target}`, { cache: "no-store", signal: AbortSignal.timeout(8_000) });
    const payload = await response.json();
    return NextResponse.json(payload, { status: response.status });
  } catch {
    return NextResponse.json({ error: "Local FastAPI service is unavailable.", service: target }, { status: 503 });
  }
}

export async function POST(request: NextRequest, context: { params: Promise<{ path: string[] }> }) {
  const { path } = await context.params;
  const endpoint = path.join("/");
  const target = endpoints[endpoint];
  if (!target || !["local-ai/settings", "local-ai/test", "local-ai/upskill"].includes(endpoint)) {
    return NextResponse.json({ error: "Unsupported service route." }, { status: 404 });
  }
  const localDenied = await localAIError(endpoint);
  if (localDenied) return localDenied;
  const backend = process.env.PYTORCH_PH_API_URL || "http://127.0.0.1:8000";
  try {
    const body = await request.text();
    const response = await fetch(`${backend}${target}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: body || "{}",
      cache: "no-store",
      signal: AbortSignal.timeout(endpoint === "local-ai/test" || endpoint === "local-ai/upskill" ? 60_000 : 8_000),
    });
    const payload = await response.json();
    return NextResponse.json(payload, { status: response.status });
  } catch {
    return NextResponse.json({ error: "Local FastAPI service is unavailable.", service: target }, { status: 503 });
  }
}
