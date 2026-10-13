import { createLocalJWKSet, exportJWK, generateKeyPair, SignJWT, type CryptoKey } from "jose";
import type { StaffRole } from "@ezysource/domain";
import type { AppUser, MediaAssetRecord } from "@ezysource/db";
import { MemoryObjectStore, SupabaseTokenVerifier } from "@ezysource/providers";
import type { Services } from "../src/services";

export const SUPABASE_URL = "https://test-project.supabase.co";

/** Signs tokens the way Supabase Auth does, with a key the test verifier trusts. */
export async function createTokenIssuer() {
  const { privateKey, publicKey } = await generateKeyPair("ES256");
  const jwks = createLocalJWKSet({
    keys: [{ ...(await exportJWK(publicKey)), kid: "test", alg: "ES256" }],
  });
  return {
    verifier: new SupabaseTokenVerifier(SUPABASE_URL, jwks),
    sign: (subject: string, aal: "aal1" | "aal2" = "aal1", key: CryptoKey = privateKey) =>
      new SignJWT({ aud: "authenticated", aal })
        .setProtectedHeader({ alg: "ES256", kid: "test" })
        .setIssuer(`${SUPABASE_URL}/auth/v1`)
        .setSubject(subject)
        .setIssuedAt()
        .setExpirationTime("5m")
        .sign(key),
  };
}

/** In-memory stand-ins for the database-backed services. */
export class FakeWorld {
  users = new Map<string, AppUser>();
  roles = new Map<string, StaffRole[]>();
  media = new Map<string, MediaAssetRecord>();
  store = new MemoryObjectStore();
  private next = 1;

  userFor(subject: string) {
    let user = this.users.get(subject);
    if (!user) {
      const id = `00000000-0000-4000-8000-${String(this.next++).padStart(12, "0")}`;
      user = { id, displayName: subject, state: "active" };
      this.users.set(subject, user);
    }
    return user;
  }

  services(verifier: Services["verifier"]): Services {
    return {
      verifier,
      users: {
        resolve: async ({ subject }) => this.userFor(subject),
        staffRoles: async (userId) => this.roles.get(userId) ?? [],
        listStaff: async () =>
          [...this.users.values()]
            .filter((u) => (this.roles.get(u.id) ?? []).length > 0)
            .map((u) => ({ ...u, roles: this.roles.get(u.id)! })),
      },
      media: { get: async (id) => this.media.get(id) ?? null },
      store: this.store,
      close: async () => {},
    };
  }
}
