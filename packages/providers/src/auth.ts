import { createRemoteJWKSet, jwtVerify, type JWTVerifyGetKey } from "jose";
import type { AssuranceLevel } from "@ezysource/domain";

/** A login proven by a verified token. Provider-neutral (specs/11 portability). */
export type VerifiedIdentity = {
  provider: string;
  subject: string;
  assuranceLevel: AssuranceLevel;
};

export interface TokenVerifier {
  /** Resolves the identity, or null for any invalid, expired or foreign token. */
  verify(token: string): Promise<VerifiedIdentity | null>;
}

/**
 * Verifies Supabase Auth access tokens against the project's published signing keys.
 * Checks signature, issuer, audience and expiry server-side (specs/06).
 */
export class SupabaseTokenVerifier implements TokenVerifier {
  private readonly issuer: string;
  private readonly keys: JWTVerifyGetKey;

  constructor(supabaseUrl: string, keys?: JWTVerifyGetKey) {
    const base = supabaseUrl.replace(/\/+$/, "");
    this.issuer = `${base}/auth/v1`;
    this.keys = keys ?? createRemoteJWKSet(new URL(`${this.issuer}/.well-known/jwks.json`));
  }

  async verify(token: string): Promise<VerifiedIdentity | null> {
    try {
      const { payload } = await jwtVerify(token, this.keys, {
        issuer: this.issuer,
        audience: "authenticated",
        algorithms: ["ES256", "RS256"],
        requiredClaims: ["sub", "exp"],
      });
      if (typeof payload.sub !== "string" || payload.sub.length === 0) return null;
      return {
        provider: "supabase",
        subject: payload.sub,
        assuranceLevel: payload.aal === "aal2" ? "aal2" : "aal1",
      };
    } catch {
      return null;
    }
  }
}
