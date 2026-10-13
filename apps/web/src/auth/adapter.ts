import { createClient, type SupabaseClient } from "@supabase/supabase-js";

/**
 * The only place the login SDK is used (specs/08). The rest of the app sees this
 * small interface, so the provider can be replaced without touching screens.
 */
export type MfaStatus = {
  currentLevel: "aal1" | "aal2" | null;
  /** A verified authenticator app, if one is enrolled. */
  factorId: string | null;
};

export type MfaEnrollment = { factorId: string; qrCodeSvg: string; secret: string };

export interface AuthAdapter {
  getAccessToken(): Promise<string | null>;
  onChange(listener: (signedIn: boolean) => void): () => void;
  sendCode(email: string): Promise<void>;
  verifyCode(email: string, code: string): Promise<void>;
  /** Staging testing only (VITE_ALLOW_PASSWORD_SIGN_IN). Production signs in with email codes. */
  signInWithPassword?(email: string, password: string): Promise<void>;
  mfaStatus(): Promise<MfaStatus>;
  enrollMfa(): Promise<MfaEnrollment>;
  verifyMfa(factorId: string, code: string): Promise<void>;
  signOut(): Promise<void>;
}

export class AuthError extends Error {}

function fail(error: { message: string } | null): asserts error is null {
  if (error) throw new AuthError(error.message);
}

class SupabaseAuthAdapter implements AuthAdapter {
  constructor(private readonly client: SupabaseClient) {}

  async getAccessToken() {
    const { data } = await this.client.auth.getSession();
    return data.session?.access_token ?? null;
  }

  onChange(listener: (signedIn: boolean) => void) {
    const { data } = this.client.auth.onAuthStateChange((_event, session) => listener(!!session));
    return () => data.subscription.unsubscribe();
  }

  async sendCode(email: string) {
    const { error } = await this.client.auth.signInWithOtp({
      email,
      options: { shouldCreateUser: true },
    });
    fail(error);
  }

  async verifyCode(email: string, code: string) {
    const { error } = await this.client.auth.verifyOtp({ email, token: code, type: "email" });
    fail(error);
  }

  async signInWithPassword(email: string, password: string) {
    const { error } = await this.client.auth.signInWithPassword({ email, password });
    fail(error);
  }

  async mfaStatus(): Promise<MfaStatus> {
    const level = await this.client.auth.mfa.getAuthenticatorAssuranceLevel();
    fail(level.error);
    const factors = await this.client.auth.mfa.listFactors();
    fail(factors.error);
    const totp = factors.data.totp.find((f) => f.status === "verified");
    const current = level.data.currentLevel;
    return {
      currentLevel: current === "aal2" ? "aal2" : current === "aal1" ? "aal1" : null,
      factorId: totp?.id ?? null,
    };
  }

  async enrollMfa(): Promise<MfaEnrollment> {
    // Remove abandoned, never-verified enrolments so a retry starts clean.
    const factors = await this.client.auth.mfa.listFactors();
    fail(factors.error);
    for (const factor of factors.data.all.filter((f) => f.status === "unverified")) {
      await this.client.auth.mfa.unenroll({ factorId: factor.id });
    }
    const { data, error } = await this.client.auth.mfa.enroll({
      factorType: "totp",
      friendlyName: "EzySource authenticator",
    });
    fail(error);
    return { factorId: data.id, qrCodeSvg: data.totp.qr_code, secret: data.totp.secret };
  }

  async verifyMfa(factorId: string, code: string) {
    const { error } = await this.client.auth.mfa.challengeAndVerify({ factorId, code });
    fail(error);
  }

  async signOut() {
    await this.client.auth.signOut();
  }
}

/** Null when this build has no login provider configured; screens say so honestly. */
export function createAuthAdapter(): AuthAdapter | null {
  const url = import.meta.env.VITE_SUPABASE_URL;
  const key = import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY;
  if (!url || !key) return null;
  return new SupabaseAuthAdapter(
    createClient(url, key, {
      auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: false },
    }),
  );
}
