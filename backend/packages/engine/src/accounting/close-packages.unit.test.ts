import { describe, expect, it } from "vitest";
import { sha256Canonical, stableStringify } from "./close-packages";

describe("Proof-of-Close canonicalization", () => {
  it("sorts object keys and normalizes decimal strings", () => {
    expect(stableStringify({ b: "001.2300", a: [{ z: 2, y: 1 }] })).toBe('{"a":[{"y":1,"z":2}],"b":"1.23"}');
  });

  it("produces the same hash regardless of object insertion order", () => {
    expect(sha256Canonical({ b: 2, a: "1.00" })).toBe(sha256Canonical({ a: "1", b: 2 }));
  });

  it("produces the same hash regardless of collection ordering", () => {
    expect(sha256Canonical({ entries: [{ id: "b" }, { id: "a" }] })).toBe(sha256Canonical({ entries: [{ id: "a" }, { id: "b" }] }));
  });
});
