import { Image } from "expo-image";
import { randomUUID } from "expo-crypto";
import { Link, Stack, useLocalSearchParams, useRouter } from "expo-router";
import { useCallback, useEffect, useState } from "react";
import { Alert, View } from "react-native";
import { t } from "../../../i18n/pt-BR";
import { deleteSource, getSource, recordEvent, requestProcessing, type SourceDetail } from "../../../lib/api";
import { usePolling } from "../../../lib/usePolling";
import { Banner, Button, Card, Chip, H2, P, Screen, Spinner } from "../../../ui/components";
import { color } from "../../../ui/theme";

export default function SourceScreen() {
  const { id, segment } = useLocalSearchParams<{ id: string; segment?: string }>();
  const router = useRouter();
  const [d, setD] = useState<SourceDetail | null | undefined>(undefined);
  const [msg, setMsg] = useState<string | null>(null);
  const load = useCallback(async () => { try { setD(await getSource(id)); } catch { setD(null); } }, [id]);
  usePolling(load, 3000, () => !!d?.processing || (!!d && !["ready", "failed", "needs_review"].includes(d.source.state)));
  useEffect(() => { recordEvent("source_opened", id); }, [id]);

  if (d === undefined) return <Screen><Spinner /></Screen>;
  if (d === null) return <Screen><P muted>{t.page.notFound}</P></Screen>;
  const isFake = d.extraction?.model.startsWith("fake");
  const confirmDelete = () => Alert.alert(t.source.deleteConfirmTitle, `${t.source.deleteConfirmBody}${d.pages.length ? `\n\n${t.source.dependentPages}: ${d.pages.map((p) => p.title).join(", ")}` : ""}`, [
    { text: t.common.cancel, style: "cancel" },
    { text: t.common.delete, style: "destructive", onPress: async () => { await deleteSource(id); router.back(); } },
  ]);

  return (
    <Screen>
      <Stack.Screen options={{ title: t.source.title }} />
      {msg ? <Banner tone="ok">{msg}</Banner> : null}
      {d.source.state === "needs_review" && d.source.review_reason ? <Banner tone="warn">{t.inbox.review[d.source.review_reason]}</Banner> : null}
      {d.source.state === "failed" ? <Banner tone="danger">{t.inbox.errors[d.source.error_code ?? "unknown"]}</Banner> : null}
      {d.extraction?.legibility === "partial" ? <Banner tone="warn">{t.source.partial}</Banner> : null}
      {isFake ? <Banner tone="info">{t.source.fakeNotice}</Banner> : null}

      {d.imageUrl ? (<><H2>{t.source.original}</H2><Image source={{ uri: d.imageUrl }} accessibilityLabel={t.source.original} style={{ width: "100%", aspectRatio: 3 / 4, borderRadius: 12, backgroundColor: color.border }} contentFit="contain" /></>) : null}
      {d.source.kind === "text" && d.source.text_original ? <Card><H2>{t.source.originalText}</H2><P>{d.source.text_original}</P></Card> : null}

      <H2>{t.source.extracted}</H2>
      {d.segments.length === 0 ? <P muted>{t.source.noSegments}</P> : d.segments.map((s) => (
        <View key={s.id} accessibilityLabel={`Trecho ${s.key}`} style={{ backgroundColor: s.id === segment ? color.accentSoft : color.surface, borderWidth: 1, borderColor: s.id === segment ? color.accent : color.border, borderRadius: 12, padding: 12 }}>
          <P>{s.text}</P>
        </View>
      ))}
      {d.extraction?.issues?.length ? <Card><H2>{t.source.issues}</H2>{d.extraction.issues.map((i, n) => <P key={n} muted>{i.message}</P>)}</Card> : null}

      {d.pages.length ? <Card><H2>{t.source.dependentPages}</H2>{d.pages.map((p) => <Link key={p.id} href={`/page/${p.id}`}><P style={{ color: color.accent }}>{p.title}</P></Link>)}</Card> : null}

      {d.extraction ? <Card><H2>{t.source.details}</H2><P muted>{`${t.source.model}: ${d.extraction.model}`}</P><P muted>{`${t.source.pipeline}: ${d.extraction.pipeline_version}`}</P></Card> : null}

      {d.processing ? <Chip tone="accent" label={t.page.reprocessRunning} /> : d.source.state === "ready" ? (
        <><P muted>{t.source.reprocessHint}</P><Button label={t.source.reprocess} variant="secondary" onPress={async () => { await requestProcessing(id, randomUUID()); setMsg(t.source.requested); load(); }} /></>
      ) : d.source.state === "failed" || d.source.state === "needs_review" ? (
        <Button label={t.source.retryProcessing} variant="secondary" onPress={async () => { await requestProcessing(id, randomUUID()); setMsg(t.source.requested); load(); }} />
      ) : null}
      <Button label={t.source.deleteSource} variant="danger" onPress={confirmDelete} />
    </Screen>
  );
}
