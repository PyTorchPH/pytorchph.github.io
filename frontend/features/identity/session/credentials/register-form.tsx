"use client";

// Create an account: registration details first, then the emailed verification code.
// Module map (caller-first):
//   RegisterForm            the verification step (after sign-up) above the registration form
//   VerificationCodeForm    8-digit code → POST /auth/email/verify → /onboarding (Complete your profile)
//   RegistrationForm        name, username, email, passwords and Terms/Privacy consent
//   ├─ PasswordRequirements  live checklist of the password rules
//   └─ TermsConsent         required checkbox; Terms / Privacy Notice links open modals (identity/legal)
//   startEmailSignup        POST /auth/email/start (or explains why sign-up is unavailable)
//   EmailFormatHint         live "valid email" feedback
//   isCompleteCode          small predicate

import Link from "next/link";
import { useRouter } from "next/navigation";
import { AlertCircle, ArrowRight, AtSign, CheckCircle2, Lock, Mail, User as UserIcon } from "lucide-react";
import { useEffect, useState } from "react";
import { useForm, type UseFormRegisterReturn } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { LegalLink } from "../../legal";
import { AuthShell } from "../render-shell";
import { emailSchema, passwordRules, registerSchema, type RegisterValues } from "@pytorch-ph/domain-protocol/identity";
import { ErrorBanner, Field, FieldError } from "./field";
import { hasAuthApi, isStaticDemo, officialAuth } from "./official-auth";

const CODE_LENGTH = 8;

// Mental model: registering sends a code; once a code is pending, the registration form hides and the code form takes over.
export function RegisterForm() {
  const [error, setError] = useState("");
  const [verificationEmail, setVerificationEmail] = useState("");
  return (
    <AuthShell sub="Create account" title="Join PyTorch PH.">
      {verificationEmail && <VerificationCodeForm email={verificationEmail} onError={setError} />}
      <RegistrationForm error={error} hidden={Boolean(verificationEmail)} onError={setError} onCodeSent={setVerificationEmail} />
      {error && verificationEmail && <p className="mt-3 text-sm text-accent" role="alert">{error}</p>}
      {!verificationEmail && <Link className="focus-ring mt-4 flex w-full items-center justify-center gap-2 rounded-lg border border-border py-3 text-sm font-semibold text-ink hover:border-accent hover:text-accent" href="/login">Continue with Google</Link>}
      <div className="mt-8 text-center text-sm text-muted">
        Already a member? <Link className="text-accent underline underline-offset-2" href="/login">Sign in</Link>
      </div>
    </AuthShell>
  );
}

function VerificationCodeForm({ email, onError }: { email: string; onError: (message: string) => void }) {
  const router = useRouter();
  const [code, setCode] = useState("");
  const [verifying, setVerifying] = useState(false);
  return <form className="mb-6 space-y-4" onSubmit={async (event) => {
    event.preventDefault(); onError(""); setVerifying(true);
    try {
      await officialAuth("/auth/email/verify", { email, code });
      router.replace("/onboarding/"); router.refresh();
    } catch (reason) { onError(reason instanceof Error ? reason.message : "Verification failed."); }
    finally { setVerifying(false); }
  }}>
    <p className="text-sm text-muted">Enter the 8-digit code sent to {email}. The code expires in 10 minutes.</p>
    <Field autoComplete="one-time-code" icon={Lock} inputMode="numeric" maxLength={CODE_LENGTH} pattern="[0-9]{8}" placeholder="Verification code" required value={code} onChange={(event) => setCode(event.target.value)} />
    <button className="focus-ring w-full rounded-lg bg-accent py-3 text-white disabled:opacity-55" disabled={verifying || !isCompleteCode(code)} type="submit">{verifying ? "Verifying…" : "Verify email and enter"}</button>
  </form>;
}

const isCompleteCode = (code: string) => code.length === CODE_LENGTH;

type RegistrationFormProps = { error: string; hidden: boolean; onError: (message: string) => void; onCodeSent: (email: string) => void };

