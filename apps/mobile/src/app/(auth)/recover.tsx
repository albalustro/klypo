import * as Linking from "expo-linking";
import { useState } from "react";
import { t } from "../../i18n/pt-BR";
import { supabase } from "../../lib/supabase";
import { Banner, Button, Field, Screen } from "../../ui/components";

export default function Recover() {
  const [email, setEmail] = useState(""); const [busy, setBusy] = useState(false); const [info, setInfo] = useState<string | null>(null); const [error, setError] = useState<string | null>(null);
  async function submit() {
    setBusy(true); setError(null);
    const { error } = await supabase.auth.resetPasswordForEmail(email.trim(), { redirectTo: Linking.createURL("reset-password") });
    setBusy(false);
    if (error && /fetch|network/i.test(error.message)) setError(t.common.offline);
    else setInfo(t.auth.recoverSent);               // mesma mensagem exista o e-mail ou não (não revela contas)
  }
  return (
    <Screen>
      {error ? <Banner tone="danger">{error}</Banner> : null}
      {info ? <Banner tone="ok">{info}</Banner> : null}
      <Field label={t.auth.email} value={email} onChangeText={setEmail} autoCapitalize="none" keyboardType="email-address" autoComplete="email" />
      <Button label={t.auth.recoverAction} onPress={submit} busy={busy} disabled={!email} />
    </Screen>
  );
}
