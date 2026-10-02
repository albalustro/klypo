import { useLocalSearchParams, useRouter } from "expo-router";
import { useEffect, useState } from "react";
import { t } from "../i18n/pt-BR";
import { supabase } from "../lib/supabase";
import { Banner, Button, Center, Field, H2, Spinner } from "../ui/components";
import { Screen } from "../ui/components";

/** Destino do link de recuperação (klypo://reset-password?code=…): troca o código por sessão e pede a nova senha. */
export default function ResetPassword() {
  const { code } = useLocalSearchParams<{ code?: string }>();
  const router = useRouter();
  const [state, setState] = useState<"checking" | "form" | "invalid" | "done">("checking");
  const [password, setPassword] = useState(""); const [busy, setBusy] = useState(false); const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    (async () => {
      if (!code) { const { data } = await supabase.auth.getSession(); return setState(data.session ? "form" : "invalid"); }
      const { error } = await supabase.auth.exchangeCodeForSession(code);
      setState(error ? "invalid" : "form");
    })();
  }, [code]);
  async function submit() {
    if (password.length < 8) return setError(t.auth.weakPassword);
    setBusy(true); setError(null);
    const { error } = await supabase.auth.updateUser({ password });
    setBusy(false);
    if (error) return setError(t.common.error);
    setState("done");
  }
  if (state === "checking") return <Center><Spinner /></Center>;
  if (state === "invalid") return <Center><H2>{t.auth.resetInvalid}</H2><Button label={t.common.back} onPress={() => router.replace("/")} /></Center>;
  if (state === "done") return <Center><H2>{t.auth.resetDone}</H2><Button label={t.common.continue} onPress={() => router.replace("/")} /></Center>;
  return (
    <Screen>
      <H2>{t.auth.resetTitle}</H2>
      {error ? <Banner tone="danger">{error}</Banner> : null}
      <Field label={t.auth.newPassword} value={password} onChangeText={setPassword} secureTextEntry autoComplete="new-password" />
      <Button label={t.auth.resetAction} onPress={submit} busy={busy} disabled={!password} />
    </Screen>
  );
}
