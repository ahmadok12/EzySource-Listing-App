import { z } from "zod";

/**
 * Error codes shared by the API and the web client.
 * HTTP mapping follows specs/08: 401, 403/404, 409, 422, 429, 503.
 */
export const errorCodes = [
  "unauthenticated",
  "forbidden",
  "mfa_required",
  "not_found",
  "conflict",
  "validation_failed",
  "payload_too_large",
  "rate_limited",
  "upstream_unavailable",
  "internal",
] as const;

export type ErrorCode = (typeof errorCodes)[number];

export const errorStatus: Record<ErrorCode, number> = {
  unauthenticated: 401,
  forbidden: 403,
  mfa_required: 403,
  not_found: 404,
  conflict: 409,
  validation_failed: 422,
  payload_too_large: 413,
  rate_limited: 429,
  upstream_unavailable: 503,
  internal: 500,
};

/** Every API error body. Never carries SQL, credentials or stack traces. */
export const apiErrorSchema = z.object({
  error: z.object({
    code: z.enum(errorCodes),
    message: z.string(),
    fieldErrors: z.record(z.string(), z.array(z.string())).optional(),
    requestId: z.string(),
  }),
});

export type ApiErrorBody = z.infer<typeof apiErrorSchema>;