function RegistrationForm({ error, hidden, onError, onCodeSent }: RegistrationFormProps) {
  const form = useForm<RegisterValues>({ defaultValues: { name: "", username: "", email: "", password: "", confirm: "", terms: false }, mode: "onChange", resolver: zodResolver(registerSchema) });
  const email = form.watch("email");
  const password = form.watch("password");
  usePrefilledEmail((value) => form.setValue("email", value, { shouldValidate: true }));
  return (
    <form
      className={`space-y-4 ${hidden ? "hidden" : ""}`}
      onSubmit={form.handleSubmit(async ({ email: submittedEmail, name, username, password }) => {
        onError("");
        try {
          await startEmailSignup({ email: submittedEmail, name, username, password });
          onCodeSent(submittedEmail);
        } catch (reason) {
          onError(reason instanceof Error ? reason.message : "Registration failed.");
        }
      })}
    >
      <Field autoComplete="name" icon={UserIcon} placeholder="Full name" required {...form.register("name")} />
      <FieldError message={form.formState.errors.name?.message} />
      <Field autoComplete="username" icon={AtSign} placeholder="Leaderboard username" required {...form.register("username")} />
      <FieldError message={form.formState.errors.username?.message} />
      <Field
        aria-invalid={Boolean(email && form.formState.errors.email)}
        autoComplete="email"
        icon={Mail}
        placeholder="you@example.com"
        required
        type="email"
        {...form.register("email", { onChange: () => onError("") })}
      />
      {email && <EmailFormatHint email={email} />}
      <Field
        autoComplete="new-password"
        icon={Lock}
        placeholder="Password"
        required
        type="password"
        {...form.register("password")}
      />
      <PasswordRequirements password={password} />
      <FieldError message={form.formState.errors.password?.message} />
      <Field
        aria-invalid={Boolean(form.formState.errors.confirm)}
        autoComplete="new-password"
        icon={Lock}
        placeholder="Confirm password"
        required
        type="password"
        {...form.register("confirm")}
      />
      <FieldError message={form.formState.errors.confirm?.message} />
      {error && <ErrorBanner message={error} />}
      <TermsConsent onAgree={() => form.setValue("terms", true, { shouldValidate: true })} registration={form.register("terms")} />
      <FieldError message={form.formState.errors.terms?.message} />
      <button
        className="focus-ring flex w-full items-center justify-center gap-2 rounded-lg bg-gradient-to-r from-accent to-accent py-3 text-white shadow-lg shadow-accent/30 transition-all duration-300 hover:shadow-accent/50 disabled:cursor-not-allowed disabled:opacity-55"
        disabled={!form.formState.isValid || form.formState.isSubmitting}
        type="submit"
      >
        {form.formState.isSubmitting ? "Creating account…" : "Create account"} <ArrowRight size={15} />
      </button>
    </form>
  );
}

// "I agree" inside either document ticks the box, like most sign-up forms.
function TermsConsent({ onAgree, registration }: { onAgree: () => void; registration: UseFormRegisterReturn<"terms"> }) {
  return <div className="flex items-start gap-2 text-xs leading-5 text-muted">
    <input className="mt-0.5 accent-accent" id="register-terms" required type="checkbox" {...registration} />
    <label htmlFor="register-terms">
      I agree to the <LegalLink document="terms" onAgree={onAgree} /> and <LegalLink document="privacy" onAgree={onAgree} />.
    </label>
  </div>;
}

// "/register?email=…" (from a failed sign-in) starts the form with that email. Read on mount so the
// static export needs no Suspense boundary for search params.
function usePrefilledEmail(apply: (email: string) => void) {
  useEffect(() => {
    const email = new URLSearchParams(window.location.search).get("email")?.trim();
    if (email) apply(email);
    // eslint-disable-next-line react-hooks/exhaustive-deps -- apply once, on arrival
  }, []);
}

// Every rule is listed from the start and ticks as the password meets it.
function PasswordRequirements({ password }: { password: string }) {
  return <ul aria-label="Password requirements" aria-live="polite" className="grid gap-1 font-mono text-xs sm:grid-cols-2">
    {passwordRules.map((rule) => {
      const met = rule.test(password);
      return <li className={met ? "text-success" : "text-muted"} key={rule.label}>{met ? "✓" : "○"} {rule.label}</li>;
    })}
  </ul>;
}

async function startEmailSignup(details: { email: string; name: string; username: string; password: string }) {
  if (hasAuthApi()) {
    await officialAuth("/auth/email/start", details);
    return;
  }
  throw new Error(isStaticDemo() ? "Account creation is disabled in this static demo. Use an example account on the sign-in page." : "Registration requires the PyTorch PH API.");
}

function EmailFormatHint({ email }: { email: string }) {
  const emailValid = emailSchema.safeParse(email).success;
  return (
    <div className={`flex items-center gap-2 font-mono text-xs ${emailValid ? "text-success" : "text-accent"}`}>
      {emailValid ? <CheckCircle2 size={12} /> : <AlertCircle size={12} />}
      {emailValid ? "Valid email format" : "Enter a valid email address"}
    </div>
  );
}
