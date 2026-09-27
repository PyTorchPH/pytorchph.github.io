import { NextResponse } from "next/server";
import { authenticationProvider, createSupabaseServerClient, LOCAL_SESSION_COOKIE, revokeLocalSession } from "@pytorch-ph/domain-server/identity";

export async function POST(request: Request) {
  if (authenticationProvider(request.headers.get("host")) === "local") {
    const token = request.headers.get("cookie")?.split(";").map((part) => part.trim()).find((part) => part.startsWith(`${LOCAL_SESSION_COOKIE}=`))?.slice(LOCAL_SESSION_COOKIE.length + 1);
    revokeLocalSession(token ? decodeURIComponent(token) : undefined);
    const response = NextResponse.redirect(new URL("/login", request.url), { status: 303 });
    response.cookies.delete(LOCAL_SESSION_COOKIE);
    return response;
  }
  try {
    const client = await createSupabaseServerClient();
    await client.auth.signOut();
  } catch {
    // Supabase may be intentionally absent in the local provider mode.
  }
  return NextResponse.redirect(new URL("/login", request.url), { status: 303 });
}
