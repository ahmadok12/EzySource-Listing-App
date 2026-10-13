import type { RouteObject } from "react-router-dom";
import { RequireAuth } from "./auth/guards";
import { AppShell } from "./shells/AppShell";
import { PublicShell } from "./shells/PublicShell";
import { adminNav, memberNav, type NavItem } from "./shells/navigation";
import { AccountPage } from "./pages/AccountPage";
import { HomePage } from "./pages/HomePage";
import { LoginPage } from "./pages/LoginPage";
import { MfaPage } from "./pages/MfaPage";
import { NotFoundPage } from "./pages/NotFoundPage";
import { PlannedPage } from "./pages/PlannedPage";
import { AdminHomePage } from "./pages/admin/AdminHomePage";
import { StaffPage } from "./pages/admin/StaffPage";

/** Unfinished destinations are registered only when previews are on. */
function plannedRoutes(nav: NavItem[], previewShells: boolean): RouteObject[] {
  if (!previewShells) return [];
  return nav
    .filter((item) => !item.ready)
    .map((item) => ({
      path: item.to,
      element: <PlannedPage title={item.label} milestone={item.milestone} />,
    }));
}

/**
 * Client routes. Guards decide what to show; the API enforces every permission
 * on every request regardless (specs/02).
 */
export function buildRoutes({ previewShells }: { previewShells: boolean }): RouteObject[] {
  const preview = { allowPreviewWithoutAuth: previewShells };
  return [
    {
      element: <PublicShell />,
      children: [
        { path: "/", element: <HomePage /> },
        { path: "/login", element: <LoginPage /> },
        { path: "/login/mfa", element: <MfaPage /> },
      ],
    },
    {
      element: <RequireAuth {...preview} />,
      children: [
        {
          element: <AppShell area="Member" nav={memberNav} previewShells={previewShells} />,
          children: [
            { path: "/account", element: <AccountPage /> },
            ...plannedRoutes(memberNav, previewShells),
          ],
        },
      ],
    },
    {
      element: <RequireAuth staff="any" {...preview} />,
      children: [
        {
          element: <AppShell area="Admin" nav={adminNav} previewShells={previewShells} />,
          children: [
            { path: "/admin", element: <AdminHomePage /> },
            {
              element: <RequireAuth staff={["owner", "admin"]} {...preview} />,
              children: [{ path: "/admin/staff", element: <StaffPage /> }],
            },
            ...plannedRoutes(adminNav, previewShells),
          ],
        },
      ],
    },
    { element: <PublicShell />, children: [{ path: "*", element: <NotFoundPage /> }] },
  ];
}
