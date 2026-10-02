import type { AiPageOutput, ExtractionOutput } from "@klypo/shared";

export type Usage = { inputTokens: number; outputTokens: number };

export interface ImageInput {
  /** Bytes originais (usados só por adaptadores de fixture). */
  original: Buffer;
  /** Derivada normalizada para análise: orientação corrigida, sem EXIF/GPS. */
  derivative: Buffer;
  mediaType: "image/jpeg";
}

export interface AiProvider {
  /** Identificador do provedor e do modelo, gravados em cada extração/versão. */
  readonly id: string;
  readonly model: string;
  /** Transcrição fiel. Nunca completar texto ilegível. */
  extract(image: ImageInput): Promise<{ output: unknown; usage: Usage }>;
  /** Estrutura a página. `repairHint` descreve por que a tentativa anterior foi rejeitada. */
  structure(input: { extraction: ExtractionOutput; repairHint?: string }): Promise<{ output: unknown; usage: Usage }>;
}
export type { AiPageOutput, ExtractionOutput };
