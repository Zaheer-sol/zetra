"use client";

import Link from "next/link";
import { PrivyAuthActions } from "@/components/privy-auth-actions";

export default function SignupPage() {
  return (
    <>
      <h1>Create your account</h1>
      <p className="mt-2 text-[1.0625rem] tracking-[-0.012em] text-muted-foreground">Start with a clean Live workspace for your business.</p>
      <div className="mt-6">
        <PrivyAuthActions mode="signup" />
      </div>
      <p className="mt-5 text-center text-sm text-muted-foreground">
        Already have an account?{" "}
        <Link href="/login" className="font-medium text-primary hover:underline">Sign in</Link>
      </p>
    </>
  );
}
