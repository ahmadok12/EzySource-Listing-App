/// <reference types="vite/client" />

interface ImportMetaEnv {
  readonly VITE_PREVIEW_SHELLS?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
