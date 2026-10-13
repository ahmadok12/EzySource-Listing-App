import { createMiddleware } from "hono/factory";
import type { AppBindings } from "../env";

/** Every request gets a server-generated ID. Client-supplied IDs are not trusted. */
export const requestId = createMiddleware<AppBindings>(async (c, next) => {
  const id = crypto.randomUUID();
  c.set("requestId", id);
  await next();
  c.header("X-Request-Id", id);
});
