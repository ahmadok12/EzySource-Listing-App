import { Hono } from "hono";
import { bodyLimit } from "hono/body-limit";
import type { HealthResponse } from "@ezysource/domain";
import type { AppBindings } from "./env";
import { ApiError, errorResponse } from "./errors";
import { requestId } from "./middleware/request-id";
import { securityHeaders } from "./middleware/security-headers";
import { provideServices } from "./middleware/services";
import { adminRoutes } from "./routes/admin";
import { mediaRoutes } from "./routes/media";
import { meRoutes } from "./routes/me";
import { createServices, type ServicesFactory } from "./services";

/** Initial default JSON body cap. File bytes go to staged uploads, not the API body. */
export const MAX_JSON_BODY_BYTES = 64 * 1024;

export function createApp({ services = createServices }: { services?: ServicesFactory } = {}) {
  const app = new Hono<AppBindings>().basePath("/api");

  app.use("*", requestId);
  app.use("*", securityHeaders);
  app.use(
    "*",
    bodyLimit({
      maxSize: MAX_JSON_BODY_BYTES,
      onError: (c) => errorResponse(c, "payload_too_large", "Request body is too large."),
    }),
  );

  app.use("*", provideServices(services));

  app.get("/health", (c) => {
    const body: HealthResponse = {
      status: "ok",
      service: "ezysource-api",
      version: c.env.APP_VERSION,
      time: new Date().toISOString(),
    };
    return c.json(body);
  });

  app.route("/", meRoutes);
  app.route("/", adminRoutes);
  app.route("/", mediaRoutes);

  app.notFound((c) => errorResponse(c, "not_found", "Not found."));

  app.onError((err, c) => {
    if (err instanceof ApiError) {
      return errorResponse(c, err.code, err.message, err.fieldErrors);
    }
    // Log only the request ID and error name; never request bodies or credentials.
    console.error(JSON.stringify({ requestId: c.get("requestId"), error: err.name }));
    return errorResponse(c, "internal", "Something went wrong. Please try again.");
  });

  return app;
}

export const app = createApp();
