"use client";

// Sign in: restore an existing session, or sign in with email/password or Google.
// Module map (caller-first):
//   LoginForm                composes the session check, password form and Google sign-in
//   useSessionRestore        skips the form when the API already has a session for this browser
//   useEnterAfterSignIn      where a signed-in member goes next
//   PasswordSignInForm       email, password, remember device and the submit button
//   signInWithPassword       example accounts (static demo) or POST /auth/password
//   GoogleSignIn             the Google button, or why it is unavailable
//   OrDivider

import Link from "next/link";
import { useRouter } from "next/navigation";
import type { ReactNode } from "react";
import { ArrowRight, Lock, Mail } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { AuthShell } from "../render-shell";
import { loginSchema, type LoginValues } from "@pytorch-ph/domain-protocol/identity";
import { ErrorBanner, Field, FieldError } from "./field";
import { GoogleButton } from "./google-button";
import { hasAuthApi, hasGoogleSignIn, isStaticDemo, officialAuth, readSignedInViewer, type OfficialViewer } from "./official-auth";

type LoginFormProps = { demoControls?: ReactNode; onAuthenticated?: (role: string) => void; onExampleSignIn?: (email: string, password: string) => boolean };
type EnterAfterSignIn = (role?: string) => Promise<void>;

// Static demos pass onExampleSignIn to accept their fictional accounts; it returns true when it handled the sign in.
// Mental model: a live session skips the form entirely; otherwise either sign-in path ends in the same "enter" step.
export function LoginForm({ demoControls, onAuthenticated, onExampleSignIn }: LoginFormProps = {}) {
  const [error, setError] = useState("");
  const checkingSession = useSessionRestore(onAuthenticated);
  const enter = useEnterAfterSignIn(onAuthenticated);

  if (checkingSession) return <AuthShell sub="Sign in" title="Welcome back, builder."><p role="status" className="text-sm text-muted">Checking your session…</p></AuthShell>;

  return (
    <AuthShell sub="Sign in" title="Welcome back, builder.">
      <PasswordSignInForm enter={enter} error={error} onError={setError} onExampleSignIn={onExampleSignIn} />
      <OrDivider />
      <GoogleSignIn enter={enter} onError={setError} />
      <p className="mt-2 text-center text-xs leading-5 text-muted">Your Google email is used for authentication and membership checks. It is hidden from member-facing rankings by default.</p>
      <div className="mt-8 text-center text-sm text-muted">
        New to the community? <Link className="text-accent underline underline-offset-2" href="/register">Register</Link>
      </div>
      {demoControls}
    </AuthShell>
  );
}

// Mental model: ask the API who is signed in; a viewer means enter now, anything else shows the form.
function useSessionRestore(onAuthenticated?: (role: string) => void) {
  const router = useRouter();
  const [checkingSession, setCheckingSession] = useState(hasAuthApi());
  const onAuthenticatedRef = useRef(onAuthenticated);
  onAuthenticatedRef.current = onAuthenticated;
  useEffect(() => {
    if (!hasAuthApi()) return;
    const controller = new AbortController();
    let restored = false;
    void readSignedInViewer(controller.signal)
      .then(viewer => {
        if (!viewer || controller.signal.aborted) return;
        restored = true;
        if (onAuthenticatedRef.current) onAuthenticatedRef.current(viewer.role);
        else router.replace("/dashboard");
      })
      .catch(() => { /* Keep sign in available if the API cannot be reached. */ })
      .finally(() => { if (!controller.signal.aborted && !restored) setCheckingSession(false); });
    return () => controller.abort();
  }, [router]);
  return checkingSession;
}

