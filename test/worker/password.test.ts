import { describe, expect, it } from "vitest";
import { DUMMY_HASH, hashPassword, verifyPassword } from "../../worker/auth/password";

describe("password hashing", () => {
  it("verifies the password it hashed", async () => {
    const stored = await hashPassword("correct horse battery staple");
    expect(await verifyPassword("correct horse battery staple", stored)).toBe(true);
  });

  it("rejects a wrong password", async () => {
    const stored = await hashPassword("correct horse battery staple");
    expect(await verifyPassword("correct horse battery stable", stored)).toBe(false);
  });

  it("stores algorithm, iterations, salt and hash separated by $", async () => {
    const stored = await hashPassword("password123");
    const parts = stored.split("$");
    expect(parts).toHaveLength(4);
    expect(parts[0]).toBe("pbkdf2-sha256");
    expect(parts[1]).toBe("100000");
    expect(parts[2]).toMatch(/^[A-Za-z0-9_-]+$/);
    expect(parts[3]).toMatch(/^[A-Za-z0-9_-]+$/);
  });

  it("salts each hash", async () => {
    const a = await hashPassword("password123");
    const b = await hashPassword("password123");
    expect(a).not.toBe(b);
  });

  it("rejects malformed stored values instead of throwing", async () => {
    expect(await verifyPassword("password123", "not-a-hash")).toBe(false);
    expect(await verifyPassword("password123", "md5$1$abc$def")).toBe(false);
  });

  it("has a well-formed dummy hash that matches nothing sensible", async () => {
    expect(DUMMY_HASH.split("$")).toHaveLength(4);
    expect(await verifyPassword("password123", DUMMY_HASH)).toBe(false);
  });
});
