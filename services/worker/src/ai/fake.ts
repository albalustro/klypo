/**
 * ADAPTADOR FAKE DETERMINÍSTICO — somente desenvolvimento/teste.
 * Não lê a imagem: usa um marcador de fixture anexado ao arquivo (ver makeFixtureImage). Imagens sem marcador
 * recebem um texto de demonstração rotulado "[FAKE]". Não é evidência de integração real com IA.
 */
import sharp from "sharp";
import type { AiProvider, ImageInput, Usage } from "./types";
import type { AiPageOutput, ExtractionOutput } from "@klypo/shared";

const MARK = "\nKLYPO-FIXTURE:";
const NO_USAGE: Usage = { inputTokens: 0, outputTokens: 0 };

export type FixtureSpec = {
  legibility?: "legible" | "partial" | "illegible";
  language?: string;
  segments?: string[];
  issues?: { code: "blurry" | "cropped" | "low_contrast" | "unreadable_region" | "no_text" | "other"; message: string }[];
  /** força falha transitória N vezes (para testar retries) — consumido pelo teste, não pelo adaptador */
};

/** PNG válido (para o sharp) + marcador de fixture ao final do arquivo. */
export async function makeFixtureImage(spec: FixtureSpec, size = 64): Promise<Buffer> {
  const png = await sharp({ create: { width: size, height: size, channels: 3, background: "#ffffff" } }).png().toBuffer();
  return Buffer.concat([png, Buffer.from(MARK + Buffer.from(JSON.stringify(spec)).toString("base64"))]);
}

function readSpec(buf: Buffer): FixtureSpec | null {
  const i = buf.lastIndexOf(MARK);
  if (i < 0) return null;
  try { return JSON.parse(Buffer.from(buf.subarray(i + MARK.length).toString("utf8"), "base64").toString("utf8")); } catch { return null; }
}

export class FakeProvider implements AiProvider {
  readonly id = "fake";
  readonly model = "fake-deterministic-v1";

  async extract(image: ImageInput) {
    const spec = readSpec(image.original) ?? {
      legibility: "legible" as const,
      language: "pt",
      segments: ["[FAKE] Texto de demonstração do adaptador de desenvolvimento.", "[FAKE] Esta não é a transcrição real da imagem."],
    };
    const legibility = spec.legibility ?? "legible";
    const segs = legibility === "illegible" ? [] : (spec.segments ?? []);
    const output: ExtractionOutput = {
      legibility: segs.length === 0 ? "illegible" : legibility,
      language: spec.language ?? "pt",
      segments: segs.map((text, i) => ({ key: `s${i + 1}`, text })),
      issues: spec.issues ?? (segs.length === 0 ? [{ code: "unreadable_region", message: "Não foi possível ler o texto da imagem." }] : []),
    };
    return { output, usage: NO_USAGE };
  }

  async structure({ extraction }: { extraction: ExtractionOutput; repairHint?: string }) {
    const [first, ...rest] = extraction.segments;
    const body = rest.length > 0 ? rest : first ? [first] : [];
    const title = (first?.text ?? "Sem título").replace(/\s+/g, " ").slice(0, 80);
    const output: AiPageOutput = {
      title,
      titleIsGenerated: true,
      summary: extraction.segments.map((s) => s.text).join(" ").replace(/\s+/g, " ").slice(0, 280) || title,
      type: "reference",
      language: extraction.language,
      translatedFromSource: false,
      blocks: body.map((s) => ({ type: "paragraph" as const, text: s.text, evidence: [s.key] })),
      suggestedTopics: [],
    };
    return { output, usage: NO_USAGE };
  }
}
