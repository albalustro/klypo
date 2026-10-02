import { useFocusEffect } from "expo-router";
import { useCallback, useRef } from "react";

/** Executa `fn` ao focar a tela e a cada `ms` enquanto `active()` retornar true. */
export function usePolling(fn: () => Promise<unknown> | unknown, ms: number, active: () => boolean = () => true) {
  const fnRef = useRef(fn); fnRef.current = fn;
  const activeRef = useRef(active); activeRef.current = active;
  useFocusEffect(useCallback(() => {
    let stop = false;
    const tick = async () => { try { await fnRef.current(); } catch { /* erro tratado na tela */ } };
    tick();
    const id = setInterval(() => { if (!stop && activeRef.current()) tick(); }, ms);
    return () => { stop = true; clearInterval(id); };
  }, [ms]));
}
