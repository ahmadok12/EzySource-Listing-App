/**
 * Unfinished areas stay hidden in production builds (specs/00: never expose
 * unfinished features as working buttons). `pnpm dev` always shows them so the
 * shells can be reviewed; a preview build can opt in with VITE_PREVIEW_SHELLS.
 */
export const previewShells =
  import.meta.env.DEV || import.meta.env.VITE_PREVIEW_SHELLS === "true";
