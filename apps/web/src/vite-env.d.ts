/// <reference types="vite/client" />

interface ImportMetaEnv {
  readonly VITE_PREVIEW_SHELLS?: string;
  /** Public Supabase project URL. */
  readonly VITE_SUPABASE_URL?: string;
  /** Public (publishable/anon) key. Never a service-role or secret key. */
  readonly VITE_SUPABASE_PUBLISHABLE_KEY?: string;
  /** "true" on staging only: offers password sign-in for testing without email codes. */
  readonly VITE_ALLOW_PASSWORD_SIGN_IN?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
