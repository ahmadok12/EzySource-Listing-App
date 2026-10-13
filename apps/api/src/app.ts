import { Hono } from "hono";
import { bodyLimit } from "hono/body-limit";
import type { HealthResponse } from "@ezysource/domain";
import type { AppBindings } from "./env";
import { ApiError, errorResponse } from "./errors";
import { requestId } from "./middleware/request-id";
import { securityHeaders } from "./middleware/security-headers";

/** Initial default JSON body cap. File bytes go to staged uploads, not the API body. */
export const MAX_JSON_BODY_BYTES = 64 * 1024;

export function createApp() {
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

  app.get("/health", (c) => {
    const body: HealthResponse = {
      status: "ok",
      service: "ezysource-api",
      version: c.env.APP_VERSION,
      time: new Date().toISOString(),
    };
    return c.json(body);
  });

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
