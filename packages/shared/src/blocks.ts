import { z } from "zod";

const id = z.string().min(1).max(64);
const evidence = z.array(z.string().uuid()).max(20);
const text = z.string().trim().min(1).max(5000);

export const BlockOrigin = z.enum(["extracted", "synthesis", "user"]);
export type BlockOrigin = z.infer<typeof BlockOrigin>;

const base = { id, origin: BlockOrigin, evidence };

export const ParagraphBlock = z.strictObject({ ...base, type: z.literal("paragraph"), text });
export const ListBlock = z.strictObject({ ...base, type: z.literal("list"), items: z.array(text).min(1).max(100) });
export const StepsBlock = z.strictObject({ ...base, type: z.literal("steps"), items: z.array(text).min(1).max(100) });
export const TableBlock = z.strictObject({
  ...base,
  type: z.literal("table"),
  header: z.array(z.string().max(300)).min(1).max(12),
  rows: z.array(z.array(z.string().max(1000)).max(12)).max(200),
});
export const CalloutBlock = z.strictObject({ ...base, type: z.literal("callout"), text });

export const Block = z
  .discriminatedUnion("type", [ParagraphBlock, ListBlock, StepsBlock, TableBlock, CalloutBlock])
  .superRefine((b, ctx) => {
    // "Sua anotação" nunca carrega atribuição à fonte; conteúdo extraído sempre precisa de evidência.
    if (b.origin === "user" && b.evidence.length > 0) {
      ctx.addIssue({ code: "custom", message: "Bloco manual não pode citar evidência", path: ["evidence"] });
    }
    if (b.origin === "extracted" && b.evidence.length === 0) {
      ctx.addIssue({ code: "custom", message: "Bloco extraído exige ao menos uma evidência", path: ["evidence"] });
    }
  });
export type Block = z.infer<typeof Block>;

export const Blocks = z
  .array(Block)
  .max(200)
  .superRefine((blocks, ctx) => {
    const seen = new Set<string>();
    blocks.forEach((b, i) => {
      if (seen.has(b.id)) ctx.addIssue({ code: "custom", message: "Id de bloco duplicado", path: [i, "id"] });
      seen.add(b.id);
    });
  });

/** Texto plano de um bloco (para indexação e para checar evidência/URLs). */
export function blockPlainText(b: Block): string {
  switch (b.type) {
    case "paragraph":
    case "callout":
      return b.text;
    case "list":
    case "steps":
      return b.items.join("\n");
    case "table":
      return [b.header.join(" | "), ...b.rows.map((r) => r.join(" | "))].join("\n");
  }
}
