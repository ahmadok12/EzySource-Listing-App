import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { Draft, DraftMedia } from "@ezysource/domain";
import { MediaSection } from "./media";
import { MediaFileError, prepareFile, sha256Hex } from "./prepareMedia";
import { IndexedDbUploadStore, UploadQueue, type NewUpload, type QueuedUpload } from "./uploads";

const DRAFT = "00000000-0000-4000-8000-0000000000b1";
const OTHER_DRAFT = "00000000-0000-4000-8000-0000000000b9";
const USER = "00000000-0000-4000-8000-000000000001";

type Reply = Response | (() => Response | Promise<Response>);

/** Answers fetch calls in order for each "METHOD /path" and records what was sent. */
function mockApi(routes: Record<string, Reply[]>) {
  const calls: Array<{ method: string; path: string; body: unknown }> = [];
  vi.stubGlobal(
    "fetch",
    vi.fn(async (url: string, init: RequestInit = {}) => {
      const method = init.method ?? "GET";
      const path = url.replace(/^\/api/, "");
      const key = `${method} ${path.replace(/\/uploads\/[^/]+\/content/, "/uploads/:id/content")}`;
      calls.push({ method, path, body: typeof init.body === "string" ? JSON.parse(init.body) : init.body });
      const reply = routes[key]?.shift();
      if (!reply) throw new Error(`Unexpected ${key}`);
      return typeof reply === "function" ? reply() : reply;
    }),
  );
  return calls;
}

const offline = () => {
  throw new TypeError("Failed to fetch");
};

function media(id: string, overrides: Partial<DraftMedia> = {}): DraftMedia {
  return {
    id,
    purpose: "overview",
    contactId: null,
    caption: null,
    visibility: "subscriber",
    orderIndex: 0,
    kind: "image",
    mimeType: "image/jpeg",
    sizeBytes: 4,
    width: null,
    height: null,
    durationMs: null,
    state: "validated",
    createdAt: "2026-10-13T02:00:00.000Z",
    ...overrides,
  };
}

const ok = (id: string) => () => Response.json({ media: media(id) });
const error = (status: number, code: string, message = "No") =>
  Response.json({ error: { code, message, requestId: "r" } }, { status });

function upload(overrides: Partial<NewUpload> = {}): NewUpload {
  return {
    id: crypto.randomUUID(),
    draftId: DRAFT,
    purpose: "overview",
    contactId: null,
    caption: null,
    blob: new Blob([new Uint8Array([0xff, 0xd8, 0xff, 0xe0])], { type: "image/jpeg" }),
    mimeType: "image/jpeg",
    sizeBytes: 4,
    sha256: "a".repeat(64),
    width: null,
    height: null,
    durationMs: null,
    ...overrides,
  };
}

/** Resolves once the queue has no file mid-upload. */
async function settled(queue: UploadQueue) {
  await vi.waitFor(() => {
    expect(queue.getSnapshot().some((i) => i.state === "uploading")).toBe(false);
  });
}

describe("upload queue", () => {
  let store: IndexedDbUploadStore;
  let queue: UploadQueue;

  beforeEach(async () => {
    store = new IndexedDbUploadStore();
    for (const item of await store.list(USER)) await store.remove(item.id);
    queue = new UploadQueue(store, () => 0.5);
    await queue.start(USER);
  });

  afterEach(() => {
    queue.stop();
    vi.unstubAllGlobals();
  });

  it("keeps the file on the phone, sends it, then tells the shop screen", async () => {
    const item = upload();
    const calls = mockApi({ "POST /uploads/intents": [ok(item.id)], "PUT /uploads/:id/content": [ok(item.id)] });
    const uploaded = vi.fn();
    queue.onUploaded = uploaded;

    await queue.add(item);
    await vi.waitFor(() => expect(uploaded).toHaveBeenCalledWith(DRAFT, expect.objectContaining({ id: item.id })));
    expect(calls.map((c) => `${c.method} ${c.path}`)).toEqual([
      "POST /uploads/intents",
      `PUT /uploads/${item.id}/content`,
    ]);
    expect(calls[0]!.body).toMatchObject({ id: item.id, revisionId: DRAFT, purpose: "overview", sizeBytes: 4 });
    expect(queue.getSnapshot()).toEqual([]);
    expect(await store.list(USER)).toEqual([]);
  });

  it("waits and retries with the same ID when the connection drops", async () => {
    const item = upload();
    const calls = mockApi({
      "POST /uploads/intents": [offline, ok(item.id)],
      "PUT /uploads/:id/content": [ok(item.id)],
    });
    await queue.add(item);
    await settled(queue);
    const [waiting] = queue.getSnapshot();
    expect(waiting).toMatchObject({ id: item.id, state: "waiting", attempts: 1 });
    expect(waiting!.retryAt).toBeGreaterThan(Date.now());
    expect((await store.list(USER))[0]).toMatchObject({ id: item.id, state: "waiting" });

    queue.wake();
    await vi.waitFor(() => expect(queue.getSnapshot()).toEqual([]));
    expect(calls.filter((c) => c.method === "POST").map((c) => (c.body as { id: string }).id)).toEqual([
      item.id,
      item.id,
    ]);
  });

  it("stops and explains when access to the shop has ended", async () => {
    const item = upload();
    mockApi({ "POST /uploads/intents": [error(404, "not_found")] });
    await queue.add(item);
    await settled(queue);
    expect(queue.getSnapshot()[0]).toMatchObject({
      state: "failed",
      error: "You can't add files to this shop any more.",
    });
  });

  it("restarts a cancelled upload under a new ID, keeping its shop and section", async () => {
    const item = upload({ draftId: OTHER_DRAFT, purpose: "section" });
    const calls = mockApi({
      "POST /uploads/intents": [ok(item.id), () => Response.json({ media: media("00000000-0000-4000-8000-00000000ccc1") })],
      "PUT /uploads/:id/content": [error(409, "conflict"), () => Response.json({ media: media("00000000-0000-4000-8000-00000000ccc1") })],
    });
    await queue.add(item);
    await vi.waitFor(() => expect(queue.getSnapshot()).toEqual([]));
    const intents = calls.filter((c) => c.method === "POST").map((c) => c.body as { id: string; revisionId: string; purpose: string });
    expect(intents[1]!.id).not.toBe(item.id);
    expect(intents[1]).toMatchObject({ revisionId: OTHER_DRAFT, purpose: "section" });
  });

  it("comes back after the app is reopened, only for the same person", async () => {
    mockApi({ "POST /uploads/intents": [offline] });
    const item = upload();
    await queue.add(item);
    await settled(queue);
    queue.stop();

    const reopened = new UploadQueue(store);
    mockApi({});
    await reopened.start("someone-else");
    expect(reopened.getSnapshot()).toEqual([]);
    reopened.stop();

    const again = new UploadQueue(store);
    mockApi({ "POST /uploads/intents": [offline] });
    await again.start(USER);
    expect(again.getSnapshot().map((i) => i.id)).toEqual([item.id]);
    again.stop();
  });

  it("sends at most two files at a time", async () => {
    let inFlight = 0;
    let most = 0;
    const slow = (id: string) => async () => {
      inFlight++;
      most = Math.max(most, inFlight);
      await new Promise((r) => setTimeout(r, 10));
      inFlight--;
      return Response.json({ media: media(id) });
    };
    const items = [upload(), upload(), upload(), upload()];
    mockApi({
      "POST /uploads/intents": items.map((i) => slow(i.id)),
      "PUT /uploads/:id/content": items.map((i) => slow(i.id)),
    });
    for (const item of items) await queue.add(item);
    await vi.waitFor(() => expect(queue.getSnapshot()).toEqual([]));
    expect(most).toBe(2);
  });
});

