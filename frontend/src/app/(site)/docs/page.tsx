import type { Metadata } from "next";
import Link from "next/link";
import { DOCS } from "@/lib/docs";
import { CodeBlock } from "@/components/app-ui";
import { Zeti } from "@/components/zeti";

export const metadata: Metadata = { title: "Docs", description: "Build with Zetra APIs, financial events, and signed webhooks." };

export default function DocsIndex() {
  return (
    <>
      <div className="not-prose flex items-end justify-between gap-6">
        <div>
          <h1 className="text-[2.5rem] leading-tight font-bold tracking-[-0.03em]">Zetra documentation</h1>
          <p className="mt-3 text-[1.0625rem] text-muted-foreground">
            Create orders and invoices, receive matched payment events, and read the same numbers you see in the Zetra console. The API, webhooks and console all run on one engine. Available networks and token contracts depend on server configuration.
          </p>
        </div>
        <Zeti mood="focused" size={130} priority className="shrink-0 max-sm:hidden" />
      </div>
      <CodeBlock
        className="not-prose"
        code={`Merchant → invoice → customer pays a supported stablecoin → merchant wallet
        → Zetra observes → verifies → matches → financial event → webhook / API`}
      />
      <h2>Start here</h2>
      <ul>
        {DOCS.map((d) => (
          <li key={d.slug}>
            <Link href={`/docs/${d.slug}`}>{d.title}</Link>: {d.lead}
          </li>
        ))}
      </ul>
      <h2>Environments</h2>
      <table>
        <thead>
          <tr>
            <th>Mode</th>
            <th>Keys</th>
            <th>Network</th>
            <th>Token contract</th>
          </tr>
        </thead>
        <tbody>
          <tr>
            <td>Test</td>
            <td>
              <code>sk_test_</code>
            </td>
            <td>Enabled test networks</td>
            <td>Configured per network</td>
          </tr>
          <tr>
            <td>Live</td>
            <td>
              <code>sk_live_</code>
            </td>
            <td>Enabled live networks</td>
            <td>Configured per network</td>
          </tr>
        </tbody>
      </table>
    </>
  );
}
