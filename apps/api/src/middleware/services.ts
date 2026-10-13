import { createMiddleware } from "hono/factory";
import type { AppBindings } from "../env";
import type { ServicesFactory } from "../services";

export function provideServices(factory: ServicesFactory) {
  return createMiddleware<AppBindings>(async (c, next) => {
    const services = factory(c.env);
    c.set("services", services);
    try {
      await next();
    } finally {
      const closing = services.close();
      try {
        c.executionCtx.waitUntil(closing);
      } catch {
        // No execution context outside the Worker runtime (tests); just await.
        await closing;
      }
    }
  });
}
