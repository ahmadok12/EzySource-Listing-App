import { Link } from "react-router-dom";
import "./pages.css";

export function NotFoundPage() {
  return (
    <section className="page">
      <h1 className="page__title">Page not found</h1>
      <p className="page__lede">
        That page doesn't exist. <Link to="/">Go to the home page</Link>.
      </p>
    </section>
  );
}
