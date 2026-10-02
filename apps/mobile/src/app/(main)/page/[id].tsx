import AsyncStorage from "@react-native-async-storage/async-storage";
import { randomUUID } from "expo-crypto";
import { Link, Stack, useLocalSearchParams, useRouter } from "expo-router";
import { useCallback, useEffect, useRef, useState } from "react";
import { Alert, Pressable, Text, View } from "react-native";
import type { Block } from "@klypo/shared";
import { t } from "../../../i18n/pt-BR";
import { acceptProposal, deletePage, getPage, recordEvent, rejectProposal, saveVersion, type PageDetail } from "../../../lib/api";
import { draftKey, editableText, finalizeBlocks, withText, type PageDraft } from "../../../lib/editing";
import { usePolling } from "../../../lib/usePolling";
import { Banner, Button, Card, Chip, Field, H1, H2, P, Row, Screen, Spinner } from "../../../ui/components";
import { color, space } from "../../../ui/theme";

function BlockView({ b, segments }: { b: Block; segments: PageDetail["segments"] }) {
  const body = b.type === "paragraph" ? <P>{b.text}</P>
    : b.type === "callout" ? <Banner tone="info">{b.text}</Banner>
    : b.type === "list" ? <View style={{ gap: 4 }}>{b.items.map((i, n) => <P key={n}>{`• ${i}`}</P>)}</View>
    : b.type === "steps" ? <View style={{ gap: 4 }}>{b.items.map((i, n) => <P key={n}>{`${n + 1}. ${i}`}</P>)}</View>
    : <View style={{ gap: 4 }}><P muted>{t.page.tableReadOnly}</P><P>{b.header.join(" | ")}</P>{b.rows.map((r, n) => <P key={n}>{r.join(" | ")}</P>)}</View>;
  const live = b.evidence.filter((e) => segments[e]);
  const removed = b.evidence.length - live.length;
  return (
    <View style={{ gap: space.sm }}>
      <Chip tone={b.origin === "user" ? "accent" : b.origin === "synthesis" ? "warn" : "neutral"} label={t.page.provenance[b.origin]!} />
      {body}
      <Row style={{ flexWrap: "wrap" }}>
        {live.map((e, n) => (
          <Link key={e} href={{ pathname: "/source/[id]", params: { id: segments[e]!.source_id, segment: e } }} accessibilityLabel={`${t.page.viewSource} ${n + 1}`}>
            <Text style={{ color: color.accent, fontWeight: "600", paddingVertical: 12 }}>{`${t.page.viewSource}${live.length > 1 ? ` ${n + 1}` : ""}`}</Text>
          </Link>
        ))}
        {removed > 0 ? <Chip tone="danger" label={t.page.sourceRemoved} /> : null}
      </Row>
    </View>
  );
}

