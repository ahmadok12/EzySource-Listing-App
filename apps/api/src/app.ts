import { Hono } from "hono";
import { bodyLimit } from "hono/body-limit";
import { DomainError, type HealthResponse } from "@ezysource/domain";
import type { AppBindings } from "./env";
import { errorResponse } from "./errors";
import { requestId } from "./middleware/request-id";
import { securityHeaders } from "./middleware/security-headers";
import { provideServices } from "./middleware/services";
import { adminRoutes } from "./routes/admin";
import { collectionRoutes } from "./routes/collection";
import { mediaRoutes } from "./routes/media";
import { meRoutes } from "./routes/me";
import { MAX_UPLOAD_BYTES, UPLOAD_CONTENT_PATH, uploadRoutes } from "./routes/uploads";
import { createServices, type ServicesFactory } from "./services";

/** Initial default JSON body cap. File bytes go to staged uploads, not the API body. */
export const MAX_JSON_BODY_BYTES = 64 * 1024;

export function createApp({ services = createServices }: { services?: ServicesFactory } = {}) {
  const app = new Hono<AppBindings>().basePath("/api");

  app.use("*", requestId);
  app.use("*", securityHeaders);
  const jsonLimit = bodyLimit({
    maxSize: MAX_JSON_BODY_BYTES,
    onError: (c) => errorResponse(c, "payload_too_large", "Request body is too large."),
  });
  const fileLimit = bodyLimit({
    maxSize: MAX_UPLOAD_BYTES,
    onError: (c) => errorResponse(c, "payload_too_large", "This file is too big."),
  });
  // File bytes go only to the upload route, which checks them against the staged upload.
  app.use("*", (c, next) =>
    c.req.method === "PUT" && UPLOAD_CONTENT_PATH.test(c.req.path) ? fileLimit(c, next) : jsonLimit(c, next),
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
  app.route("/", collectionRoutes);
  app.route("/", uploadRoutes);

  app.notFound((c) => errorResponse(c, "not_found", "Not found."));

  app.onError((err, c) => {
    if (err instanceof DomainError) {
      return errorResponse(c, err.code, err.message, err.fieldErrors);
    }
    // Log only the request ID and error name; never request bodies or credentials.
    console.error(JSON.stringify({ requestId: c.get("requestId"), error: err.name }));
    return errorResponse(c, "internal", "Something went wrong. Please try again.");
  });

  return app;
}

export const app = createApp();
