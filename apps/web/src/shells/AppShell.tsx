import { NavLink, Outlet } from "react-router-dom";
import { Logo } from "../components/Logo";
import { MAX_MOBILE_NAV_ITEMS, type NavItem } from "./navigation";
import "./AppShell.css";

type Props = {
  area: string;
  nav: NavItem[];
};

/**
 * Responsive shell: wide side navigation on desktop, a floating bottom bar of
 * at most five destinations on mobile (specs/01, specs/02).
 */
export function AppShell({ area, nav }: Props) {
  const mobileNav = nav.filter((item) => item.mobile).slice(0, MAX_MOBILE_NAV_ITEMS);

  return (
    <div className="shell">
      <header className="shell__bar">
        <Logo subtitle={area} />
      </header>

      <nav className="shell__side glass" aria-label={`${area} navigation`}>
        <Logo subtitle={area} />
        <ul>
          {nav.map((item) => (
            <li key={item.to}>
              <NavLink to={item.to} className="shell__side-link">
                <item.icon size={20} aria-hidden="true" />
                {item.label}
              </NavLink>
            </li>
          ))}
        </ul>
      </nav>

      <main className="shell__main">
        <Outlet />
      </main>

      <nav className="shell__bottom glass" aria-label={`${area} navigation`}>
        {mobileNav.map((item) => (
          <NavLink key={item.to} to={item.to} className="shell__bottom-link">
            <item.icon size={20} aria-hidden="true" />
            <span>{item.label}</span>
          </NavLink>
        ))}
      </nav>
    </div>
  );
}
