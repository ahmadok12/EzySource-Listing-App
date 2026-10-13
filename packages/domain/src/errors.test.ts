import { describe, expect, it } from "vitest";
import { apiErrorSchema, errorCodes, errorStatus } from "./errors";

describe("api errors", () => {
  it("maps every code to an HTTP status", () => {
    for (const code of errorCodes) {
      expect(errorStatus[code]).toBeGreaterThanOrEqual(400);
    }
  });

  it("rejects unknown codes", () => {
    const result = apiErrorSchema.safeParse({
      error: { code: "sql_error", message: "x", requestId: "r" },
    });
    expect(result.success).toBe(false);
  });
});
