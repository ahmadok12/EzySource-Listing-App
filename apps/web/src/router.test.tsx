import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { createMemoryRouter, RouterProvider } from "react-router-dom";
import type { MeResponse } from "@ezysource/domain";
import { AuthProvider } from "./auth/AuthProvider";
import type { AuthAdapter } from "./auth/adapter";
import { safeNext } from "./auth/next";
import { buildRoutes } from "./router";
import { adminNav, MAX_MOBILE_NAV_ITEMS, memberNav, visibleNav } from "./shells/navigation";

const USER_ID = "00000000-0000-4000-8000-000000000001";

function fakeAdapter(signedIn: boolean): AuthAdapter & { sendCode: ReturnType<typeof vi.fn> } {
  let token: string | null = signedIn ? "token" : null;
  const listeners = new Set<(s: boolean) => void>();
  return {
    getAccessToken: async () => token,
    onChange: (l) => {
      listeners.add(l);
      return () => listeners.delete(l);
    },
    sendCode: vi.fn(async () => {}),
    verifyCode: vi.fn(async () => {
      token = "token";
      listeners.forEach((l) => l(true));
    }),
    mfaStatus: async () => ({ currentLevel: "aal1", factorId: "factor-1" }),
    enrollMfa: async () => ({ factorId: "f", qrCodeSvg: "data:image/svg+xml,", secret: "S" }),
    verifyMfa: async () => {},
    signOut: async () => {
      token = null;
      listeners.forEach((l) => l(false));
    },
  };
}

function mockApi(me: MeResponse | null) {
  vi.stubGlobal(
    "fetch",
    vi.fn(async (url: string) => {
      if (url === "/api/me" && me) return Response.json(me);
      if (url === "/api/admin/staff") {
        return Response.json({
          staff: [{ userId: USER_ID, displayName: "Ahmad", state: "active", roles: ["owner"] }],
        });
      }
      return Response.json(
        { error: { code: "unauthenticated", message: "Please sign in again.", requestId: "r" } },
        { status: 401 },
      );
    }),
  );
}

function me(staffRoles: MeResponse["staffRoles"], mfaRequired = false): MeResponse {
  return {
    user: { id: USER_ID, displayName: "Ahmad" },
    staffRoles,
    assuranceLevel: mfaRequired ? "aal1" : "aal2",
    mfaRequired,
  };
}

function renderAt(path: string, opts: { adapter?: AuthAdapter | null; previewShells?: boolean } = {}) {
  const router = createMemoryRouter(buildRoutes({ previewShells: opts.previewShells ?? false }), {
    initialEntries: [path],
  });
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(
    <QueryClientProvider client={queryClient}>
      <AuthProvider adapter={opts.adapter ?? null}>
        <RouterProvider router={router} />
      </AuthProvider>
    </QueryClientProvider>,
  );
  return router;
}

afterEach(() => vi.unstubAllGlobals());

describe("public pages", () => {
  it("renders the home page without a sign-in button when auth isn't configured", () => {
    renderAt("/");
    expect(screen.getByRole("heading", { level: 1 }).textContent).toMatch(/Futian/);
    expect(screen.queryByRole("link", { name: "Sign in" })).toBeNull();
  });

  it("says plainly when sign-in isn't configured", () => {
    renderAt("/login");
    expect(screen.getByText("Sign-in isn't set up yet")).toBeTruthy();
  });

  it("hides unfinished areas when previews are off", () => {
    renderAt("/admin/review", { adapter: fakeAdapter(true) });
    expect(screen.getByRole("heading", { name: "Page not found" })).toBeTruthy();
  });
});

