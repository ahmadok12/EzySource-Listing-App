import { useEffect, useState, type FormEvent } from "react";
import { Navigate, useNavigate, useSearchParams } from "react-router-dom";
import { useQueryClient } from "@tanstack/react-query";
import { useAuth } from "../auth/AuthProvider";
import type { MfaEnrollment } from "../auth/adapter";
import { safeNext } from "../auth/next";
import { Button } from "../components/Button";
import { TextField } from "../components/TextField";
import "./pages.css";

type Mode =
  | { kind: "loading" }
  | { kind: "verify"; factorId: string }
  | { kind: "enroll"; enrollment: MfaEnrollment }
  | { kind: "error" };

/** Owner and admin accounts must complete two-step verification (specs/06). */
export function MfaPage() {
  const { adapter, signedIn } = useAuth();
  const [params] = useSearchParams();
  const next = safeNext(params.get("next")) ?? "/admin";
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const [mode, setMode] = useState<Mode>({ kind: "loading" });
  const [code, setCode] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!adapter || !signedIn) return;
    let active = true;
    (async () => {
      const status = await adapter.mfaStatus();
      if (status.currentLevel === "aal2") return navigate(next, { replace: true });
      const nextMode: Mode = status.factorId
        ? { kind: "verify", factorId: status.factorId }
        : { kind: "enroll", enrollment: await adapter.enrollMfa() };
      if (active) setMode(nextMode);
    })().catch(() => active && setMode({ kind: "error" }));
    return () => {
      active = false;
    };
  }, [adapter, signedIn, navigate, next]);

  if (!adapter || signedIn === false) {
    return <Navigate to={`/login?next=${encodeURIComponent(next)}`} replace />;
  }

  async function verify(event: FormEvent) {
    event.preventDefault();
    if (mode.kind !== "verify" && mode.kind !== "enroll") return;
    const factorId = mode.kind === "verify" ? mode.factorId : mode.enrollment.factorId;
    setBusy(true);
    setError(null);
    try {
      await adapter!.verifyMfa(factorId, code.trim());
      await queryClient.invalidateQueries({ queryKey: ["me"] });
      navigate(next, { replace: true });
    } catch {
      setError("That code didn't match. Codes change every 30 seconds; try the current one.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="page page--narrow">
      <h1 className="page__title">Two-step verification</h1>
      {mode.kind === "loading" ? <p className="page__meta">Loading…</p> : null}
      {mode.kind === "error" ? (
        <p className="page__error" role="alert">
          We couldn't start two-step verification. Refresh the page to try again.
        </p>
      ) : null}
      {mode.kind === "enroll" || mode.kind === "verify" ? (
        <form className="page__form glass" onSubmit={verify}>
          {mode.kind === "enroll" ? (
            <>
              <p className="page__lede">
                Staff accounts need an authenticator app. Scan this code with one (for example
                Google Authenticator or 1Password), then enter the 6-digit code it shows.
              </p>
              <img
                className="page__qr"
                src={mode.enrollment.qrCodeSvg}
                alt="QR code for your authenticator app"
                width={180}
                height={180}
              />
              <p className="page__meta">
                Can't scan? Enter this key instead: <code>{mode.enrollment.secret}</code>
              </p>
            </>
          ) : (
            <p className="page__lede">Enter the 6-digit code from your authenticator app.</p>
          )}
          <TextField
            label="Authenticator code"
            inputMode="numeric"
            autoComplete="one-time-code"
            pattern="[0-9]{6}"
            required
            value={code}
            onChange={(e) => setCode(e.target.value)}
          />
          {error ? <p className="page__error" role="alert">{error}</p> : null}
          <Button type="submit" disabled={busy}>
            {busy ? "Checking…" : "Verify"}
          </Button>
        </form>
      ) : null}
    </section>
  );
}
