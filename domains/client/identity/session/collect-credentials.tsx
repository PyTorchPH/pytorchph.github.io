"use client";

import type { ComponentType, InputHTMLAttributes } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { AlertCircle, ArrowRight, AtSign, CheckCircle2, Lock, Mail, User as UserIcon } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { AuthShell } from "./render-shell";
import { createSupabaseBrowserClient } from "@pytorch-ph/domain-client/identity";
import { emailSchema, loginSchema, registerSchema, type LoginValues, type RegisterValues } from "@pytorch-ph/domain-protocol/identity";

const API_ORIGIN = (process.env.NEXT_PUBLIC_AUTH_API_ORIGIN ?? process.env.NEXT_PUBLIC_API_ORIGIN ?? "").replace(/\/$/, "");
const GOOGLE_CLIENT_ID = process.env.NEXT_PUBLIC_GOOGLE_CLIENT_ID ?? "";
const STATIC_DEMO = process.env.NEXT_PUBLIC_STATIC_DEMO === "1";

type GoogleIdentity = { accounts: { id: { initialize: (options: { client_id: string; callback: (response: { credential: string }) => void }) => void; renderButton: (element: HTMLElement, options: { theme: string; size: string }) => void } } };

function GoogleButton({ onConnected, onError }: { onConnected: () => void; onError: (message: string) => void }) {
  const button = useRef<HTMLDivElement>(null);
  const callbacks = useRef({ onConnected, onError });
  callbacks.current = { onConnected, onError };
  useEffect(() => {
    if (!GOOGLE_CLIENT_ID || !button.current) return;
    const script = document.createElement("script");
    script.src = "https://accounts.google.com/gsi/client";
    script.async = true;
    script.onload = () => {
      const google = (window as unknown as { google?: GoogleIdentity }).google;
      if (!google || !button.current) return;
      google.accounts.id.initialize({ client_id: GOOGLE_CLIENT_ID, callback: ({ credential }) => {
        void officialAuth("/auth/google", { id_token: credential }).then(() => callbacks.current.onConnected()).catch((reason: Error) => callbacks.current.onError(reason.message));
      } });
      google.accounts.id.renderButton(button.current, { theme: "outline", size: "large" });
    };
    document.head.appendChild(script);
    return () => { script.remove(); };
  }, []);
  return <div ref={button} />;
}

