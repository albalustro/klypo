import Constants from "expo-constants";
import { t } from "../../i18n/pt-BR";
import { useAuth } from "../../lib/auth";
import { supabase } from "../../lib/supabase";
import { useQueue } from "../../queue/provider";
import { Banner, Button, Card, H2, P, Screen } from "../../ui/components";

export default function Settings() {
  const { session } = useAuth();
  const { items } = useQueue();
  return (
    <Screen>
      <Card><H2>{t.settings.account}</H2><P>{session?.user.email}</P></Card>
      <Card><H2>{t.settings.aiInfo}</H2><P muted>{t.settings.aiBody}</P></Card>
      {items.some((i) => i.state !== "rejected") ? <Banner tone="info">{t.settings.pendingOnSignOut}</Banner> : null}
      <Button label={t.settings.signOut} variant="secondary" onPress={() => supabase.auth.signOut()} />
      <P muted>{`${t.settings.version} ${Constants.expoConfig?.version ?? ""}`}</P>
    </Screen>
  );
}
