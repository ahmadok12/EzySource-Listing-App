import type { RouteObject } from "react-router-dom";
import { AppShell } from "./shells/AppShell";
import { PublicShell } from "./shells/PublicShell";
import { adminNav, memberNav, type NavItem } from "./shells/navigation";
import { HomePage } from "./pages/HomePage";
import { NotFoundPage } from "./pages/NotFoundPage";
import { PlannedPage } from "./pages/PlannedPage";

function plannedRoutes(nav: NavItem[]): RouteObject[] {
  return nav.map((item) => ({
    path: item.to,
    element: <PlannedPage title={item.label} milestone={item.milestone} />,
  }));
}

/**
 * Member and admin areas are registered only when shell previews are on.
 * Server-side authorisation is still mandatory once real routes exist (specs/02).
 */
export function buildRoutes({ previewShells }: { previewShells: boolean }): RouteObject[] {
  const routes: RouteObject[] = [
    {
      element: <PublicShell />,
      children: [{ path: "/", element: <HomePage /> }],
    },
  ];

  if (previewShells) {
    routes.push(
      { element: <AppShell area="Member" nav={memberNav} />, children: plannedRoutes(memberNav) },
      { element: <AppShell area="Admin" nav={adminNav} />, children: plannedRoutes(adminNav) },
    );
  }

  routes.push({ element: <PublicShell />, children: [{ path: "*", element: <NotFoundPage /> }] });
  return routes;
}
