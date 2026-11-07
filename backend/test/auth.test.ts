import { randomBytes } from "node:crypto";
import { describe, expect, it } from "vitest";
import { call, signup } from "./helpers";

const password = "Correct-horse-1234!";
const cookieFrom = (headers: Record<string, string | string[] | undefined>) => {
  const raw = headers["set-cookie"];
  return (Array.isArray(raw) ? raw[0] : raw)?.split(";")[0] ?? "";
};

describe("account access", () => {
  it("signs up, creates the first business, and signs out", async () => {
    const email = `fresh-${randomBytes(8).toString("hex")}@zetra.test`;
    const created = await call("POST", "/v1/auth/signup", {}, { name: "Fresh Owner", email, password });
    expect(created.statusCode).toBe(201);
    expect(created.data.organization_id).toBeNull();
    const cookie = cookieFrom(created.headers);
    expect(cookie).toBeTruthy();

    const before = await call("GET", "/v1/me", { cookie });
    expect(before.statusCode).toBe(200);
    expect(before.data.organization).toBeNull();

    const business = await call("POST", "/v1/organizations", { cookie }, { name: "Fresh Books Ltd" });
    expect(business.statusCode).toBe(201);
    const after = await call("GET", "/v1/me", { cookie });
    expect(after.data.organization).toMatchObject({ id: business.data.id, name: "Fresh Books Ltd", role: "owner" });

    expect((await call("POST", "/v1/auth/logout", { cookie })).statusCode).toBe(204);
    expect((await call("GET", "/v1/me", { cookie })).statusCode).toBe(401);
  });

  it("rejects bad credentials and restores the correct workspace on login", async () => {
    const session = await signup("Login Flow Ltd");
    await call("POST", "/v1/auth/logout", { cookie: session.cookie });

    const wrong = await call("POST", "/v1/auth/login", {}, { email: session.email, password: "wrong-password" });
    expect(wrong.statusCode).toBe(401);
    expect(wrong.data.error.code).toBe("invalid_credentials");

    const loggedIn = await call("POST", "/v1/auth/login", {}, { email: session.email, password: "Test-password-1234!" });
    expect(loggedIn.statusCode).toBe(200);
    expect(loggedIn.data.organization_id).toBe(session.orgId);
    const cookie = cookieFrom(loggedIn.headers);
    expect((await call("GET", "/v1/me", { cookie })).data.organization.id).toBe(session.orgId);
  });

  it("blocks duplicate accounts and cross-origin session changes", async () => {
    const email = `duplicate-${randomBytes(8).toString("hex")}@zetra.test`;
    const body = { name: "Owner", email, password, business_name: "Protected Ltd" };
    const first = await call("POST", "/v1/auth/signup", {}, body);
    expect(first.statusCode).toBe(201);
    expect((await call("POST", "/v1/auth/signup", {}, body)).statusCode).toBe(409);

    const cookie = cookieFrom(first.headers);
    const rejected = await call("POST", "/v1/session/environment", { cookie }, { environment: "live" }, { origin: "https://attacker.example" });
    expect(rejected.statusCode).toBe(403);
    expect(rejected.data.error.code).toBe("csrf_rejected");
  });
});
