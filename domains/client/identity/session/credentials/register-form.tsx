"use client";

// Create an account: registration details first, then the emailed verification code.
// Module map (caller-first):
//   RegisterForm            the verification step (after sign-up) above the registration form
//   VerificationCodeForm    8-digit code → POST /auth/email/verify → dashboard
//   RegistrationForm        name, username, email, passwords and terms
//   startEmailSignup        POST /auth/email/start (or explains why sign-up is unavailable)
//   EmailFormatHint         live "valid email" feedback
//   isCompleteCode          the code has all eight digits

import Link from "next/link";
import { useRouter } from "next/navigation";
import { AlertCircle, ArrowRight, AtSign, CheckCircle2, Lock, Mail, User as UserIcon } from "lucide-react";
import { useState } from "react";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { AuthShell } from "../render-shell";
import { emailSchema, registerSchema, type RegisterValues } from "@pytorch-ph/domain-protocol/identity";
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
      router.replace("/dashboard"); router.refresh();
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
  );
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
