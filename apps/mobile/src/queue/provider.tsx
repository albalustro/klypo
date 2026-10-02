import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { AppState } from "react-native";
import { useAuth } from "../lib/auth";
import { CaptureQueue, type QueueItem, type RunResult } from "./core";
import { localFiles } from "./files";
import { supabaseRemote } from "./remote";
import { SqliteQueueStore } from "./sqliteStore";

type Ctx = {
  queue: CaptureQueue; items: QueueItem[]; authRequired: boolean;
  refresh: () => Promise<void>; run: (force?: boolean) => Promise<RunResult | null>;
};
const QueueCtx = createContext<Ctx | null>(null);

export function QueueProvider({ children }: { children: ReactNode }) {
  const { session } = useAuth();
  const queue = useMemo(() => new CaptureQueue(new SqliteQueueStore(), supabaseRemote, localFiles), []);
  const [items, setItems] = useState<QueueItem[]>([]);
  const [authRequired, setAuthRequired] = useState(false);
  const uid = session?.user.id;

  const refresh = useCallback(async () => { setItems((await queue.list()).filter((i) => !uid || i.ownerId === uid)); }, [queue, uid]);
  const run = useCallback(async (force = false) => {
    if (!uid) return null;
    const r = await queue.run(uid, { force });
    setAuthRequired(r.authRequired);
    await refresh();
    return r;
  }, [queue, uid, refresh]);

  // tenta ao abrir/voltar ao primeiro plano (sem promessa de envio em background contínuo) e a cada 15 s enquanto aberto
  const runRef = useRef(run); runRef.current = run;
  useEffect(() => {
    refresh();
    runRef.current(true).catch(() => {});
    const sub = AppState.addEventListener("change", (s) => { if (s === "active") runRef.current(true).catch(() => {}); });
    const timer = setInterval(() => runRef.current(false).catch(() => {}), 15_000);
    return () => { sub.remove(); clearInterval(timer); };
  }, [uid, refresh]);

  const value = useMemo(() => ({ queue, items, authRequired, refresh, run }), [queue, items, authRequired, refresh, run]);
  return <QueueCtx.Provider value={value}>{children}</QueueCtx.Provider>;
}
export const useQueue = () => { const c = useContext(QueueCtx); if (!c) throw new Error("QueueProvider ausente"); return c; };
