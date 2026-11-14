"use client";

import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { Suspense, useState } from "react";
import { Alert, Button, Field, Input } from "@/components/app-ui";
import { PrivyAuthActions } from "@/components/privy-auth-actions";
import { api, type ApiError } from "@/lib/api";

function PasswordLoginForm() {
  const params = useSearchParams();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<ApiError | null>(null);
  const [busy, setBusy] = useState(false);
  const next = params.get("next");
  const safeNext = next && next.startsWith("/") && !next.startsWith("//") ? next : "/app";

  return (
    <form
      className="grid gap-4 pt-4"
      onSubmit={async (e) => {
        e.preventDefault();
        setBusy(true);
        setError(null);
        try {
          const res = await api<{ organization_id: string | null }>("/v1/auth/login", { method: "POST", body: { email, password } });
          window.location.replace(res.organization_id ? safeNext : "/onboarding");
        } catch (err) {
          setError(err as ApiError);
          setBusy(false);
        }
      }}
    >
      {error && <Alert tone="danger">{error.message}</Alert>}
      <Field label="Work email" htmlFor="password-email">
        <Input id="password-email" type="email" autoComplete="email" required value={email} onChange={(e) => setEmail(e.target.value)} />
      </Field>
      <Field label="Password" htmlFor="password">
        <Input id="password" type="password" autoComplete="current-password" required value={password} onChange={(e) => setPassword(e.target.value)} />
      </Field>
      <Link href="/forgot-password" className="-mt-2 justify-self-end text-sm font-medium text-primary hover:underline">
        Forgot password?
      </Link>
      <Button type="submit" variant="secondary" size="lg" block loading={busy}>Sign in with password</Button>
    </form>
  );
}

function LoginOptions() {
  const [showPassword, setShowPassword] = useState(false);
  const params = useSearchParams();
  return (
    <div className="grid gap-5">
      <PrivyAuthActions mode="login" next={params.get("next")} />
      <div className="rounded-xl border border-border/70 px-4 py-3">
        <button type="button" className="w-full text-left text-sm font-medium text-muted-foreground hover:text-foreground" aria-expanded={showPassword} onClick={() => setShowPassword((value) => !value)}>
          {showPassword ? "Hide password sign-in" : "Sign in with password"}
        </button>
        {showPassword && <PasswordLoginForm />}
      </div>
    </div>
  );
}

export default function LoginPage() {
  return (
    <>
      <h1>Sign in to Zetra</h1>
      <p className="mt-2 text-[1.0625rem] tracking-[-0.012em] text-muted-foreground">Welcome back.</p>
      <div className="mt-6">
        <Suspense fallback={<div className="h-48 animate-pulse rounded-xl bg-muted/40" />}>
          <LoginOptions />
        </Suspense>
      </div>
      <p className="mt-5 text-center text-sm text-muted-foreground">
        New to Zetra?{" "}
        <Link href="/signup" className="font-medium text-primary hover:underline">Create an account</Link>
      </p>
      <p className="mt-3 text-center text-xs text-muted-foreground">The Zetra Demo account can still use its existing password.</p>
    </>
  );
}
