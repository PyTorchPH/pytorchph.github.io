import { NextRequest, NextResponse } from "next/server";
import { createServerClient } from "@supabase/ssr";
import { authenticationProvider, audienceForHost, isOfficerOnlyPath, LOCAL_SESSION_COOKIE, memberDestination, portalOrigin, readLocalSession } from "@pytorch-ph/domain-server/identity";

const protectedPrefixes = ["/dashboard", "/career", "/jobs", "/connections", "/events", "/leaderboards", "/settings", "/trust", "/reports", "/membership", "/admin"];

function redirectToMember(request: NextRequest) {
  const destination = memberDestination(request.nextUrl.pathname);
  const url = new URL(destination, portalOrigin("member"));
  if (destination === request.nextUrl.pathname) url.search = request.nextUrl.search;
  return NextResponse.redirect(url);
}

export async function proxy(request: NextRequest) {
  const { pathname } = request.nextUrl;
  if (!protectedPrefixes.some((prefix) => pathname.startsWith(prefix))) return NextResponse.next();
  const audience = audienceForHost(request.headers.get("host"));
  if (authenticationProvider(request.headers.get("host")) === "local") {
    const account = readLocalSession(request.cookies.get(LOCAL_SESSION_COOKIE)?.value);
    if (account) {
      if (audience === "officer" && !account.isOfficer) return redirectToMember(request);
      if (audience === "member" && isOfficerOnlyPath(pathname)) return redirectToMember(request);
      return NextResponse.next();
    }
    const login = new URL("/login", request.url);
    login.searchParams.set("next", pathname);
    return NextResponse.redirect(login);
  }
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const supabaseKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  if (supabaseUrl && supabaseKey) {
    let response = NextResponse.next({ request });
    const supabase = createServerClient(supabaseUrl, supabaseKey, {
      cookies: {
        getAll: () => request.cookies.getAll(),
        setAll: (values) => {
          values.forEach(({ name, value }) => request.cookies.set(name, value));
          response = NextResponse.next({ request });
          values.forEach(({ name, value, options }) => response.cookies.set(name, value, options));
        },
      },
    });
    const { data } = await supabase.auth.getUser();
    if (data.user) {
      const { data: profile } = await supabase
        .from("member_profiles")
        .select("role,is_officer,membership_status,membership_paid")
        .eq("id", data.user.id)
        .maybeSingle();
      const isAdmin = profile?.role === "admin" || profile?.role === "super_admin";
      const isOfficer = Boolean(profile?.is_officer) || isAdmin;
      if (audience === "officer" && !isOfficer) return redirectToMember(request);
      if (audience === "member" && isOfficerOnlyPath(pathname)) return redirectToMember(request);
      if (audience === "member" && !isOfficer && pathname !== "/membership" && (profile?.membership_status !== "active" || profile?.membership_paid !== true)) {
        return NextResponse.redirect(new URL("/membership", request.url));
      }
      return response;
    }
  }
  const login = new URL("/login", request.url);
  login.searchParams.set("next", pathname);
  return NextResponse.redirect(login);
}

export const config = { matcher: ["/dashboard/:path*", "/career/:path*", "/jobs/:path*", "/connections/:path*", "/events/:path*", "/leaderboards/:path*", "/settings/:path*", "/trust/:path*", "/reports/:path*", "/membership/:path*", "/admin/:path*"] };
