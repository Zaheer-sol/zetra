import type { CanonicalPaymentEvent, PaymentEventSourceKind } from "@zetra/schemas";

/** Connection metadata exposed to an adapter. Secrets stay in the API/engine layer. */
export interface PaymentSourceConnection {
  id: string;
  kind: PaymentEventSourceKind;
  provider: string;
  network?: string;
}

export interface WebhookInput {
  rawBody: string;
  headers: Record<string, string | string[] | undefined>;
  connection: PaymentSourceConnection;
}

export interface BackfillPage<Cursor = string> {
  events: readonly unknown[];
  nextCursor: Cursor | null;
}

/**
 * Contract every future processor connector must satisfy. The engine remains responsible for
 * idempotency, matching, finality and accounting; adapters only authenticate, fetch and normalize
 * provider records.
 */
export interface PaymentSourceAdapter<Cursor = string> {
  readonly kind: PaymentEventSourceKind;
  readonly provider: string;
  verifyWebhook(input: WebhookInput): Promise<boolean> | boolean;
  parseWebhook(input: WebhookInput): Promise<readonly unknown[]> | readonly unknown[];
  normalize(event: unknown, connection: PaymentSourceConnection): CanonicalPaymentEvent | null;
  backfill?(connection: PaymentSourceConnection, cursor: Cursor | null): Promise<BackfillPage<Cursor>>;
}

export function adapterName(adapter: Pick<PaymentSourceAdapter, "kind" | "provider">): string {
  return `${adapter.kind}:${adapter.provider}`;
}
