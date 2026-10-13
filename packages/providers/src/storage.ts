/** A byte range request, inclusive start, optional length. */
export type ByteRange = { offset: number; length?: number };

export type StoredObject = {
  body: ReadableStream<Uint8Array>;
  size: number;
  /** Present when a range was served. */
  range?: { offset: number; length: number };
};

/** Private object storage. Object keys are stable; URLs are never stored (specs/11). */
export interface ObjectStore {
  get(key: string, range?: ByteRange): Promise<StoredObject | null>;
}

/** Cloudflare R2 bucket binding. The bucket stays private; the API is the only reader. */
export class R2ObjectStore implements ObjectStore {
  constructor(private readonly bucket: R2Bucket) {}

  async get(key: string, range?: ByteRange): Promise<StoredObject | null> {
    const object = await this.bucket.get(key, range ? { range } : undefined);
    if (!object || !("body" in object)) return null;
    const served = object.range as { offset?: number; length?: number } | undefined;
    return {
      body: object.body,
      size: object.size,
      ...(range && served
        ? {
            range: {
              offset: served.offset ?? range.offset,
              length: served.length ?? object.size - (served.offset ?? range.offset),
            },
          }
        : {}),
    };
  }
}

/** In-memory store for tests and local development without R2. */
export class MemoryObjectStore implements ObjectStore {
  private readonly objects = new Map<string, Uint8Array>();

  put(key: string, bytes: Uint8Array) {
    this.objects.set(key, bytes);
  }

  async get(key: string, range?: ByteRange): Promise<StoredObject | null> {
    const bytes = this.objects.get(key);
    if (!bytes) return null;
    const offset = range?.offset ?? 0;
    const end = range?.length !== undefined ? offset + range.length : bytes.length;
    const slice = bytes.slice(offset, Math.min(end, bytes.length));
    return {
      body: new Response(slice).body!,
      size: bytes.length,
      ...(range ? { range: { offset, length: slice.length } } : {}),
    };
  }
}
