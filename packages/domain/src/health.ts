import { z } from "zod";

export const healthResponseSchema = z.object({
  status: z.literal("ok"),
  service: z.literal("ezysource-api"),
  version: z.string(),
  time: z.string(),
});

export type HealthResponse = z.infer<typeof healthResponseSchema>;