async function officialAuth(path: string, body: unknown) {
  const response = await fetch(`${API_ORIGIN}${path}`, { method: "POST", credentials: "include", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
  const result = await response.json();
  if (!response.ok) throw new Error(result.error || "Authentication failed.");
  return result;
}

type FieldProps = InputHTMLAttributes<HTMLInputElement> & {
  icon: ComponentType<{ size?: number; className?: string }>;
};

function Field({ icon: Icon, className: _className, ...props }: FieldProps) {
  return (
    <div className="relative">
      <Icon className="absolute left-3.5 top-1/2 -translate-y-1/2 text-muted" size={16} />
      <input
        className="focus-ring w-full rounded-lg border border-border bg-elevated py-3 pl-10 pr-4 text-ink placeholder:text-muted transition-all duration-300 focus:border-accent/50 focus:bg-elevated"
        {...props}
      />
    </div>
  );
}

export function LoginForm() {
  const router = useRouter();
  const [error, setError] = useState("");
  const form = useForm<LoginValues>({ defaultValues: { email: "", password: "", remember: false }, mode: "onChange", resolver: zodResolver(loginSchema) });
  const email = form.watch("email");

  async function enterAfterAuthentication() {
    if (API_ORIGIN) { router.replace("/dashboard"); router.refresh(); return; }
    const response = await fetch("/api/membership/status", { cache: "no-store" });
    if (!response.ok) { router.replace("/membership"); router.refresh(); return; }
    const membership = await response.json();
    router.replace(membership.canEnterMemberPortal ? "/dashboard" : "/membership");
    router.refresh();
  }

  return (
    <AuthShell sub="Sign in" title="Welcome back, builder.">
      <form
        className="space-y-4"
        onSubmit={form.handleSubmit(async ({ email: submittedEmail, password }) => {
          setError("");
          try {
            if (STATIC_DEMO && /^(demo\.member|demo\.officer)@example\.org$/i.test(submittedEmail) && password === "demo-password") {
              await fetch("/api/auth/login", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ email: submittedEmail }) });
              await enterAfterAuthentication();
              return;
            }
            if (API_ORIGIN) {
              await officialAuth("/auth/password", { email: submittedEmail, password });
              await enterAfterAuthentication();
              return;
            }
            const response = await fetch("/api/auth/login", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ email: submittedEmail, password, remember: form.getValues("remember") }) });
            const result = await response.json();
            if (!response.ok) throw new Error(result.error || "Sign in failed.");
            await enterAfterAuthentication();
          } catch (reason) {
            setError(reason instanceof Error ? reason.message : "Sign in failed.");
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
        {email && form.formState.errors.email && <p className="text-xs text-accent">{form.formState.errors.email.message}</p>}
        <Field
          autoComplete="current-password"
          icon={Lock}
          placeholder="Password"
          required
          type="password"
          {...form.register("password")}
        />
        {form.formState.errors.password && <p className="text-xs text-accent">{form.formState.errors.password.message}</p>}
        <div className="flex items-center justify-between text-sm">
          <label className="flex items-center gap-2 text-muted">
            <input className="accent-accent" type="checkbox" {...form.register("remember")} />
            Remember device
          </label>
          <a className="text-accent underline underline-offset-2" href="#">Forgot?</a>
        </div>
        {error && <div className="flex items-start gap-2 rounded-lg border border-accent/30 bg-accent/10 p-3 text-xs text-accent"><AlertCircle className="mt-0.5 flex-none" size={14} />{error}</div>}
        <button
          className="focus-ring flex w-full items-center justify-center gap-2 rounded-lg bg-gradient-to-r from-accent to-accent py-3 text-white shadow-lg shadow-accent/30 transition-all duration-300 hover:shadow-accent/50 disabled:cursor-not-allowed disabled:opacity-55"
          disabled={!form.formState.isValid || form.formState.isSubmitting}
          type="submit"
        >
          {form.formState.isSubmitting ? "Signing in…" : "Sign in"} <ArrowRight size={15} />
        </button>
      </form>
      <div className="my-5 flex items-center gap-3 text-xs text-muted"><span className="h-px flex-1 bg-elevated" />or<span className="h-px flex-1 bg-elevated" /></div>
      {API_ORIGIN ? (GOOGLE_CLIENT_ID ? <GoogleButton onConnected={() => { void enterAfterAuthentication(); }} onError={setError} /> : <p className="text-center text-sm text-muted">Google sign-in awaits configuration.</p>) : <button className="focus-ring flex w-full items-center justify-center gap-3 rounded-lg border border-border bg-elevated py-3 text-sm font-semibold text-ink hover:border-accent/40" onClick={async () => { setError(""); try { const supabase = createSupabaseBrowserClient(); const result = await supabase.auth.signInWithOAuth({ provider: "google", options: { redirectTo: `${window.location.origin}/auth/callback?next=/membership` } }); if (result.error) throw result.error; } catch (reason) { setError(reason instanceof Error ? reason.message : "Google sign in failed."); } }} type="button"><span className="flex h-5 w-5 items-center justify-center rounded-full bg-white font-bold text-[#4285f4]">G</span>Continue with Google</button>}
      <p className="mt-2 text-center text-xs leading-5 text-muted">Your Google email is used for authentication and membership checks. It is hidden from member-facing rankings by default.</p>
      <div className="mt-8 text-center text-sm text-muted">
        New to the community? <Link className="text-accent underline underline-offset-2" href="/register">Register</Link>
      </div>
    </AuthShell>
  );
}