describe("sign-in flow", () => {
  it("sends a code, verifies it and lands a member on their account", async () => {
    mockApi(me([]));
    const adapter = fakeAdapter(false);
    const router = renderAt("/login", { adapter });

    fireEvent.change(await screen.findByLabelText("Email"), { target: { value: "a@example.com" } });
    fireEvent.click(screen.getByRole("button", { name: "Email me a code" }));
    expect(adapter.sendCode).toHaveBeenCalledWith("a@example.com");

    fireEvent.change(await screen.findByLabelText("Code"), { target: { value: "123456" } });
    fireEvent.click(screen.getByRole("button", { name: "Sign in" }));
    await waitFor(() => expect(router.state.location.pathname).toBe("/account"));
    expect(await screen.findByText("Ahmad")).toBeTruthy();
  });

  it("sends staff who still need MFA to the two-step page", async () => {
    mockApi(me(["owner"], true));
    const router = renderAt("/login", { adapter: fakeAdapter(false) });
    fireEvent.change(await screen.findByLabelText("Email"), { target: { value: "a@example.com" } });
    fireEvent.click(screen.getByRole("button", { name: "Email me a code" }));
    fireEvent.change(await screen.findByLabelText("Code"), { target: { value: "123456" } });
    fireEvent.click(screen.getByRole("button", { name: "Sign in" }));
    await waitFor(() => expect(router.state.location.pathname).toBe("/login/mfa"));
  });

  it("offers password sign-in only on testing builds", async () => {
    mockApi(me(["collector"]));
    const adapter = {
      ...fakeAdapter(false),
      signInWithPassword: vi.fn(async () => {}),
    };
    renderAt("/login", { adapter });
    await screen.findByLabelText("Email");
    expect(screen.queryByRole("button", { name: /Use a password/ })).toBeNull();
    cleanup();

    vi.stubEnv("VITE_ALLOW_PASSWORD_SIGN_IN", "true");
    const router = renderAt("/login", { adapter });
    fireEvent.click(await screen.findByRole("button", { name: /Use a password/ }));
    fireEvent.change(screen.getByLabelText("Email"), { target: { value: "test@example.com" } });
    fireEvent.change(screen.getByLabelText("Password"), { target: { value: "long test password" } });
    fireEvent.click(screen.getByRole("button", { name: "Sign in" }));
    await waitFor(() => expect(router.state.location.pathname).toBe("/admin"));
    expect(adapter.signInWithPassword).toHaveBeenCalledWith("test@example.com", "long test password");
    vi.unstubAllEnvs();
  });

  it("ignores off-site post-login destinations", () => {
    expect(safeNext("/admin/staff")).toBe("/admin/staff");
    expect(safeNext("//evil.example")).toBeNull();
    expect(safeNext("https://evil.example")).toBeNull();
    expect(safeNext("/\\evil.example")).toBeNull();
  });
});

describe("guards", () => {
  it("send signed-out visitors to sign in, keeping where they were going", async () => {
    mockApi(null);
    const router = renderAt("/admin/staff", { adapter: fakeAdapter(false) });
    await waitFor(() => expect(router.state.location.pathname).toBe("/login"));
    expect(router.state.location.search).toBe(`?next=${encodeURIComponent("/admin/staff")}`);
  });

  it("keep members out of admin", async () => {
    mockApi(me([]));
    renderAt("/admin/staff", { adapter: fakeAdapter(true) });
    expect(await screen.findByText("You don't have access to this")).toBeTruthy();
  });

  it("require MFA before admin pages", async () => {
    mockApi(me(["admin"], true));
    const router = renderAt("/admin/staff", { adapter: fakeAdapter(true) });
    await waitFor(() => expect(router.state.location.pathname).toBe("/login/mfa"));
  });

  it("let an owner with MFA see staff", async () => {
    mockApi(me(["owner"]));
    renderAt("/admin/staff", { adapter: fakeAdapter(true) });
    expect(await screen.findByRole("heading", { name: "Staff" })).toBeTruthy();
    expect(await screen.findByText("owner")).toBeTruthy();
  });
});

describe("navigation", () => {
  it("keeps mobile bottom navigation to five destinations or fewer", () => {
    for (const nav of [memberNav, adminNav]) {
      expect(nav.filter((item) => item.mobile).length).toBeLessThanOrEqual(MAX_MOBILE_NAV_ITEMS);
    }
  });

  it("shows only built, permitted items outside previews", () => {
    const collector = visibleNav(adminNav, { previewShells: false, staffRoles: ["collector"] });
    expect(collector.map((i) => i.label)).toEqual(["Collection"]);
    const mapper = visibleNav(adminNav, { previewShells: false, staffRoles: ["mapper"] });
    expect(mapper).toEqual([]);
    const owner = visibleNav(adminNav, { previewShells: false, staffRoles: ["owner"] });
    expect(owner.map((i) => i.label)).toEqual(["Collection", "Staff"]);
  });
});
