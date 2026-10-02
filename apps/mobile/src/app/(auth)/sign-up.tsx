import { Link } from "expo-router";
import { useState } from "react";
import { t } from "../../i18n/pt-BR";
import { supabase } from "../../lib/supabase";
import { Banner, Button, Field, P, Screen } from "../../ui/components";

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
export default function SignUp() {
  const [email, setEmail] = useState(""); const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false); const [error, setError] = useState<string | null>(null); const [info, setInfo] = useState<string | null>(null);
  async function submit() {
    setError(null); setInfo(null);
    if (!EMAIL_RE.test(email.trim())) return setError(t.auth.invalidEmail);
    if (password.length < 8) return setError(t.auth.weakPassword);
    setBusy(true);
    const { data, error } = await supabase.auth.signUp({ email: email.trim(), password });
    setBusy(false);
    if (error) return setError(/registered|already/i.test(error.message) ? t.auth.emailTaken : /password/i.test(error.message) ? t.auth.weakPassword : t.common.error);
    if (!data.session) setInfo(t.auth.confirmEmail);          // confirmação de e-mail ativa: aguardar o link
  }
  return (
    <Screen>
      {error ? <Banner tone="danger">{error}</Banner> : null}
      {info ? <Banner tone="ok">{info}</Banner> : null}
      <Field label={t.auth.email} value={email} onChangeText={setEmail} autoCapitalize="none" autoComplete="email" keyboardType="email-address" textContentType="emailAddress" />
      <Field label={t.auth.password} value={password} onChangeText={setPassword} secureTextEntry autoComplete="new-password" textContentType="newPassword" />
      <Button label={t.auth.signUpAction} onPress={submit} busy={busy} disabled={!email || !password} />
      <Link href="/sign-in"><P style={{ color: "#6D4AFF" }}>{t.auth.haveAccount}</P></Link>
    </Screen>
  );
}
