import { Stack, useRouter } from "expo-router";
import { useCallback, useState } from "react";
import { Pressable, View } from "react-native";
import { t } from "../../i18n/pt-BR";
import { listPages, listSources, type PageListItem } from "../../lib/api";
import { usePolling } from "../../lib/usePolling";
import { useQueue } from "../../queue/provider";
import { Banner, Button, Card, Chip, H2, P, Screen, Spinner } from "../../ui/components";
import { color } from "../../ui/theme";

export default function Library() {
  const router = useRouter();
  const { items } = useQueue();
  const [pages, setPages] = useState<PageListItem[] | null>(null);
  const [attention, setAttention] = useState(0);
  const [error, setError] = useState(false);

  const load = useCallback(async () => {
    try {
      const [p, s] = await Promise.all([listPages(), listSources()]);
      setPages(p); setError(false);
      setAttention(s.filter((x) => !["ready", "deleted"].includes(x.state)).length);
    } catch { setError(true); }
  }, []);
  usePolling(load, 4000);
  const pending = attention + items.filter((i) => i.state !== "received").length;

  return (
    <Screen>
      <Stack.Screen options={{ headerRight: () => (
        <Pressable accessibilityRole="button" accessibilityLabel={t.library.settings} onPress={() => router.push("/settings")} style={{ minWidth: 48, minHeight: 48, alignItems: "center", justifyContent: "center" }}>
          <View style={{ width: 32, height: 32, borderRadius: 16, backgroundColor: color.accentSoft }} />
        </Pressable>) }} />
      <Card onPress={() => router.push("/inbox")} accessibilityLabel={`${t.library.inbox}${pending ? `, ${pending} pendentes` : ""}`}>
        <H2>{t.library.inbox}</H2>
        {pending > 0 ? <Chip tone="accent" label={`${pending}`} /> : <P muted>{t.inbox.empty}</P>}
      </Card>
      {error ? <Banner tone="warn">{t.common.offline}</Banner> : null}
      {pages === null ? <Spinner /> : pages.length === 0 ? (
        <View style={{ flex: 1, justifyContent: "center", gap: 12 }}><H2>{t.library.empty}</H2><Button label={t.library.emptyAction} onPress={() => router.push("/add")} /></View>
      ) : (
        <>
          {pages.map((p) => (
            <Card key={p.id} onPress={() => router.push(`/page/${p.id}`)} accessibilityLabel={p.title}>
              <H2>{p.title}</H2>
              {p.summary ? <P muted>{p.summary}</P> : null}
              <Chip label={t.library.pageTypes[p.type] ?? p.type} />
            </Card>
          ))}
          <Button label={t.library.add} onPress={() => router.push("/add")} />
        </>
      )}
    </Screen>
  );
}
