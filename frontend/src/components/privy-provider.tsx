"use client";

import { PrivyProvider } from "@privy-io/react-auth";
import type { ReactNode } from "react";

const appId = process.env.NEXT_PUBLIC_PRIVY_APP_ID ?? "cmwg01q7v02ab0gl6szuuj882";

export function ZetraPrivyProvider({ children }: { children: ReactNode }) {
  return (
    <PrivyProvider
      appId={appId}
      config={{
        loginMethods: ["email", "google"],
        appearance: { theme: "dark", accentColor: "#4f8cff" },
        // Zetra uses NEAR wallets. Privy is only handling identity here.
        embeddedWallets: {
          ethereum: { createOnLogin: "off" },
          solana: { createOnLogin: "off" }
        }
      }}
    >
      {children}
    </PrivyProvider>
  );
}
