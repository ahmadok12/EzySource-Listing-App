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
export function apiGet<T>(path: string, parse: (data: unknown) => T): Promise<T> {
  return apiRequest("GET", path, parse);
}

/** Sends JSON to the API. `headers` carries extras such as an Idempotency-Key. */
export function apiSend<T>(
  method: "POST" | "PATCH",
  path: string,
  body: unknown,
  parse: (data: unknown) => T,
  headers: Record<string, string> = {},
): Promise<T> {
  return apiRequest(method, path, parse, body === undefined ? undefined : JSON.stringify(body), {
    "content-type": "application/json",
    ...headers,
  });
}

export async function apiDelete(path: string): Promise<void> {
  await apiRequest("DELETE", path, () => undefined);
}

/** Sends a file's bytes. The browser sets Content-Length from the blob. */
export function apiPutFile<T>(path: string, file: Blob, contentType: string, parse: (data: unknown) => T) {
  return apiRequest("PUT", path, parse, file, { "content-type": contentType });
}

/**
 * Downloads a private file with the signed-in person's token. Images and audio can't
 * send that header themselves, so screens show the result as a local object URL.
 */
export async function apiGetFile(path: string): Promise<Blob> {
  const res = await send("GET", path, undefined, {});
  if (!res.ok) await fail(res);
  return res.blob();
}

async function send(method: string, path: string, body: BodyInit | undefined, headers: Record<string, string>) {
  const token = await tokenProvider();
  try {
    return await fetch(`/api${path}`, {
      method,
      headers: {
        accept: "application/json",
        ...headers,
        ...(token ? { authorization: `Bearer ${token}` } : {}),
      },
      ...(body === undefined ? {} : { body }),
      credentials: "omit",
    });
  } catch {
    throw new ApiRequestError(0, "network", "Can't reach EzySource. Check your connection.");
  }
}

async function fail(res: Response, data?: unknown): Promise<never> {
  const body = data === undefined ? await res.json().catch(() => undefined) : data;
  const parsed = apiErrorSchema.safeParse(body);
  if (parsed.success) {
    const { code, message, requestId, fieldErrors } = parsed.data.error;
    throw new ApiRequestError(res.status, code, message, requestId, fieldErrors);
  }
  throw new ApiRequestError(res.status, "internal", "Unexpected response from the server.");
}

async function apiRequest<T>(
  method: string,
  path: string,
  parse: (data: unknown) => T,
  body?: BodyInit,
  headers: Record<string, string> = {},
): Promise<T> {
  const res = await send(method, path, body, headers);
  const data: unknown = await res.json().catch(() => undefined);
  if (!res.ok) await fail(res, data ?? null);
  return parse(data);
}
