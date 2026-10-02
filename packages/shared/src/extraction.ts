import { z } from "zod";

export const Legibility = z.enum(["legible", "partial", "illegible"]);
export type Legibility = z.infer<typeof Legibility>;

/** Segmento de texto extraído. `key` é local à extração (ex.: "s1"); o banco atribui o uuid estável. */
export const ExtractedSegment = z.strictObject({
  key: z.string().regex(/^s[0-9]{1,4}$/),
  text: z.string().trim().min(1).max(4000),
  /** bbox só quando o provedor a fornece com confiança; nunca fabricar. Coordenadas normalizadas 0..1. */
  bbox: z
    .strictObject({ x: z.number().min(0).max(1), y: z.number().min(0).max(1), w: z.number().min(0).max(1), h: z.number().min(0).max(1) })
    .optional(),
});
export type ExtractedSegment = z.infer<typeof ExtractedSegment>;

export const ExtractionIssue = z.strictObject({
  code: z.enum(["blurry", "cropped", "low_contrast", "unreadable_region", "no_text", "other"]),
  message: z.string().max(300),
});

/** Metadados só quando literalmente presentes no conteúdo. Nunca inferidos. */
export const ExplicitMetadata = z.strictObject({
  author: z.string().max(200).optional(),
  publishedAt: z.string().max(60).optional(),
  url: z.string().max(500).optional(),
  title: z.string().max(300).optional(),
});

export const ExtractionOutput = z
  .strictObject({
    legibility: Legibility,
    language: z.string().min(2).max(12),
    segments: z.array(ExtractedSegment).max(300),
    issues: z.array(ExtractionIssue).max(20),
    explicitMetadata: ExplicitMetadata.optional(),
  })
  .superRefine((e, ctx) => {
    const keys = new Set<string>();
    e.segments.forEach((s, i) => {
      if (keys.has(s.key)) ctx.addIssue({ code: "custom", message: "Chave de segmento duplicada", path: ["segments", i, "key"] });
      keys.add(s.key);
    });
    if (e.legibility === "illegible" && e.segments.length > 0) {
      ctx.addIssue({ code: "custom", message: "Imagem ilegível não pode trazer segmentos", path: ["segments"] });
    }
    if (e.legibility !== "illegible" && e.segments.length === 0) {
      ctx.addIssue({ code: "custom", message: "Sem segmentos: marcar como ilegível", path: ["legibility"] });
    }
  });
export type ExtractionOutput = z.infer<typeof ExtractionOutput>;
