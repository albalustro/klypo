/**
 * Adaptador real (Anthropic Messages API). NÃO verificado contra a API real nesta execução (sem credencial):
 * ver docs/build-status.md. Saída estruturada via output_config.format; toda saída ainda passa por Zod no pipeline.
 */
import Anthropic from "@anthropic-ai/sdk";
import { z } from "zod";
import { AiPageOutput, ExtractionOutput } from "@klypo/shared";
import type { AiProvider, ImageInput, Usage } from "./types";
import { EXTRACT_INSTRUCTION, PIPELINE_RULES, structureUserContent } from "./prompts";
import { PermanentError, RetryableError } from "../errors";

/** O esquema JSON enviado à API não suporta todas as restrições do Zod; a validação completa é feita depois. */
function jsonSchemaFor(schema: z.ZodType): Record<string, unknown> {
  const strip = (n: unknown): unknown => {
    if (Array.isArray(n)) return n.map(strip);
    if (n && typeof n === "object") {
      const o: Record<string, unknown> = {};
      for (const [k, v] of Object.entries(n)) {
        if (["minLength", "maxLength", "minimum", "maximum", "minItems", "maxItems", "pattern", "format", "$schema"].includes(k)) continue;
        o[k] = strip(v);
      }
      return o;
    }
    return n;
  };
  return strip(z.toJSONSchema(schema)) as Record<string, unknown>;
}

export class AnthropicProvider implements AiProvider {
  readonly id = "anthropic";
  private client: Anthropic;
  constructor(apiKey: string, readonly model: string, client?: Anthropic) {
    this.client = client ?? new Anthropic({ apiKey, maxRetries: 0 }); // retries são do job (backoff + limite no servidor)
  }

  private async call(content: Anthropic.MessageParam["content"], schema: z.ZodType): Promise<{ output: unknown; usage: Usage }> {
    let res: Anthropic.Message;
    try {
      res = await this.client.messages.create({
        model: this.model,
        max_tokens: 16000,
        system: PIPELINE_RULES,
        output_config: { effort: "low", format: { type: "json_schema", schema: jsonSchemaFor(schema) } },
        messages: [{ role: "user", content }],
      } as Anthropic.MessageCreateParamsNonStreaming);
    } catch (e) {
      const status = (e as { status?: number }).status;
      // 429/5xx/rede → reagendar; demais (400/401/403/404) → definitivo. Mensagens do provedor nunca são propagadas.
      if (status === undefined || status === 408 || status === 409 || status === 429 || status >= 500) throw new RetryableError("provider_error");
      throw new PermanentError("provider_error");
    }
    if (res.stop_reason === "refusal" || res.stop_reason === "max_tokens") throw new PermanentError("provider_error");
    const text = res.content.find((b): b is Anthropic.TextBlock => b.type === "text")?.text;
    if (!text) throw new PermanentError("invalid_ai_output");
    let output: unknown;
    try { output = JSON.parse(text); } catch { output = undefined; }
    return { output, usage: { inputTokens: res.usage.input_tokens, outputTokens: res.usage.output_tokens } };
  }

  extract(image: ImageInput) {
    return this.call(
      [
        { type: "image", source: { type: "base64", media_type: image.mediaType, data: image.derivative.toString("base64") } },
        { type: "text", text: EXTRACT_INSTRUCTION },
      ],
      ExtractionOutput,
    );
  }

  structure({ extraction, repairHint }: { extraction: z.infer<typeof ExtractionOutput>; repairHint?: string }) {
    return this.call(structureUserContent(extraction.segments, repairHint), AiPageOutput);
  }
}
