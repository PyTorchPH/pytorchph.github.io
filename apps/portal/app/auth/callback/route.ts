import { NextRequest, NextResponse } from "next/server";
import { createSupabaseServerClient } from "@pytorch-ph/domain-server/identity";

export async function GET(request: NextRequest) {
  const code = request.nextUrl.searchParams.get("code");
  const next = request.nextUrl.searchParams.get("next") || "/membership";
  if (!code || !next.startsWith("/") || next.startsWith("//")) return NextResponse.redirect(new URL("/login?error=oauth", request.url));
  try {
    const client = await createSupabaseServerClient();
    const { error } = await client.auth.exchangeCodeForSession(code);
    if (error) throw error;
    return NextResponse.redirect(new URL(next, request.url));
  } catch {
    return NextResponse.redirect(new URL("/login?error=oauth", request.url));
  }
}
