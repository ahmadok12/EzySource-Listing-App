import { createContext, useContext, useEffect, useMemo, useState, type ReactNode } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { meResponseSchema } from "@ezysource/domain";
import { apiGet, setApiTokenProvider } from "../lib/api";
import type { AuthAdapter } from "./adapter";

type AuthState = {
  /** Null when this build has no sign-in configured. */
  adapter: AuthAdapter | null;
  /** Undefined while the stored session is still being read. */
  signedIn: boolean | undefined;
  signOut(): Promise<void>;
};

const AuthContext = createContext<AuthState | null>(null);

export function AuthProvider({ adapter, children }: { adapter: AuthAdapter | null; children: ReactNode }) {
  const queryClient = useQueryClient();
  const [signedIn, setSignedIn] = useState<boolean | undefined>(adapter ? undefined : false);

  useEffect(() => {
    if (!adapter) return;
    setApiTokenProvider(() => adapter.getAccessToken());
    let active = true;
    void adapter.getAccessToken().then((token) => active && setSignedIn(!!token));
    const unsubscribe = adapter.onChange((now) => {
      setSignedIn(now);
      // Identity-scoped data must never survive a change of user (specs/12).
      queryClient.removeQueries({ queryKey: ["me"] });
      void queryClient.invalidateQueries();
    });
    return () => {
      active = false;
      unsubscribe();
    };
  }, [adapter, queryClient]);

  const value = useMemo<AuthState>(
    () => ({
      adapter,
      signedIn,
      async signOut() {
        await adapter?.signOut();
        queryClient.clear();
        setSignedIn(false);
      },
    }),
    [adapter, signedIn, queryClient],
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth() {
  const value = useContext(AuthContext);
  if (!value) throw new Error("useAuth must be used inside AuthProvider");
  return value;
}

/** The signed-in person as the server sees them now (roles, MFA state). */
export function useMe() {
  const { signedIn } = useAuth();
  return useQuery({
    queryKey: ["me"],
    queryFn: () => apiGet("/me", meResponseSchema.parse),
    enabled: signedIn === true,
    staleTime: 30_000,
  });
}
