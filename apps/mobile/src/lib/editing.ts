import type { Block } from "@klypo/shared";

export type PageDraft = { baseVersionId: string; title: string; summary: string; blocks: Block[] };

export const editableText = (b: Block): string | null =>
  b.type === "paragraph" || b.type === "callout" ? b.text : b.type === "list" || b.type === "steps" ? b.items.join("\n") : null;

export function withText(b: Block, text: string): Block {
  if (b.type === "paragraph" || b.type === "callout") return { ...b, text };
  if (b.type === "list" || b.type === "steps") return { ...b, items: text.split("\n").map((s) => s.trim()).filter(Boolean).length ? text.split("\n").map((s) => s.trim()).filter(Boolean) : [""] };
  return b;
}

const sameContent = (a: Block, b: Block) => JSON.stringify({ ...a, evidence: undefined, origin: undefined }) === JSON.stringify({ ...b, evidence: undefined, origin: undefined });

/**
 * Prepara os blocos para salvar: um bloco extraído/síntese que o usuário alterou passa a ser "Sua anotação"
 * (origem 'user', sem evidência) — nunca atribuímos à fonte um texto que a pessoa escreveu.
 * Blocos vazios (todos os itens/ texto em branco) são descartados.
 */
export function finalizeBlocks(original: Block[], draft: Block[]): Block[] {
  const orig = new Map(original.map((b) => [b.id, b]));
  const out: Block[] = [];
  for (const b of draft) {
    const empty = (b.type === "paragraph" || b.type === "callout") ? !b.text.trim() : (b.type === "list" || b.type === "steps") ? b.items.every((i) => !i.trim()) : false;
    if (empty) continue;
    const before = orig.get(b.id);
    if (b.origin !== "user" && before && !sameContent(before, b)) out.push({ ...b, origin: "user", evidence: [] } as Block);
    else out.push(b);
  }
  return out;
}

export const draftKey = (pageId: string) => `klypo:page-draft:${pageId}`;
