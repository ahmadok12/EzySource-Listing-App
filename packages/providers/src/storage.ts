/** A byte range request, inclusive start, optional length. */
export type ByteRange = { offset: number; length?: number };

export type StoredObject = {
  body: ReadableStream<Uint8Array>;
  size: number;
  /** Present when a range was served. */
  range?: { offset: number; length: number };
};

export type PutOptions = {
  /** Exact byte count. A body of any other length fails. */
  size: number;
  /** Lower-case hex SHA-256 the stored bytes must match. */
  sha256: string;
  contentType: string;
};

/** The stored bytes didn't match the checksum the phone sent. Nothing is kept. */
export class ChecksumMismatchError extends Error {
  constructor() {
    super("The uploaded bytes don't match their checksum.");
  }
}

/** Private object storage. Object keys are stable; URLs are never stored (specs/11). */
export interface ObjectStore {
  get(key: string, range?: ByteRange): Promise<StoredObject | null>;
  /** Stores bytes, verifying size and checksum before they count as written. */
  put(key: string, body: ReadableStream<Uint8Array>, options: PutOptions): Promise<void>;
  delete(key: string): Promise<void>;
}

async function readAll(body: ReadableStream<Uint8Array>) {
  return new Uint8Array(await new Response(body).arrayBuffer());
}

export async function sha256Hex(bytes: Uint8Array | ArrayBuffer) {
  const digest = await crypto.subtle.digest("SHA-256", bytes as ArrayBuffer);
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, "0")).join("");
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

  async put(key: string, body: ReadableStream<Uint8Array>, options: PutOptions) {
    // R2 needs a known length; FixedLengthStream also fails a body that is longer or shorter.
    const { readable, writable } = new FixedLengthStream(options.size);
    const piped = body.pipeTo(writable).catch(() => {});
    try {
      await this.bucket.put(key, readable, {
        sha256: options.sha256,
        httpMetadata: { contentType: options.contentType },
      });
    } catch (error) {
      if (error instanceof Error && /checksum|sha-?256|digest/i.test(error.message)) {
        throw new ChecksumMismatchError();
      }
      throw error;
    } finally {
      await piped;
    }
  }

  async delete(key: string) {
    await this.bucket.delete(key);
  }
}

/** In-memory store for tests and local development without R2. */
export class MemoryObjectStore implements ObjectStore {
  private readonly objects = new Map<string, Uint8Array>();

  /** Test helper: stores bytes without checks. */
  set(key: string, bytes: Uint8Array) {
    this.objects.set(key, bytes);
  }

  has(key: string) {
    return this.objects.has(key);
  }

  async put(key: string, body: ReadableStream<Uint8Array>, options: PutOptions) {
    const bytes = await readAll(body);
    if (bytes.length !== options.size) throw new Error("Body length doesn't match the declared size.");
    if ((await sha256Hex(bytes)) !== options.sha256) throw new ChecksumMismatchError();
    this.objects.set(key, bytes);
  }

  async delete(key: string) {
    this.objects.delete(key);
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