export function RegisterForm() {
  const router = useRouter();
  const [error, setError] = useState("");
  const [verificationEmail, setVerificationEmail] = useState("");
  const [code, setCode] = useState("");
  const [verifying, setVerifying] = useState(false);
  const form = useForm<RegisterValues>({ defaultValues: { name: "", username: "", email: "", password: "", confirm: "", terms: false }, mode: "onChange", resolver: zodResolver(registerSchema) });
  const email = form.watch("email");
  const emailValid = emailSchema.safeParse(email).success;

  return (
    <AuthShell sub="Create account" title="Join PyTorch PH.">
      {verificationEmail && <form className="mb-6 space-y-4" onSubmit={async (event) => {
        event.preventDefault(); setError(""); setVerifying(true);
        try {
          await officialAuth("/auth/email/verify", { email: verificationEmail, code });
          router.replace("/dashboard"); router.refresh();
        } catch (reason) { setError(reason instanceof Error ? reason.message : "Verification failed."); }
        finally { setVerifying(false); }
      }}>
        <p className="text-sm text-muted">Enter the 8-digit code sent to {verificationEmail}. The code expires in 10 minutes.</p>
        <Field autoComplete="one-time-code" icon={Lock} inputMode="numeric" maxLength={8} pattern="[0-9]{8}" placeholder="Verification code" required value={code} onChange={(event) => setCode(event.target.value)} />
        <button className="focus-ring w-full rounded-lg bg-accent py-3 text-white disabled:opacity-55" disabled={verifying || code.length !== 8} type="submit">{verifying ? "Verifying…" : "Verify email and enter"}</button>
      </form>}
      <form
        className={`space-y-4 ${verificationEmail ? "hidden" : ""}`}
        onSubmit={form.handleSubmit(async ({ email: submittedEmail, name, username, password }) => {
          setError("");
          try {
            if (API_ORIGIN) {
              await officialAuth("/auth/email/start", { email: submittedEmail, name, username, password });
              setVerificationEmail(submittedEmail);
              return;
            }
            const supabase = createSupabaseBrowserClient();
            const result = await supabase.auth.signUp({ email: submittedEmail, password, options: { data: { display_name: name.trim(), leaderboard_username: username.trim() } } });
            if (result.error) throw result.error;
            if (result.data.session) {
              router.replace("/membership");
              router.refresh();
            } else {
              setError("Check your email to confirm the account before signing in.");
            }
          } catch (reason) {
            setError(reason instanceof Error ? reason.message : "Registration failed.");
          }
        })}
      >
        <Field autoComplete="name" icon={UserIcon} placeholder="Full name" required {...form.register("name")} />
        {form.formState.errors.name && <p className="text-xs text-accent">{form.formState.errors.name.message}</p>}
        <Field autoComplete="username" icon={AtSign} placeholder="Leaderboard username" required {...form.register("username")} />
        {form.formState.errors.username && <p className="text-xs text-accent">{form.formState.errors.username.message}</p>}
        <Field
          aria-invalid={Boolean(email && form.formState.errors.email)}
          autoComplete="email"
          icon={Mail}
          placeholder="you@example.com"
          required
          type="email"
          {...form.register("email", { onChange: () => setError("") })}
        />
        {email && (
          <div className={`flex items-center gap-2 font-mono text-xs ${emailValid ? "text-success" : "text-accent"}`}>
            {emailValid ? <CheckCircle2 size={12} /> : <AlertCircle size={12} />}
            {emailValid ? "Valid email format" : "Enter a valid email address"}
          </div>
        )}
        <Field
          autoComplete="new-password"
          icon={Lock}
          placeholder="Password"
          required
          type="password"
          {...form.register("password")}
        />
        <Field
          aria-invalid={Boolean(form.formState.errors.confirm)}
          autoComplete="new-password"
          icon={Lock}
          placeholder="Confirm password"
          required
          type="password"
          {...form.register("confirm")}
        />
        {form.formState.errors.confirm && <p className="text-xs text-accent">{form.formState.errors.confirm.message}</p>}
        {error && (
          <div className="flex items-start gap-2 rounded-lg border border-accent/30 bg-accent/10 p-3 text-xs text-accent">
            <AlertCircle className="mt-0.5 flex-none" size={14} />
            {error}
          </div>
        )}
        <label className="flex items-start gap-2 text-xs leading-5 text-muted">
          <input className="mt-0.5 accent-accent" required type="checkbox" {...form.register("terms")} />
          I agree to PyTorch Philippines community guidelines and consent to role-based visibility gates in this prototype.
        </label>
        <button
          className="focus-ring flex w-full items-center justify-center gap-2 rounded-lg bg-gradient-to-r from-accent to-accent py-3 text-white shadow-lg shadow-accent/30 transition-all duration-300 hover:shadow-accent/50 disabled:cursor-not-allowed disabled:opacity-55"
          disabled={!form.formState.isValid || form.formState.isSubmitting}
          type="submit"
        >
          {form.formState.isSubmitting ? "Creating account…" : "Create account"} <ArrowRight size={15} />
        </button>
      </form>
      {error && verificationEmail && <p className="mt-3 text-sm text-accent" role="alert">{error}</p>}
      <div className="mt-8 text-center text-sm text-muted">
        Already a member? <Link className="text-accent underline underline-offset-2" href="/login">Sign in</Link>
      </div>
    </AuthShell>
  );
}
