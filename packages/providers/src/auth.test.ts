import { describe, expect, it, beforeAll } from "vitest";
import { createLocalJWKSet, exportJWK, generateKeyPair, SignJWT, type CryptoKey, type JSONWebKeySet } from "jose";
import { SupabaseTokenVerifier } from "./auth";

const url = "https://example.supabase.co";
let privateKey: CryptoKey;
let otherKey: CryptoKey;
let jwks: JSONWebKeySet;

beforeAll(async () => {
  const pair = await generateKeyPair("ES256");
  privateKey = pair.privateKey;
  otherKey = (await generateKeyPair("ES256")).privateKey;
  jwks = { keys: [{ ...(await exportJWK(pair.publicKey)), kid: "k1", alg: "ES256" }] };
});

function token(claims: Record<string, unknown>, key = privateKey) {
  return new SignJWT({ aud: "authenticated", ...claims })
    .setProtectedHeader({ alg: "ES256", kid: "k1" })
    .setIssuer(`${url}/auth/v1`)
    .setSubject("user-1")
    .setIssuedAt()
    .setExpirationTime("5m")
    .sign(key);
}

describe("SupabaseTokenVerifier", () => {
  const verifier = () => new SupabaseTokenVerifier(url, createLocalJWKSet(jwks));

  it("accepts a valid token and reads the MFA level", async () => {
    expect(await verifier().verify(await token({ aal: "aal2" }))).toEqual({
      provider: "supabase",
      subject: "user-1",
      assuranceLevel: "aal2",
    });
    expect((await verifier().verify(await token({ aal: "aal1" })))?.assuranceLevel).toBe("aal1");
  });

  it("rejects tokens signed by another key", async () => {
    expect(await verifier().verify(await token({}, otherKey))).toBeNull();
  });

  it("rejects the wrong audience or issuer", async () => {
    expect(await verifier().verify(await token({ aud: "anon" }))).toBeNull();
    const foreign = new SupabaseTokenVerifier("https://other.supabase.co", createLocalJWKSet(jwks));
    expect(await foreign.verify(await token({}))).toBeNull();
  });

  it("rejects expired tokens and garbage", async () => {
    const expired = await new SignJWT({ aud: "authenticated" })
      .setProtectedHeader({ alg: "ES256", kid: "k1" })
      .setIssuer(`${url}/auth/v1`)
      .setSubject("user-1")
      .setIssuedAt(Math.floor(Date.now() / 1000) - 600)
      .setExpirationTime(Math.floor(Date.now() / 1000) - 300)
      .sign(privateKey);
    expect(await verifier().verify(expired)).toBeNull();
    expect(await verifier().verify("not-a-token")).toBeNull();
  });
});
