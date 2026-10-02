import { useRouter } from "expo-router";
import { useState } from "react";
import { t } from "../../i18n/pt-BR";
import { acceptAiNotice } from "../../lib/api";
import { Banner, Button, H2, P, Screen } from "../../ui/components";

export default function Notice() {
  const router = useRouter();
  const [busy, setBusy] = useState(false); const [error, setError] = useState(false);
  return (
    <Screen>
      <H2>{t.notice.title}</H2>
      <P>{t.notice.body}</P>
      {error ? <Banner tone="danger">{t.common.error}</Banner> : null}
      <Button label={t.notice.accept} busy={busy} onPress={async () => {
        setBusy(true);
        try { await acceptAiNotice(); router.back(); } catch { setError(true); setBusy(false); }
      }} />
    </Screen>
  );
}
