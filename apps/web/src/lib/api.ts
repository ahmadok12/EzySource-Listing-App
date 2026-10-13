import { apiErrorSchema, type ErrorCode } from "@ezysource/domain";

/** A typed failure from the EzySource API. */
export class ApiRequestError extends Error {
  constructor(
    readonly status: number,
    readonly code: ErrorCode | "network",
    message: string,
    readonly requestId?: string,
    readonly fieldErrors?: Record<string, string[]>,
  ) {
    super(message);
  }
}

let tokenProvider: () => Promise<string | null> = async () => null;

/** Called once by the auth provider so API calls carry the current access token. */
export function setApiTokenProvider(provider: () => Promise<string | null>) {
  tokenProvider = provider;
}

/** All UI data access goes through the app API, never directly to the database (specs/08). */
export async function apiGet<T>(path: string, parse: (data: unknown) => T): Promise<T> {
  const token = await tokenProvider();
  let res: Response;
  try {
    res = await fetch(`/api${path}`, {
      headers: {
        accept: "application/json",
        ...(token ? { authorization: `Bearer ${token}` } : {}),
      },
      credentials: "omit",
    });
  } catch {
    throw new ApiRequestError(0, "network", "Can't reach EzySource. Check your connection.");
  }

  const data: unknown = await res.json().catch(() => undefined);
  if (!res.ok) {
    const parsed = apiErrorSchema.safeParse(data);
    if (parsed.success) {
      const { code, message, requestId, fieldErrors } = parsed.data.error;
      throw new ApiRequestError(res.status, code, message, requestId, fieldErrors);
    }
    throw new ApiRequestError(res.status, "internal", "Unexpected response from the server.");
  }
  return parse(data);
}
