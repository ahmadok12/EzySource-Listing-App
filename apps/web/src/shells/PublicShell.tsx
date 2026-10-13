import { Outlet } from "react-router-dom";
import { Logo } from "../components/Logo";
import "./PublicShell.css";

export function PublicShell() {
  return (
    <div className="public">
      <header className="public__bar">
        <Logo />
      </header>
      <main className="public__main">
        <Outlet />
      </main>
    </div>
  );
}
