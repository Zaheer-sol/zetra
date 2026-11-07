-- Stripe can deliver both checkout.session.completed and payment_intent.succeeded for one charge.
-- The engine canonicalizes both to the PaymentIntent id; enforce that invariant in the database too.
CREATE UNIQUE INDEX processor_receipts_source_object
  ON processor_receipts(source_id, provider_object_id)
  WHERE provider_object_id IS NOT NULL;
