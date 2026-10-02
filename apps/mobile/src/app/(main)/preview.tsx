import { Image } from "expo-image";
import { useRouter } from "expo-router";
import { useState } from "react";
import { View } from "react-native";
import { t } from "../../i18n/pt-BR";
import { getProfile, recordEvent } from "../../lib/api";
import { useAuth } from "../../lib/auth";
import { useDrafts } from "../../lib/drafts";
import { copyToDurable } from "../../queue/files";
import { useQueue } from "../../queue/provider";
import { Banner, Button, Card, Field, H2, P, Row, Screen } from "../../ui/components";

export default function Preview() {
  const router = useRouter();
  const { session } = useAuth();
  const { drafts, batchId, remove, clear } = useDrafts();
  const { queue, run, refresh } = useQueue();
  const [note, setNote] = useState(""); const [busy, setBusy] = useState(false); const [error, setError] = useState<string | null>(null);

  async function save() {
    if (!session) return;
    setBusy(true); setError(null);
    try {
      // aviso de IA antes da primeira captura (o servidor também exige)
      const profile = await getProfile().catch(() => null);
      if (profile && !profile.ai_notice_accepted_at) { setBusy(false); return router.push("/notice"); }
      // 1) copia para armazenamento durável; 2) registra na fila (ponto de commit); 3) só então avisa e tenta enviar
      const items = drafts.map((d, i) => {
        const id = d.id;
        return d.kind === "image"
          ? { id, ownerId: session.user.id, batchId, kind: "image" as const, localPath: copyToDurable(d.uri!, id, d.mime === "image/png" ? "png" : "jpg"), mime: d.mime, sizeBytes: d.sizeBytes, position: i, note: note.trim() || undefined }
          : { id, ownerId: session.user.id, batchId, kind: "text" as const, text: d.text, position: i, note: note.trim() || undefined };
      });
      await queue.enqueue(items);
      recordEvent("capture_saved_local");
      clear(); await refresh();
      run(true).catch(() => {});                       // upload em segundo plano de UI; a Caixa de entrada mostra o estado real
      router.replace("/inbox");
    } catch {
      setError(t.common.error); setBusy(false);
    }
  }

  if (drafts.length === 0) return <Screen><P muted>{t.preview.empty}</P><Button label={t.library.add} onPress={() => router.replace("/add")} /></Screen>;
  return (
    <Screen>
      {error ? <Banner tone="danger">{error}</Banner> : null}
      {drafts.map((d, i) => (
        <Card key={d.id}>
          <Row>
            {d.kind === "image" ? <Image source={{ uri: d.uri }} accessibilityLabel={`Imagem ${i + 1}`} style={{ width: 72, height: 72, borderRadius: 8 }} contentFit="cover" /> : null}
            <View style={{ flex: 1 }}>{d.kind === "text" ? <P numberOfLines={4}>{d.text}</P> : <P muted>{`Imagem ${i + 1}`}</P>}</View>
          </Row>
          <Button label={t.preview.remove} variant="ghost" onPress={() => remove(d.id)} accessibilityHint={`Retira o item ${i + 1}`} />
        </Card>
      ))}
      {drafts.filter((d) => d.kind === "image").length > 1 ? <Banner tone="info">{t.preview.sameDocumentSoon}</Banner> : null}
      <Field label={t.preview.note} value={note} onChangeText={setNote} multiline />
      <Button label={t.preview.save} onPress={save} busy={busy} />
    </Screen>
  );
}
