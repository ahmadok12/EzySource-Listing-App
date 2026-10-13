import {
  Bookmark,
  ClipboardCheck,
  Compass,
  LayoutGrid,
  Map,
  Search,
  Store,
  UserRound,
  Users,
  Camera,
  type LucideIcon,
} from "lucide-react";

export type NavItem = {
  to: string;
  label: string;
  icon: LucideIcon;
  /** Build milestone (specs/09) that makes this destination real. */
  milestone: number;
  /** Shown in the mobile bottom bar. At most five per shell (specs/02). */
  mobile?: boolean;
};

export const MAX_MOBILE_NAV_ITEMS = 5;

export const memberNav: NavItem[] = [
  { to: "/directory", label: "Directory", icon: Search, milestone: 3, mobile: true },
  { to: "/saved", label: "Saved", icon: Bookmark, milestone: 3, mobile: true },
  { to: "/navigate", label: "Navigate", icon: Compass, milestone: 4, mobile: true },
  { to: "/account", label: "Account", icon: UserRound, milestone: 3, mobile: true },
];

export const adminNav: NavItem[] = [
  { to: "/admin/collection", label: "Collection", icon: Camera, milestone: 1, mobile: true },
  { to: "/admin/review", label: "Review", icon: ClipboardCheck, milestone: 2, mobile: true },
  { to: "/admin/shops", label: "Shops", icon: Store, milestone: 2, mobile: true },
  { to: "/admin/maps", label: "Maps", icon: Map, milestone: 4, mobile: true },
  { to: "/admin/staff", label: "Staff", icon: Users, milestone: 1 },
  { to: "/admin/customers", label: "Customers", icon: UserRound, milestone: 3 },
  { to: "/admin/plans", label: "Plans", icon: LayoutGrid, milestone: 3, mobile: true },
];
