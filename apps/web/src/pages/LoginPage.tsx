import { useState, type FormEvent } from "react";
import { Navigate, useNavigate, useSearchParams } from "react-router-dom";
import { useQueryClient } from "@tanstack/react-query";
import { meResponseSchema } from "@ezysource/domain";
import { useAuth } from "../auth/AuthProvider";
import { safeNext } from "../auth/next";
import { apiGet } from "../lib/api";
import { Button } from "../components/Button";
import { GlassCard } from "../components/GlassCard";
import { TextField } from "../components/TextField";
import "./pages.css";

export function LoginPage() {
  const { adapter, signedIn } = useAuth();
  const [params] = useSearchParams();
  const next = safeNext(params.get("next"));
  const navigate = useNavigate();
  const queryClient = useQueryClient();

  const [step, setStep] = useState<"email" | "code">("email");
  const [email, setEmail] = useState("");
  const [code, setCode] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  if (!adapter) {
    return (
      <section className="page">
        <h1 className="page__title">Sign in</h1>
        <GlassCard className="page__notice">
          <p className="page__row-title">Sign-in isn't set up yet</p>
          <p className="page__meta">This environment has no login provider configured.</p>
        </GlassCard>
      </section>
    );
  }
  if (signedIn && step === "email") return <Navigate to={next ?? "/account"} replace />;

  async function sendCode(event: FormEvent) {
    event.preventDefault();
    setBusy(true);
    setError(null);
    try {
      await adapter!.sendCode(email.trim());
      setStep("code");
    } catch {
      // Same message whatever the reason, so the form can't be used to probe accounts.
      setError("We couldn't send a code right now. Check the address and try again in a minute.");
    } finally {
      setBusy(false);
    }
  }

  async function verifyCode(event: FormEvent) {
    event.preventDefault();
    setBusy(true);
    setError(null);
    try {
      await adapter!.verifyCode(email.trim(), code.trim());
      const me = await queryClient.fetchQuery({
        queryKey: ["me"],
        queryFn: () => apiGet("/me", meResponseSchema.parse),
      });
      const destination = next ?? (me.staffRoles.length > 0 ? "/admin" : "/account");
      if (me.mfaRequired) {
        navigate(`/login/mfa?next=${encodeURIComponent(destination)}`, { replace: true });
      } else {
        navigate(destination, { replace: true });
      }
    } catch {
      setError("That code didn't work. Check it, or send a new one.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="page page--narrow">
      <h1 className="page__title">Sign in</h1>
      {step === "email" ? (
        <form className="page__form glass" onSubmit={sendCode}>
          <TextField
            label="Email"
            type="email"
            autoComplete="email"
            required
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            hint="We'll email you a sign-in code."
          />
          {error ? <p className="page__error" role="alert">{error}</p> : null}
          <Button type="submit" disabled={busy}>
            {busy ? "Sending…" : "Email me a code"}
          </Button>
        </form>
      ) : (
        <form className="page__form glass" onSubmit={verifyCode}>
          <p className="page__meta">We sent a code to {email}.</p>
          <TextField
            label="Code"
            inputMode="numeric"
            autoComplete="one-time-code"
            pattern="[0-9]{6,10}"
            required
            value={code}
            onChange={(e) => setCode(e.target.value)}
          />
          {error ? <p className="page__error" role="alert">{error}</p> : null}
          <Button type="submit" disabled={busy}>
            {busy ? "Checking…" : "Sign in"}
          </Button>
          <Button
            variant="secondary"
            onClick={() => {
              setStep("email");
              setCode("");
              setError(null);
            }}
          >
            Use a different email
          </Button>
        </form>
      )}
    </section>
  );
}
