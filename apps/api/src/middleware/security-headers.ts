import { createMiddleware } from "hono/factory";
import type { AppBindings } from "../env";

/** API responses are private and never framed or sniffed (specs/12). */
export const securityHeaders = createMiddleware<AppBindings>(async (c, next) => {
  await next();
  c.header("Cache-Control", "private, no-store");
  c.header("X-Content-Type-Options", "nosniff");
  c.header("Referrer-Policy", "no-referrer");
  c.header("Content-Security-Policy", "default-src 'none'; frame-ancestors 'none'");
  c.header("X-Frame-Options", "DENY");
});
