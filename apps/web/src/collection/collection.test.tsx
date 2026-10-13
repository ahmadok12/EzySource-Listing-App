import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { createMemoryRouter, RouterProvider } from "react-router-dom";
import type { CollectionContext, CollectionReference, Draft, MeResponse } from "@ezysource/domain";
import { AuthProvider } from "../auth/AuthProvider";
import type { AuthAdapter } from "../auth/adapter";
import { buildRoutes } from "../router";
import { emptyShopForm, parseKeywords, toCreateInput } from "./form";
import { localDrafts } from "./localDrafts";

const USER = "00000000-0000-4000-8000-000000000001";
const D1 = "00000000-0000-4000-8000-0000000000d1";
const F2 = "00000000-0000-4000-8000-0000000000f2";
const TOYS = "00000000-0000-4000-8000-0000000000c1";
const SESSION = "00000000-0000-4000-8000-0000000000a1";
const DRAFT = "00000000-0000-4000-8000-0000000000b1";

const reference: CollectionReference = {
  markets: [
    {
      id: "00000000-0000-4000-8000-0000000000e1",
      nameEn: "Futian",
      nameZh: null,
      districts: [{ id: D1, code: "D1", nameEn: "District 1", nameZh: null, floors: [{ id: F2, label: "F2" }] }],
    },
  ],
  categories: [{ id: TOYS, parentId: null, slug: "toys", nameEn: "Toys", nameZh: "玩具" }],
};

const context: CollectionContext = {
  policy: { mode: "review_then_submit", allowOfflineCapture: true, grantDeadline: null },
  session: {
    id: SESSION,
    districtId: D1,
    floorId: F2,
    defaultCategoryId: TOYS,
    startedAt: "2026-10-13T01:00:00.000Z",
    finishedAt: null,
  },
};

const me: MeResponse = {
  user: { id: USER, displayName: "Li" },
  staffRoles: ["collector"],
  assuranceLevel: "aal1",
  mfaRequired: false,
};

function draft(overrides: Partial<Draft> = {}): Draft {
  return {
    id: DRAFT,
    shopId: "00000000-0000-4000-8000-0000000000b2",
    version: 1,
    state: "draft",
    nameZh: null,
    nameEn: "Lucky Toys",
    companyName: null,
    description: null,
    districtId: D1,
    floorId: F2,
    boothNumber: "10234",
    categories: [{ id: TOYS, isPrimary: true }],
    keywords: [],
    contacts: [
      {
        id: "00000000-0000-4000-8000-0000000000c9",
        displayName: "Ms Chen",
        title: null,
        isPrimary: true,
        channels: [{ id: "00000000-0000-4000-8000-0000000000c8", type: "phone", value: "13800000000", label: null }],
      },
    ],
    sharedChannels: [],
    media: [],
    sessionId: SESSION,
    collectorId: USER,
    createdAt: "2026-10-13T02:00:00.000Z",
    updatedAt: "2026-10-13T02:00:00.000Z",
    ...overrides,
  };
}

type Call = { method: string; url: string; headers: Record<string, string>; body: unknown };
type Handler = (call: Call) => Response | Promise<Response>;

/** Routes fetch calls to handlers keyed by "METHOD /path". */
function mockApi(handlers: Record<string, Handler>) {
  const calls: Call[] = [];
  vi.stubGlobal(
    "fetch",
    vi.fn(async (url: string, init: RequestInit = {}) => {
      const call: Call = {
        method: init.method ?? "GET",
        url,
        headers: (init.headers ?? {}) as Record<string, string>,
        body: init.body ? JSON.parse(String(init.body)) : undefined,
      };
      calls.push(call);
      const path = url.replace(/^\/api/, "").split("?")[0];
      const handler =
        handlers[`${call.method} ${path}`] ??
        (call.method === "GET" && path === "/me" ? () => Response.json(me) : undefined) ??
        (path === "/collection/reference" ? () => Response.json(reference) : undefined) ??
        (path === "/collection/context" ? () => Response.json(context) : undefined) ??
        (path === "/drafts" && call.method === "GET" ? () => Response.json({ drafts: [], nextCursor: null }) : undefined);
      if (!handler) throw new Error(`Unexpected ${call.method} ${url}`);
      return handler(call);
    }),
  );
  return calls;
}

