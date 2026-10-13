import { describe, expect, it } from "vitest";
import { render, screen } from "@testing-library/react";
import { createMemoryRouter, RouterProvider } from "react-router-dom";
import { buildRoutes } from "./router";
import { adminNav, MAX_MOBILE_NAV_ITEMS, memberNav } from "./shells/navigation";

function renderAt(path: string, previewShells: boolean) {
  const router = createMemoryRouter(buildRoutes({ previewShells }), { initialEntries: [path] });
  return render(<RouterProvider router={router} />);
}

describe("routes", () => {
  it("renders the public home page", () => {
    renderAt("/", false);
    expect(screen.getByRole("heading", { level: 1 }).textContent).toMatch(/Futian/);
  });

  it("hides unfinished member and admin areas when previews are off", () => {
    renderAt("/admin/collection", false);
    expect(screen.getByRole("heading", { name: "Page not found" })).toBeTruthy();
  });

  it("shows admin shell previews with honest placeholders", () => {
    renderAt("/admin/collection", true);
    expect(screen.getByRole("heading", { name: "Collection" })).toBeTruthy();
    expect(screen.getByText(/Planned for milestone 1/)).toBeTruthy();
  });

  it("keeps mobile bottom navigation to five destinations or fewer", () => {
    for (const nav of [memberNav, adminNav]) {
      expect(nav.filter((item) => item.mobile).length).toBeLessThanOrEqual(MAX_MOBILE_NAV_ITEMS);
    }
  });
});
