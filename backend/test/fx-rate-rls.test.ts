import { randomBytes } from "node:crypto";
import { afterAll, describe, expect, it } from "vitest";
import { closePools, withSystem, withTenant } from "@zetra/database";
import { call, server, signup } from "./helpers";

afterAll(async () => {
  await (await server()).close();
  await closePools();
});

describe("exchange-rate row-level security", () => {
  it("isolates business rates but exposes published reference rates to each workspace", async () => {
    const ownerA = await signup("Rate Owner A");
    const ownerB = await signup("Rate Owner B");
    const authA = { cookie: ownerA.cookie };
    const authB = { cookie: ownerB.cookie };
    const date = new Date().toISOString().slice(0, 10);

    const role = await withTenant(ownerB.orgId, (client) => client.query(
      "SELECT r.rolsuper, r.rolbypassrls FROM pg_roles r WHERE r.rolname = current_user"
    ));
    expect(role.rows[0]).toMatchObject({ rolsuper: false, rolbypassrls: false });

    const saved = await call("POST", "/v1/accounting/fx-rates", authA, {
      base: "EUR",
      quote: "CHF",
      rate_date: date,
      rate: "0.95",
      note: "Tenant RLS integration fixture"
    });
    expect(saved.statusCode).toBe(201);

    const tenantRateInA = await withTenant(ownerA.orgId, (client) => client.query(
      "SELECT id FROM fx_rates WHERE organization_id = $1 AND base = 'EUR' AND quote = 'CHF' AND rate_date = $2::date",
      [ownerA.orgId, date]
    ));
    const tenantRateInB = await withTenant(ownerB.orgId, (client) => client.query(
      "SELECT id FROM fx_rates WHERE id = $1",
      [saved.data.id]
    ));
    expect(tenantRateInA.rowCount).toBe(1);
    expect(tenantRateInB.rowCount).toBe(0);

    const publicRateId = `fx_public_${randomBytes(8).toString("hex")}`;
    await withSystem((client) => client.query(
      "INSERT INTO fx_rates (id, organization_id, base, quote, rate_date, rate, source) VALUES ($1, NULL, 'NEAR', 'USD', $2::date, 5, 'ecb')",
      [publicRateId, date]
    ));
    const publicRateInB = await withTenant(ownerB.orgId, (client) => client.query(
      "SELECT id FROM fx_rates WHERE id = $1",
      [publicRateId]
    ));
    expect(publicRateInB.rowCount).toBe(1);

    const crossTenantWrite = await withTenant(ownerB.orgId, async (client) => client.query(
      "UPDATE fx_rates SET rate = 0.96 WHERE organization_id = $1 AND base = 'EUR' AND quote = 'CHF' AND rate_date = $2::date",
      [ownerA.orgId, date]
    ));
    expect(crossTenantWrite.rowCount).toBe(0);

    // Exercise the authenticated route too, not only the underlying database policy.
    const listB = await call("GET", "/v1/accounting/fx-rates", authB);
    expect(listB.statusCode).toBe(200);
    expect(listB.data.data.some((rate: any) => rate.base === "EUR" && rate.quote === "CHF" && rate.note === "Tenant RLS integration fixture")).toBe(false);
    expect(listB.data.data.some((rate: any) => rate.published && rate.base === "NEAR" && rate.quote === "USD")).toBe(true);
  });
});