// With the API, entering is the caller's choice or the dashboard; the local portal asks membership status first.
function useEnterAfterSignIn(onAuthenticated?: (role: string) => void): EnterAfterSignIn {
  const router = useRouter();
  return async (role?: string) => {
    if (hasAuthApi()) {
      if (onAuthenticated) onAuthenticated(role ?? "member");
      else { router.replace("/dashboard"); router.refresh(); }
      return;
    }
    const response = await fetch("/api/membership/status", { cache: "no-store" });
    if (!response.ok) { router.replace("/membership"); router.refresh(); return; }
    const membership = await response.json();
    router.replace(membership.canEnterMemberPortal ? "/dashboard" : "/membership");
    router.refresh();
  };
}

type PasswordSignInFormProps = { enter: EnterAfterSignIn; error: string; onError: (message: string) => void; onExampleSignIn?: LoginFormProps["onExampleSignIn"] };

function PasswordSignInForm({ enter, error, onError, onExampleSignIn }: PasswordSignInFormProps) {
  const form = useForm<LoginValues>({ defaultValues: { email: "", password: "", remember: false }, mode: "onChange", resolver: zodResolver(loginSchema) });
  const email = form.watch("email");
  return (
    <form
      className="space-y-4"
      onSubmit={form.handleSubmit(async ({ email: submittedEmail, password }) => {
        onError("");
        try {
          await signInWithPassword(submittedEmail, password, enter, onExampleSignIn);
        } catch (reason) {
          onError(reason instanceof Error ? reason.message : "Sign in failed.");
        }
      })}
    >
      <Field
        aria-invalid={Boolean(form.formState.errors.email)}
        autoComplete="email"
        icon={Mail}
        placeholder="you@example.com"
        required
        type="email"
        {...form.register("email")}
      />
      {email && <FieldError message={form.formState.errors.email?.message} />}
      <Field
        autoComplete="current-password"
        icon={Lock}
        placeholder="Password"
        required
        type="password"
        {...form.register("password")}
      />
      <FieldError message={form.formState.errors.password?.message} />
      <div className="flex items-center justify-between text-sm">
        <label className="flex items-center gap-2 text-muted">
          <input className="accent-accent" type="checkbox" {...form.register("remember")} />
          Remember device
        </label>
        <a className="text-accent underline underline-offset-2" href="#">Forgot?</a>
      </div>
      {error && <ErrorBanner message={error} />}
      <button
        className="focus-ring flex w-full items-center justify-center gap-2 rounded-lg bg-gradient-to-r from-accent to-accent py-3 text-white shadow-lg shadow-accent/30 transition-all duration-300 hover:shadow-accent/50 disabled:cursor-not-allowed disabled:opacity-55"
        disabled={!form.formState.isValid || form.formState.isSubmitting}
        type="submit"
      >
        {form.formState.isSubmitting ? "Signing in…" : "Sign in"} <ArrowRight size={15} />
      </button>
    </form>
  );
}

// Accounts live in the PyTorch PH API; without it only the example accounts can sign in.
async function signInWithPassword(email: string, password: string, enter: EnterAfterSignIn, onExampleSignIn?: LoginFormProps["onExampleSignIn"]) {
  if (!hasAuthApi() && onExampleSignIn?.(email, password)) return;
  if (hasAuthApi()) {
    const viewer = await officialAuth<OfficialViewer>("/auth/password", { email, password });
    await enter(viewer.role);
    return;
  }
  throw new Error(isStaticDemo() ? "Use an example account from the demo bar below." : "Sign in requires the PyTorch PH API.");
}

function GoogleSignIn({ enter, onError }: { enter: EnterAfterSignIn; onError: (message: string) => void }) {
  if (!hasAuthApi()) return <p className="text-center text-sm text-muted">Google sign-in requires the PyTorch PH API.</p>;
  if (!hasGoogleSignIn()) return <p className="text-center text-sm text-muted">Google sign-in awaits configuration.</p>;
  return <GoogleButton onConnected={viewer => { void enter(viewer.role); }} onError={onError} />;
}

function OrDivider() {
  return <div className="my-5 flex items-center gap-3 text-xs text-muted"><span className="h-px flex-1 bg-elevated" />or<span className="h-px flex-1 bg-elevated" /></div>;
}
