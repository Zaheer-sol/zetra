"use client";

import { useCallback, useState, type FormEvent } from "react";
import { getIdentityToken, useLoginWithEmail, useLoginWithOAuth } from "@privy-io/react-auth";
import { Alert, Button, Field, Input } from "@/components/app-ui";
import { api } from "@/lib/api";

type Props = { mode: "signup" | "login"; next?: string | null };

export function PrivyAuthActions({ mode, next }: Props) {
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [code, setCode] = useState("");
  const [codeSent, setCodeSent] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const safeNext = next && next.startsWith("/") && !next.startsWith("//") ? next : "/app";

  const completeSignIn = useCallback(async () => {
    setBusy(true);
    setError("");
    try {
      const identityToken = await getIdentityToken();
      if (!identityToken) {
        throw new Error("Privy did not return an identity token. Enable ‘Return user data in an identity token’ in the Privy dashboard under User management → Authentication → Advanced.");
      }
      const result = await api<{ organization_id: string | null }>("/v1/auth/privy", {
        method: "POST",
        body: { identity_token: identityToken, ...(name.trim() ? { name: name.trim() } : {}) }
      });
      window.location.replace(result.organization_id ? safeNext : "/onboarding");
    } catch (err) {
      setBusy(false);
      setError(err instanceof Error ? err.message : "Could not complete sign-in. Please try again.");
    }
  }, [name, safeNext]);

  const callbacks = {
    onComplete: () => { void completeSignIn(); },
    onError: (reason: unknown) => {
      setBusy(false);
      setError(String(reason || "Privy sign-in did not complete. Please try again."));
    }
  };
  const emailLogin = useLoginWithEmail(callbacks);
  const googleLogin = useLoginWithOAuth(callbacks);

  const continueWithGoogle = async () => {
    setBusy(true);
    setError("");
    try {
      await googleLogin.initOAuth({ provider: "google", disableSignup: mode === "login" });
    } catch (err) {
      setBusy(false);
      setError(err instanceof Error ? err.message : "Could not start Google sign-in. Please try again.");
    }
  };

  const submitEmail = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setBusy(true);
    setError("");
    try {
      if (codeSent) {
        await emailLogin.loginWithCode({ code: code.trim() });
      } else {
        await emailLogin.sendCode({ email: email.trim(), disableSignup: mode === "login" });
        setCodeSent(true);
        setBusy(false);
      }
    } catch (err) {
      setBusy(false);
      setError(err instanceof Error ? err.message : "Could not complete email sign-in. Check the details and try again.");
    }
  };

  return (
    <div className="grid gap-4">
      {error && <Alert tone="danger">{error}</Alert>}
      <Button type="button" variant="outline" size="lg" block loading={busy && googleLogin.loading} disabled={busy} onClick={continueWithGoogle}>
        <span aria-hidden="true" className="mr-1 font-bold text-primary">G</span>
        Continue with Google
      </Button>
      <div className="flex items-center gap-3 text-xs text-muted-foreground" aria-hidden="true">
        <span className="h-px flex-1 bg-border" />
        or continue with email
        <span className="h-px flex-1 bg-border" />
      </div>
      <form className="grid gap-4" onSubmit={submitEmail}>
        {mode === "signup" && (
          <Field label="Your name" htmlFor="privy-name">
            <Input id="privy-name" autoComplete="name" required value={name} onChange={(event) => setName(event.target.value)} />
          </Field>
        )}
        <Field label="Work email" htmlFor="privy-email" hint={codeSent ? `Enter the verification code sent to ${email}.` : "We’ll email you a one-time sign-in code."}>
          <Input id="privy-email" type="email" autoComplete="email" required value={email} readOnly={codeSent} onChange={(event) => setEmail(event.target.value)} />
        </Field>
        {codeSent && (
          <Field label="Verification code" htmlFor="privy-code">
            <Input id="privy-code" inputMode="numeric" autoComplete="one-time-code" required autoFocus value={code} onChange={(event) => setCode(event.target.value)} />
          </Field>
        )}
        <Button type="submit" variant="primary" size="lg" block loading={busy && !googleLogin.loading} disabled={busy}>
          {codeSent ? "Verify email and continue" : "Continue with email"}
        </Button>
        {codeSent && (
          <div className="flex justify-center gap-4 text-sm">
            <button type="button" className="text-primary hover:underline" onClick={() => { setCodeSent(false); setCode(""); setError(""); }}>
              Change email
            </button>
            <button
              type="button"
              className="text-primary hover:underline disabled:opacity-50"
              disabled={busy}
              onClick={async () => {
                setBusy(true);
                setError("");
                try {
                  await emailLogin.sendCode({ email: email.trim(), disableSignup: mode === "login" });
                } catch (err) {
                  setError(err instanceof Error ? err.message : "Could not resend the code.");
                } finally {
                  setBusy(false);
                }
              }}
            >
              Resend code
            </button>
          </div>
        )}
      </form>
    </div>
  );
}