describe("preparing files", () => {
  it("accepts PDFs for products only, and fingerprints the file", async () => {
    const pdf = new Blob(["%PDF-1.7 test"], { type: "application/pdf" });
    const prepared = await prepareFile(pdf, "section");
    expect(prepared).toMatchObject({ mimeType: "application/pdf", sizeBytes: pdf.size });
    expect(prepared.sha256).toBe(await sha256Hex(pdf));
    await expect(prepareFile(pdf, "overview")).rejects.toBeInstanceOf(MediaFileError);
  });

  it("refuses SVG, oversize files and long recordings before anything is queued", async () => {
    await expect(prepareFile(new Blob(["<svg/>"], { type: "image/svg+xml" }), "overview")).rejects.toThrow(
      MediaFileError,
    );
    const big = new Blob([new Uint8Array(26 * 1024 * 1024)], { type: "application/pdf" });
    await expect(prepareFile(big, "section")).rejects.toThrow("The limit is 25 MB");
    const voice = new Blob(["x"], { type: "audio/webm;codecs=opus" });
    await expect(prepareFile(voice, "voice", { durationMs: 6 * 60_000 })).rejects.toThrow("5 minutes");
    expect((await prepareFile(voice, "voice", { durationMs: 30_000 })).mimeType).toBe("audio/webm");
  });
});

describe("media section", () => {
  afterEach(() => vi.unstubAllGlobals());

  function draft(items: DraftMedia[]): Draft {
    return {
      id: DRAFT,
      shopId: "00000000-0000-4000-8000-0000000000b2",
      version: 1,
      state: "draft",
      nameZh: null,
      nameEn: "Lucky Toys",
      companyName: null,
      description: null,
      districtId: null,
      floorId: null,
      boothNumber: null,
      categories: [],
      keywords: [],
      contacts: [],
      sharedChannels: [],
      media: items,
      sessionId: null,
      collectorId: USER,
      createdAt: "2026-10-13T02:00:00.000Z",
      updatedAt: "2026-10-13T02:00:00.000Z",
    };
  }

  it("says where each file is: saved, on this phone, or not sent", () => {
    vi.stubGlobal("fetch", vi.fn(() => new Promise(() => {})));
    const queued: QueuedUpload[] = [
      { ...upload({ id: "00000000-0000-4000-8000-00000000aaa1" }), userId: USER, state: "waiting", attempts: 0, createdAt: "2026-10-13T03:00:00.000Z" },
      { ...upload({ id: "00000000-0000-4000-8000-00000000aaa2" }), userId: USER, state: "failed", error: "No", attempts: 6, createdAt: "2026-10-13T03:00:01.000Z" },
      { ...upload({ draftId: OTHER_DRAFT }), userId: USER, state: "waiting", attempts: 0, createdAt: "2026-10-13T03:00:02.000Z" },
    ];
    render(
      <QueryClientProvider client={new QueryClient()}>
        <MediaSection
          draft={draft([media("00000000-0000-4000-8000-00000000bbb1")])}
          queue={queued}
          purpose="overview"
          title="Shop photos"
          addLabel="Add shop photos"
        />
      </QueryClientProvider>,
    );
    expect(screen.getByRole("button", { name: "Photo, saved" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "Photo, saved on this phone" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "Photo, not sent" })).toBeTruthy();
    expect(screen.getAllByRole("button", { name: /^Photo/ })).toHaveLength(3);
    expect(screen.getByText("Cover")).toBeTruthy();
    expect(screen.getByText(/Photos up to 15 MB/)).toBeTruthy();
    // Desktop: choose files, but no camera button.
    expect(screen.queryByRole("button", { name: /Take photo/ })).toBeNull();
  });
});
