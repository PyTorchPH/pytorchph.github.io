"use client";

import type { ComponentType, InputHTMLAttributes } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { AlertCircle, ArrowRight, AtSign, CheckCircle2, Lock, Mail, User as UserIcon } from "lucide-react";
import { useState } from "react";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { AuthShell } from "./render-shell";
import { createSupabaseBrowserClient } from "@pytorch-ph/domain-client/identity";
import { emailSchema, loginSchema, registerSchema, type LoginValues, type RegisterValues } from "@pytorch-ph/domain-protocol/identity";

type FieldProps = InputHTMLAttributes<HTMLInputElement> & {
  icon: ComponentType<{ size?: number; className?: string }>;
};

function Field({ icon: Icon, className: _className, ...props }: FieldProps) {
  return (
    <div className="relative">
      <Icon className="absolute left-3.5 top-1/2 -translate-y-1/2 text-[#FFF7ED]/30" size={16} />
      <input
        className="focus-ring w-full rounded-lg border border-white/10 bg-white/[0.04] py-3 pl-10 pr-4 text-[#FFF7ED] placeholder:text-[#FFF7ED]/30 transition-all duration-300 focus:border-[#e8590c]/50 focus:bg-white/[0.06]"
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
    const response = await fetch("/api/membership/status", { cache: "no-store" });
    if (!response.ok) { router.replace("/membership"); router.refresh(); return; }
    const membership = await response.json();
    router.replace(membership.canEnterMemberPortal ? "/dashboard" : "/membership");
    router.refresh();
  }

  return (
    <AuthShell sub="// sign in" title="Welcome back, builder.">
      <form
        className="space-y-4"
        onSubmit={form.handleSubmit(async ({ email: submittedEmail, password }) => {
          setError("");
          try {
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
        {email && form.formState.errors.email && <p className="text-xs text-[#e8590c]">{form.formState.errors.email.message}</p>}
        <Field
          autoComplete="current-password"
          icon={Lock}
          placeholder="Password"
          required
          type="password"
          {...form.register("password")}
        />
        {form.formState.errors.password && <p className="text-xs text-[#e8590c]">{form.formState.errors.password.message}</p>}
        <div className="flex items-center justify-between text-sm">
          <label className="flex items-center gap-2 text-[#FFF7ED]/60">
            <input className="accent-[#e8590c]" type="checkbox" {...form.register("remember")} />
            Remember device
          </label>
          <a className="text-[#e8590c] hover:underline" href="#">Forgot?</a>
        </div>
        {error && <div className="flex items-start gap-2 rounded-lg border border-[#e8590c]/30 bg-[#e8590c]/10 p-3 text-xs text-[#e8590c]"><AlertCircle className="mt-0.5 flex-none" size={14} />{error}</div>}
        <button
          className="focus-ring flex w-full items-center justify-center gap-2 rounded-lg bg-gradient-to-r from-[#e8590c] to-[#ff7a2d] py-3 text-white shadow-lg shadow-[#e8590c]/30 transition-all duration-300 hover:shadow-[#e8590c]/50 disabled:cursor-not-allowed disabled:opacity-55"
          disabled={!form.formState.isValid || form.formState.isSubmitting}
          type="submit"
        >
          {form.formState.isSubmitting ? "Signing in…" : "Sign in"} <ArrowRight size={15} />
        </button>
      </form>
      <div className="my-5 flex items-center gap-3 text-xs text-[#FFF7ED]/30"><span className="h-px flex-1 bg-white/10" />or<span className="h-px flex-1 bg-white/10" /></div>
      <button className="focus-ring flex w-full items-center justify-center gap-3 rounded-lg border border-white/10 bg-white/[0.04] py-3 text-sm font-semibold text-[#FFF7ED] hover:border-[#e8590c]/40" onClick={async () => { setError(""); try { const supabase = createSupabaseBrowserClient(); const result = await supabase.auth.signInWithOAuth({ provider: "google", options: { redirectTo: `${window.location.origin}/auth/callback?next=/membership` } }); if (result.error) throw result.error; } catch (reason) { setError(reason instanceof Error ? reason.message : "Google sign in failed."); } }} type="button"><span className="flex h-5 w-5 items-center justify-center rounded-full bg-white font-bold text-[#4285f4]">G</span>Continue with Google</button>
      <p className="mt-2 text-center text-xs leading-5 text-[#FFF7ED]/35">Your Google email is used for authentication and membership checks. It is hidden from member-facing rankings by default.</p>
      <div className="mt-8 text-center text-sm text-[#FFF7ED]/50">
        New to the community? <Link className="text-[#e8590c] hover:underline" href="/register">Register</Link>
      </div>
    </AuthShell>
  );
}

export function RegisterForm() {
  const router = useRouter();
  const [error, setError] = useState("");
  const form = useForm<RegisterValues>({ defaultValues: { name: "", username: "", email: "", password: "", confirm: "", terms: false }, mode: "onChange", resolver: zodResolver(registerSchema) });
  const email = form.watch("email");
  const emailValid = emailSchema.safeParse(email).success;

  return (
    <AuthShell sub="// create account" title="Join PyTorch PH.">
      <form
        className="space-y-4"
        onSubmit={form.handleSubmit(async ({ email: submittedEmail, name, username, password }) => {
          setError("");
          try {
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
        {form.formState.errors.name && <p className="text-xs text-[#e8590c]">{form.formState.errors.name.message}</p>}
        <Field autoComplete="username" icon={AtSign} placeholder="Leaderboard username" required {...form.register("username")} />
        {form.formState.errors.username && <p className="text-xs text-[#e8590c]">{form.formState.errors.username.message}</p>}
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
          <div className={`flex items-center gap-2 font-mono text-xs ${emailValid ? "text-green-400" : "text-[#e8590c]"}`}>
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
        {form.formState.errors.confirm && <p className="text-xs text-[#e8590c]">{form.formState.errors.confirm.message}</p>}
        {error && (
          <div className="flex items-start gap-2 rounded-lg border border-[#e8590c]/30 bg-[#e8590c]/10 p-3 text-xs text-[#e8590c]">
            <AlertCircle className="mt-0.5 flex-none" size={14} />
            {error}
          </div>
        )}
        <label className="flex items-start gap-2 text-xs leading-5 text-[#FFF7ED]/50">
          <input className="mt-0.5 accent-[#e8590c]" required type="checkbox" {...form.register("terms")} />
          I agree to PyTorch Philippines community guidelines and consent to role-based visibility gates in this prototype.
        </label>
        <button
          className="focus-ring flex w-full items-center justify-center gap-2 rounded-lg bg-gradient-to-r from-[#e8590c] to-[#ff7a2d] py-3 text-white shadow-lg shadow-[#e8590c]/30 transition-all duration-300 hover:shadow-[#e8590c]/50 disabled:cursor-not-allowed disabled:opacity-55"
          disabled={!form.formState.isValid || form.formState.isSubmitting}
          type="submit"
        >
          {form.formState.isSubmitting ? "Creating account…" : "Create account"} <ArrowRight size={15} />
        </button>
      </form>
      <div className="mt-8 text-center text-sm text-[#FFF7ED]/50">
        Already a member? <Link className="text-[#e8590c] hover:underline" href="/login">Sign in</Link>
      </div>
    </AuthShell>
  );
}
