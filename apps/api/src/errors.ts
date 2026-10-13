import type { Context } from "hono";
import { DomainError, errorStatus, type ApiErrorBody, type ErrorCode } from "@ezysource/domain";
import type { AppBindings } from "./env";

/** A safe, expected failure. Its message is shown to the client as-is. */
export class ApiError extends DomainError {}

export function errorResponse(
  c: Context<AppBindings>,
  code: ErrorCode,
  message: string,
  fieldErrors?: Record<string, string[]>,
) {
  const body: ApiErrorBody = {
    error: {
      code,
      message,
      requestId: c.get("requestId"),
      ...(fieldErrors ? { fieldErrors } : {}),
    },
  };
  return c.json(body, errorStatus[code] as 400);
}
