import { Image } from "expo-image";
import { useRouter } from "expo-router";
import { randomUUID } from "expo-crypto";
import { useCallback, useEffect, useState } from "react";
import { View } from "react-native";
import { t } from "../../i18n/pt-BR";
import { deleteSource, listSources, requestProcessing, signedImageUrl, type SourceRow } from "../../lib/api";
import { usePolling } from "../../lib/usePolling";
import { useQueue } from "../../queue/provider";
import type { QueueItem } from "../../queue/core";
import { Banner, Button, Card, Chip, P, Row, Screen, Spinner } from "../../ui/components";

const FINAL = ["ready", "needs_review", "failed"];

function Thumb({ uri, label }: { uri?: string | null; label: string }) {
  return uri ? <Image source={{ uri }} accessibilityLabel={label} style={{ width: 56, height: 56, borderRadius: 8 }} contentFit="cover" />
    : <View accessibilityLabel={label} style={{ width: 56, height: 56, borderRadius: 8, backgroundColor: "#EFEAFF" }} />;
}

function ServerRow({ s, onChanged }: { s: SourceRow; onChanged: () => void }) {
  const router = useRouter();
  const [thumb, setThumb] = useState<string | null>(null);
  useEffect(() => { if (s.object_path) signedImageUrl(s.object_path).then(setThumb).catch(() => {}); }, [s.object_path]);
  const tone = s.state === "ready" ? "ok" : s.state === "failed" ? "danger" : s.state === "needs_review" ? "warn" : "accent";
  const open = () => router.push(`/source/${s.id}`);
  return (
    <Card onPress={open} accessibilityLabel={`${s.kind === "image" ? "Imagem" : "Texto"}: ${t.inbox.server[s.state] ?? s.state}`}>
      <Row>
        <Thumb uri={thumb} label={s.kind === "image" ? "Miniatura da imagem" : "Texto"} />
        <View style={{ flex: 1, gap: 4 }}>
          {s.kind === "text" ? <P numberOfLines={2}>{s.text_original}</P> : null}
          <Chip tone={tone} label={t.inbox.server[s.state] ?? s.state} />
          {s.state === "needs_review" && s.review_reason ? <P muted>{t.inbox.review[s.review_reason]}</P> : null}
          {s.state === "failed" ? <P muted>{t.inbox.errors[s.error_code ?? "unknown"] ?? t.inbox.errors.unknown}</P> : null}
        </View>
      </Row>
      {s.state === "failed" || s.state === "needs_review" ? (
        <Row>
          <Button label={t.common.retry} variant="secondary" onPress={async () => { await requestProcessing(s.id, randomUUID()); onChanged(); }} />
          <Button label={t.common.delete} variant="danger" onPress={async () => { await deleteSource(s.id); onChanged(); }} />
        </Row>
      ) : null}
    </Card>
  );
}

function LocalRow({ i, onRetry, onDiscard }: { i: QueueItem; onRetry: () => void; onDiscard: () => void }) {
  return (
    <Card accessibilityLabel={t.inbox.local[i.state] ?? i.state}>
      <Row>
        <Thumb uri={i.localPath} label={i.kind === "image" ? "Miniatura da imagem" : "Texto"} />
        <View style={{ flex: 1, gap: 4 }}>
          {i.kind === "text" ? <P numberOfLines={2}>{i.text}</P> : null}
          <Chip tone={i.state === "rejected" ? "danger" : "accent"} label={t.inbox.local[i.state] ?? i.state} />
          {i.errorCode ? <P muted>{t.inbox.errors[i.errorCode] ?? t.inbox.errors.unknown}</P> : null}
        </View>
      </Row>
      {i.state === "rejected" ? (
        <Row><Button label={t.common.retry} variant="secondary" onPress={onRetry} /><Button label={t.common.delete} variant="danger" onPress={onDiscard} /></Row>
      ) : null}
    </Card>
  );
}

export default function Inbox() {
  const { items, authRequired, queue, refresh, run } = useQueue();
  const [sources, setSources] = useState<SourceRow[] | null>(null);
  const [error, setError] = useState(false);
  const load = useCallback(async () => { try { setSources(await listSources()); setError(false); await refresh(); } catch { setError(true); } }, [refresh]);
  usePolling(async () => { await load(); await run(false); }, 3000, () => items.length > 0 || (sources ?? []).some((s) => !FINAL.includes(s.state)));

  const local = items.filter((i) => i.state !== "received");
  return (
    <Screen>
      {authRequired ? <Banner tone="warn">{t.inbox.authRequired}</Banner> : null}
      {error ? <Banner tone="warn">{t.common.offline}</Banner> : null}
      {sources === null ? <Spinner /> : local.length + sources.length === 0 ? <P muted>{t.inbox.empty}</P> : null}
      {local.map((i) => <LocalRow key={i.id} i={i} onRetry={async () => { await queue.retry(i.id); await run(true); }} onDiscard={async () => { await queue.discard(i.id); await refresh(); }} />)}
      {(sources ?? []).map((s) => <ServerRow key={s.id} s={s} onChanged={load} />)}
    </Screen>
  );
}
