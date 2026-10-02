import { Link } from "expo-router";
import { useState } from "react";
import { t } from "../../i18n/pt-BR";
import { supabase } from "../../lib/supabase";
import { Banner, Button, Field, P, Screen } from "../../ui/components";

export default function SignIn() {
  const [email, setEmail] = useState(""); const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false); const [error, setError] = useState<string | null>(null);
  async function submit() {
    setBusy(true); setError(null);
    const { error } = await supabase.auth.signInWithPassword({ email: email.trim(), password });
    setBusy(false);
    if (error) setError(/invalid/i.test(error.message) ? t.auth.invalidCredentials : /fetch|network/i.test(error.message) ? t.common.offline : t.common.error);
  }
  return (
    <Screen>
      {error ? <Banner tone="danger">{error}</Banner> : null}
      <Field label={t.auth.email} value={email} onChangeText={setEmail} autoCapitalize="none" autoComplete="email" keyboardType="email-address" textContentType="emailAddress" />
      <Field label={t.auth.password} value={password} onChangeText={setPassword} secureTextEntry autoComplete="current-password" textContentType="password" />
      <Button label={t.auth.signInAction} onPress={submit} busy={busy} disabled={!email || !password} />
      <Link href="/recover"><P style={{ color: "#6D4AFF" }}>{t.auth.forgot}</P></Link>
      <Link href="/sign-up"><P style={{ color: "#6D4AFF" }}>{t.auth.noAccount}</P></Link>
    </Screen>
  );
}
