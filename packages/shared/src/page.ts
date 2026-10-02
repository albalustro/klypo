import { z } from "zod";
import { Blocks, blockPlainText, type Block } from "./blocks";
import { PageType } from "./states";
import type { ExtractionOutput } from "./extraction";

const title = z.string().trim().min(1).max(200);
const summary = z.string().trim().min(1).max(1500);

/**
 * Saída da IA na etapa "estruturar". As referências de evidência são chaves de segmento
 * ("s1"), validadas contra a extração real antes de qualquer persistência.
 */
export const AiBlockInput = z.object({}).passthrough();
export const AiPageOutput = z.strictObject({
  title,
  /** "Título gerado pelo Klypo" quando não há título publicado explícito. */
  titleIsGenerated: z.boolean(),
  summary,
  type: PageType,
  language: z.string().min(2).max(12),
  translatedFromSource: z.boolean(),
  blocks: z
    .array(
      z.discriminatedUnion("type", [
        z.strictObject({ type: z.literal("paragraph"), text: z.string().trim().min(1).max(5000), evidence: z.array(z.string()).min(1).max(20) }),
        z.strictObject({ type: z.literal("list"), items: z.array(z.string().trim().min(1).max(5000)).min(1).max(100), evidence: z.array(z.string()).min(1).max(20) }),
        z.strictObject({ type: z.literal("steps"), items: z.array(z.string().trim().min(1).max(5000)).min(1).max(100), evidence: z.array(z.string()).min(1).max(20) }),
        z.strictObject({
          type: z.literal("table"),
          header: z.array(z.string().max(300)).min(1).max(12),
          rows: z.array(z.array(z.string().max(1000)).max(12)).max(200),
          evidence: z.array(z.string()).min(1).max(20),
        }),
        z.strictObject({ type: z.literal("callout"), text: z.string().trim().min(1).max(5000), evidence: z.array(z.string()).min(1).max(20) }),
      ]),
    )
    .min(1)
    .max(100),
  suggestedTopics: z.array(z.string().trim().min(1).max(60)).max(3),
});
export type AiPageOutput = z.infer<typeof AiPageOutput>;

export type EvidenceProblem = { code: "unknown_segment" | "unsupported_url" | "empty_blocks"; detail: string };

const URL_RE = /\b(?:https?:\/\/|www\.)[^\s)>\]"']+/gi;
const normUrl = (u: string) => u.toLowerCase().replace(/[.,;:!?]+$/, "").replace(/^https?:\/\//, "").replace(/^www\./, "");

/** URLs que aparecem em `text`. */
export function extractUrls(text: string): string[] {
  return (text.match(URL_RE) ?? []).map(normUrl);
}

/**
 * Valida a saída da IA contra a extração real:
 * - todo id de evidência precisa existir como segmento;
 * - nenhuma URL pode aparecer na página sem aparecer nos segmentos (não inventar URL).
 */
export function validateAiPage(out: AiPageOutput, extraction: Pick<ExtractionOutput, "segments">): EvidenceProblem[] {
  const problems: EvidenceProblem[] = [];
  const keys = new Set(extraction.segments.map((s) => s.key));
  const sourceUrls = new Set(extraction.segments.flatMap((s) => extractUrls(s.text)));
  out.blocks.forEach((b, i) => {
    for (const k of b.evidence) {
      if (!keys.has(k)) problems.push({ code: "unknown_segment", detail: `bloco ${i}: segmento "${k}" não existe` });
    }
  });
  const generated = [out.title, out.summary, ...out.blocks.map((b) => blockPlainText({ ...b, id: "x", origin: "extracted", evidence: [] } as unknown as Block))].join("\n");
  for (const u of extractUrls(generated)) {
    if (!sourceUrls.has(u)) problems.push({ code: "unsupported_url", detail: `URL não presente na fonte: ${u}` });
  }
  return problems;
}

/** Converte a saída validada da IA em blocos persistíveis, mapeando chaves de segmento → uuids. */
export function toPageBlocks(out: AiPageOutput, segmentIdByKey: ReadonlyMap<string, string>, newId: () => string): Block[] {
  const blocks = out.blocks.map((b) => {
    const evidence = b.evidence.map((k) => {
      const id = segmentIdByKey.get(k);
      if (!id) throw new Error(`segmento ${k} sem id`);
      return id;
    });
    return { ...b, id: newId(), origin: "extracted" as const, evidence };
  });
  return Blocks.parse(blocks);
}

/** Conteúdo editável de uma versão (o que o usuário vê/edita). */
export const PageContent = z.strictObject({
  title,
  summary: summary.or(z.literal("")),
  blocks: Blocks,
});
export type PageContent = z.infer<typeof PageContent>;
