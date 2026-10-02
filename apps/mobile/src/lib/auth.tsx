import type { Session } from "@supabase/supabase-js";
import { createContext, useContext, useEffect, useMemo, useState, type ReactNode } from "react";
import { supabase } from "./supabase";

type AuthState = { session: Session | null; ready: boolean };
const Ctx = createContext<AuthState>({ session: null, ready: false });

export function AuthProvider({ children }: { children: ReactNode }) {
  const [state, setState] = useState<AuthState>({ session: null, ready: false });
  useEffect(() => {
    let active = true;
    supabase.auth.getSession().then(({ data }) => active && setState({ session: data.session, ready: true }));
    const { data: sub } = supabase.auth.onAuthStateChange((_e, session) => setState({ session, ready: true }));
    return () => { active = false; sub.subscription.unsubscribe(); };
  }, []);
  return <Ctx.Provider value={useMemo(() => state, [state])}>{children}</Ctx.Provider>;
}
export const useAuth = () => useContext(Ctx);