function adapter(): AuthAdapter {
  return {
    getAccessToken: async () => "token",
    onChange: () => () => {},
    sendCode: async () => {},
    verifyCode: async () => {},
    mfaStatus: async () => ({ currentLevel: "aal1", factorId: null }),
    enrollMfa: async () => ({ factorId: "f", qrCodeSvg: "", secret: "" }),
    verifyMfa: async () => {},
    signOut: async () => {},
  };
}

function renderAt(path: string) {
  const router = createMemoryRouter(buildRoutes({ previewShells: false }), { initialEntries: [path] });
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(
    <QueryClientProvider client={client}>
      <AuthProvider adapter={adapter()}>
        <RouterProvider router={router} />
      </AuthProvider>
    </QueryClientProvider>,
  );
  return router;
}

const type = (label: string, value: string) =>
  fireEvent.change(screen.getByLabelText(label), { target: { value } });

beforeEach(async () => {
  for (const d of await localDrafts.list(USER)) await localDrafts.remove(d.localId);
  for (const d of await localDrafts.list("someone-else")) await localDrafts.remove(d.localId);
});

afterEach(() => vi.unstubAllGlobals());

describe("shop form rules", () => {
  it("needs something meaningful and checks contact formats", () => {
    const form = emptyShopForm(context.session);
    const empty = toCreateInput(form, null);
    expect(empty.ok).toBe(false);
    expect(!empty.ok && empty.errors._form).toMatch(/name, booth number or contact/);

    const badEmail = toCreateInput({ ...form, nameEn: "x", email: "nope" }, null);
    expect(!badEmail.ok && badEmail.errors.email).toBe("Enter a valid email address.");

    const good = toCreateInput({ ...form, boothNumber: "0123", phone: "138 0000 0000", keywords: "plush, 毛绒、Plush" }, null);
    expect(good.ok && good.input).toMatchObject({
      boothNumber: "0123",
      districtId: D1,
      floorId: F2,
      categoryIds: [TOYS],
      contacts: [{ channels: [{ type: "phone", value: "138 0000 0000" }] }],
    });
    expect(parseKeywords("plush, 毛绒、Plush")).toEqual([
      { keyword: "plush", language: "und" },
      { keyword: "毛绒", language: "zh" },
    ]);
  });
});