export default function PageScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const router = useRouter();
  const [d, setD] = useState<PageDetail | null | undefined>(undefined);
  const [draft, setDraft] = useState<PageDraft | null>(null);       // existe ⇔ editando
  const [conflict, setConflict] = useState(false);
  const [msg, setMsg] = useState<string | null>(null); const [error, setError] = useState<string | null>(null); const [busy, setBusy] = useState(false);
  const [showProposal, setShowProposal] = useState(false);
  const loadedDraft = useRef(false);

  const load = useCallback(async () => { try { setD(await getPage(id)); } catch { setD((x) => x ?? null); } }, [id]);
  usePolling(load, 4000, () => !draft && !busy);
  useEffect(() => { recordEvent("page_opened", id); }, [id]);

  // rascunho persistido: sobrevive a fechar o app no meio da edição
  useEffect(() => {
    if (!d || loadedDraft.current) return;
    loadedDraft.current = true;
    AsyncStorage.getItem(draftKey(id)).then((raw) => {
      if (!raw) return;
      try {
        const saved = JSON.parse(raw) as PageDraft;
        setDraft(saved); setMsg(t.page.draftRestored);
        if (saved.baseVersionId !== d.version.id) setConflict(true);
      } catch { /* rascunho corrompido é ignorado */ }
    }).catch(() => {});
  }, [d, id]);
  useEffect(() => { if (draft) AsyncStorage.setItem(draftKey(id), JSON.stringify(draft)).catch(() => {}); }, [draft, id]);

  if (d === undefined) return <Screen><Spinner /></Screen>;
  if (d === null) return <Screen><P muted>{t.page.notFound}</P></Screen>;
  const v = d.version;
  const isFake = v.model?.startsWith("fake");
  const stopEditing = async () => { setDraft(null); setConflict(false); await AsyncStorage.removeItem(draftKey(id)).catch(() => {}); };

  async function save() {
    if (!draft) return;
    setBusy(true); setError(null);
    try {
      const blocks = finalizeBlocks(v.blocks, draft.blocks);
      const r = await saveVersion({ page_id: id, base_version_id: draft.baseVersionId, title: draft.title, summary: draft.summary, blocks });
      if (r.status === "conflict") { setConflict(true); await load(); return; }
      await stopEditing(); setMsg(t.page.saved); await load();
    } catch (e) { setError(e instanceof Error && /Zod|invalid/i.test(e.message) ? t.common.error : t.common.error); }
    finally { setBusy(false); }
  }

  const confirmDelete = () => Alert.alert(t.page.deleteTitle, t.page.deleteBody, [
    { text: t.common.cancel, style: "cancel" },
    { text: t.common.delete, style: "destructive", onPress: async () => { await deletePage(id, false); router.back(); } },
    { text: t.page.deleteWithSources, style: "destructive", onPress: async () => { await deletePage(id, true); router.back(); } },
  ]);

  const setBlock = (i: number, nb: Block) => setDraft((x) => x && { ...x, blocks: x.blocks.map((b, n) => (n === i ? nb : b)) });

  return (
    <Screen>
      <Stack.Screen options={{ title: "" }} />
      {msg ? <Banner tone="ok">{msg}</Banner> : null}
      {error ? <Banner tone="danger">{error}</Banner> : null}
      {isFake ? <Banner tone="info">{t.page.fakeNotice}</Banner> : null}
      {d.hasProcessingJob ? <Chip tone="accent" label={t.page.reprocessRunning} /> : null}

      {d.proposal && !draft ? (
        <Card>
          <H2>{t.page.proposalTitle}</H2><P muted>{t.page.proposalBody}</P>
          {showProposal ? (
            <>
              <P>{d.proposal.title}</P><P muted>{d.proposal.summary}</P>
              {d.proposal.blocks.map((b) => <P key={b.id}>{editableText(b) ?? ""}</P>)}
              <Row>
                <Button label={t.page.proposalAccept} onPress={async () => { setBusy(true); const r = await acceptProposal(d.proposal!.id, v.id).finally(() => setBusy(false)); if (r.status === "conflict") setMsg(t.page.conflictTitle); setShowProposal(false); load(); }} />
                <Button label={t.page.proposalReject} variant="secondary" onPress={async () => { await rejectProposal(d.proposal!.id); setShowProposal(false); load(); }} />
              </Row>
            </>
          ) : <Button label={t.page.proposalReview} variant="secondary" onPress={() => setShowProposal(true)} />}
        </Card>
      ) : null}

      {conflict && draft ? (
        <Card>
          <H2>{t.page.conflictTitle}</H2><P muted>{t.page.conflictBody}</P>
          <Row>
            <Button label={t.page.conflictReapply} onPress={() => { setDraft({ ...draft, baseVersionId: v.id }); setConflict(false); }} />
            <Button label={t.page.conflictDiscard} variant="secondary" onPress={stopEditing} />
          </Row>
        </Card>
      ) : null}

      {draft ? (
        <>
          <Field label={t.page.titleLabel} value={draft.title} onChangeText={(title) => setDraft({ ...draft, title })} />
          <Field label={t.page.summaryLabel} value={draft.summary} onChangeText={(summary) => setDraft({ ...draft, summary })} multiline />
          {draft.blocks.map((b, i) => {
            const text = editableText(b);
            return (
              <Card key={b.id}>
                <Chip tone={b.origin === "user" ? "accent" : "neutral"} label={t.page.provenance[b.origin]!} />
                {text !== null ? <Field label={`Bloco ${i + 1}`} value={text} multiline onChangeText={(x) => setBlock(i, withText(b, x))} /> : <BlockView b={b} segments={d.segments} />}
                <Button label={t.page.removeBlock} variant="ghost" onPress={() => setDraft({ ...draft, blocks: draft.blocks.filter((_, n) => n !== i) })} />
              </Card>
            );
          })}
          <Button label={t.page.addNote} variant="secondary" onPress={() => setDraft({ ...draft, blocks: [...draft.blocks, { id: randomUUID(), origin: "user", type: "paragraph", text: "", evidence: [] }] })} />
          <Button label={t.page.saveEdit} onPress={save} busy={busy} disabled={conflict} />
          <Button label={t.page.discard} variant="ghost" onPress={stopEditing} />
        </>
      ) : (
        <>
          <H1>{v.title}</H1>
          <Row style={{ flexWrap: "wrap" }}>
            <Chip label={t.library.pageTypes[d.page.type] ?? d.page.type} />
            {v.title_is_generated ? <Chip label={t.page.generatedTitle} /> : null}
            {v.translated ? <Chip tone="warn" label={t.page.translated} /> : null}
            <Chip label={`${t.page.versionLabel} ${v.version_no}`} />
          </Row>
          {v.summary ? <Card><H2>{t.page.summary}</H2><P>{v.summary}</P></Card> : null}
          {v.blocks.map((b) => <Card key={b.id}><BlockView b={b} segments={d.segments} /></Card>)}
          <Card>
            <H2>{t.page.sources}</H2>
            {d.sources.map((s, n) => <Link key={s.id} href={`/source/${s.id}`}><Text style={{ color: color.accent, fontWeight: "600", paddingVertical: 12 }}>{`${t.source.title} ${n + 1}`}</Text></Link>)}
          </Card>
          <Button label={t.page.edit} onPress={() => setDraft({ baseVersionId: v.id, title: v.title, summary: v.summary, blocks: v.blocks })} />
          <Pressable accessibilityRole="button" onPress={confirmDelete} style={{ minHeight: 48, justifyContent: "center" }}><Text style={{ color: color.danger, fontWeight: "600", textAlign: "center" }}>{t.page.deleteTitle}</Text></Pressable>
        </>
      )}
    </Screen>
  );
}
