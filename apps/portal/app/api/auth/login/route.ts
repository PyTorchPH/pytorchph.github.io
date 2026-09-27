import { NextResponse } from "next/server";
import { authenticationProvider, authenticateLocalAccount, createLocalSession, createSupabaseServerClient, LOCAL_SESSION_COOKIE } from "@pytorch-ph/domain-server/identity";
import { loginSchema } from "@pytorch-ph/domain-protocol/identity";

export async function POST(request: Request) {
  const parsed = loginSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: "Invalid sign-in request." }, { status: 400 });
  const provider = authenticationProvider(request.headers.get("host"));
  if (provider === "supabase") {
    const client = await createSupabaseServerClient();
    const result = await client.auth.signInWithPassword({ email: parsed.data.email, password: parsed.data.password });
    if (result.error) return NextResponse.json({ error: result.error.message }, { status: 401 });
    return NextResponse.json({ provider });
  }
  const account = authenticateLocalAccount(parsed.data.email, parsed.data.password);
  if (!account) {
    console.warn(JSON.stringify({ event: "local_auth.session_rejected", outcome: "failure", reason: "invalid_credentials" }));
    return NextResponse.json({ error: "Invalid email or password." }, { status: 401 });
  }
  const session = createLocalSession(account.userId, parsed.data.remember);
  const response = NextResponse.json({ provider, role: account.role });
  response.cookies.set(LOCAL_SESSION_COOKIE, session.token, { httpOnly: true, sameSite: "lax", secure: false, path: "/", expires: session.expiresAt, maxAge: session.maxAge });
  console.info(JSON.stringify({ event: "local_auth.session_created", outcome: "success", userId: account.userId, role: account.role }));
  return response;
}