describe("collector screens", () => {
  it("shows the session and offers New shop", async () => {
    mockApi({});
    renderAt("/admin/collection");
    expect(await screen.findByText("D1 · F2")).toBeTruthy();
    expect(screen.getByText("Toys")).toBeTruthy();
    expect(screen.getByRole("button", { name: "New shop" })).toBeTruthy();
    expect(await screen.findByText("Shops you save appear here.")).toBeTruthy();
  });

  it("saves a new shop with the session defaults and opens it", async () => {
    const calls = mockApi({
      "POST /drafts": () => Response.json({ draft: draft() }, { status: 201 }),
      [`GET /drafts/${DRAFT}`]: () => Response.json({ draft: draft() }),
    });
    const router = renderAt("/admin/collection/new");
    await screen.findByLabelText("English name");
    // Session defaults are pre-selected.
    expect(screen.getByRole("radio", { name: "D1" }).getAttribute("aria-checked")).toBe("true");
    expect(screen.getByRole("radio", { name: "Toys" }).getAttribute("aria-checked")).toBe("true");

    type("English name", "Lucky Toys");
    type("Phone", "13800000000");
    expect(await screen.findByText("Saved on this phone")).toBeTruthy();
    expect(await localDrafts.list(USER)).toHaveLength(1);

    fireEvent.click(screen.getByRole("button", { name: "Save shop" }));
    expect(await screen.findByText("Shop saved")).toBeTruthy();
    expect(router.state.location.pathname).toBe(`/admin/drafts/${DRAFT}`);
    expect(screen.getByRole("button", { name: "Next shop" })).toBeTruthy();

    const post = calls.find((c) => c.method === "POST")!;
    expect(post.headers["idempotency-key"]).toMatch(/^[0-9a-f-]{36}$/);
    expect(post.body).toMatchObject({ nameEn: "Lucky Toys", districtId: D1, floorId: F2, categoryIds: [TOYS] });
    expect(await localDrafts.list(USER)).toEqual([]);
  });

  it("keeps the shop on the phone when offline and retries with the same key", async () => {
    let online = false;
    const calls = mockApi({
      "POST /drafts": () => {
        if (!online) throw new TypeError("Failed to fetch");
        return Response.json({ draft: draft() }, { status: 201 });
      },
      [`GET /drafts/${DRAFT}`]: () => Response.json({ draft: draft() }),
    });
    renderAt("/admin/collection/new");
    await screen.findByLabelText("English name");
    type("Booth number", "10234");
    fireEvent.click(screen.getByRole("button", { name: "Save shop" }));
    expect(await screen.findByText("Saved on this phone. It will be sent when you're back online.")).toBeTruthy();
    await waitFor(async () =>
      expect(await localDrafts.list(USER)).toMatchObject([{ lastError: "network", form: { boothNumber: "10234" } }]),
    );
    const [stored] = await localDrafts.list(USER);

    online = true;
    window.dispatchEvent(new Event("online"));
    expect(await screen.findByText("Shop saved")).toBeTruthy();
    const posts = calls.filter((c) => c.method === "POST");
    expect(posts).toHaveLength(2);
    expect(posts[1]!.headers["idempotency-key"]).toBe(posts[0]!.headers["idempotency-key"]);
    expect(posts[0]!.headers["idempotency-key"]).toBe(stored!.idempotencyKey);
  });

  it("asks before leaving a typed form", async () => {
    mockApi({});
    const router = renderAt("/admin/collection/new");
    await screen.findByLabelText("English name");
    type("English name", "Half typed");
    void router.navigate("/account");
    expect(await screen.findByRole("dialog", { name: "Save this shop first?" })).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Continue editing" }));
    expect(router.state.location.pathname).toBe("/admin/collection/new");
    expect((screen.getByLabelText("English name") as HTMLInputElement).value).toBe("Half typed");
  });

  it("restores unsent work only for the person who typed it", async () => {
    await localDrafts.put({
      localId: "local-other",
      userId: "someone-else",
      idempotencyKey: "key-other-123",
      sessionId: null,
      form: { ...emptyShopForm(null), nameEn: "Not yours" },
      updatedAt: new Date().toISOString(),
    });
    await localDrafts.put({
      localId: "local-mine",
      userId: USER,
      idempotencyKey: "key-mine-123",
      sessionId: null,
      form: { ...emptyShopForm(null), nameEn: "Mine" },
      updatedAt: new Date().toISOString(),
    });

    mockApi({});
    renderAt("/admin/collection/new?local=local-other");
    expect(await screen.findByText(/isn't on this phone any more/)).toBeTruthy();
    expect((screen.getByLabelText("English name") as HTMLInputElement).value).toBe("");
  });

  it("refuses a stale edit and offers to reload", async () => {
    mockApi({
      [`GET /drafts/${DRAFT}`]: () => Response.json({ draft: draft() }),
      [`PATCH /drafts/${DRAFT}`]: () =>
        Response.json(
          { error: { code: "conflict", message: "This shop was changed somewhere else.", requestId: "r" } },
          { status: 409 },
        ),
    });
    renderAt(`/admin/drafts/${DRAFT}`);
    expect(await screen.findByRole("heading", { name: "Lucky Toys" })).toBeTruthy();
    expect(screen.getByText("Main contact")).toBeTruthy();

    fireEvent.click(screen.getAllByRole("button", { name: "Edit" })[0]!);
    type("English name", "Renamed");
    fireEvent.click(screen.getByRole("button", { name: "Save changes" }));
    expect(await screen.findByText("This shop was changed somewhere else.")).toBeTruthy();
    expect(screen.getByRole("button", { name: "Reload" })).toBeTruthy();
  });

  it("explains when a shop is no longer available", async () => {
    mockApi({
      [`GET /drafts/${DRAFT}`]: () =>
        Response.json({ error: { code: "not_found", message: "Not found.", requestId: "r" } }, { status: 404 }),
    });
    renderAt(`/admin/drafts/${DRAFT}`);
    expect(await screen.findByText("This shop isn't available to you")).toBeTruthy();
  });
});
