import { randomUUID } from "node:crypto";
import { describe, expect, it } from "vitest";
import { AiPageOutput, Blocks, ExtractionOutput as ExtractionSchema, FinalizeRequest, SaveVersionRequest, extractUrls, toPageBlocks, validateAiPage } from "./index";

const seg = (key: string, text: string) => ({ key, text });
const ex = { legibility: "legible", language: "pt", segments: [seg("s1", "Veja https://exemplo.com/a."), seg("s2", "texto")], issues: [] } as import("./index").ExtractionOutput;
const page = (over: object = {}) => ({
  title: "T", titleIsGenerated: true, summary: "S", type: "reference", language: "pt", translatedFromSource: false,
  suggestedTopics: [], blocks: [{ type: "paragraph", text: "x", evidence: ["s1"] }], ...over,
});

describe("blocos", () => {
  const e = randomUUID();
  it("extraído exige evidência; manual não pode ter; ids únicos; campos extras rejeitados", () => {
    const ok = { id: "a", origin: "extracted", type: "paragraph", text: "t", evidence: [e] };
    expect(Blocks.safeParse([ok]).success).toBe(true);
    expect(Blocks.safeParse([{ ...ok, evidence: [] }]).success).toBe(false);
    expect(Blocks.safeParse([{ ...ok, origin: "user" }]).success).toBe(false);
    expect(Blocks.safeParse([{ ...ok, origin: "user", evidence: [] }]).success).toBe(true);
    expect(Blocks.safeParse([ok, ok]).success).toBe(false);
    expect(Blocks.safeParse([{ ...ok, extra: 1 }]).success).toBe(false);
    expect(Blocks.safeParse([{ ...ok, evidence: ["não-uuid"] }]).success).toBe(false);
  });
});

describe("extração", () => {
  it("ilegível não traz segmentos; sem segmentos precisa ser ilegível; chaves únicas", () => {
    expect(ExtractionSchema.safeParse({ ...ex, legibility: "illegible" }).success).toBe(false);
    expect(ExtractionSchema.safeParse({ legibility: "legible", language: "pt", segments: [], issues: [] }).success).toBe(false);
    expect(ExtractionSchema.safeParse({ legibility: "illegible", language: "und", segments: [], issues: [] }).success).toBe(true);
    expect(ExtractionSchema.safeParse({ ...ex, segments: [seg("s1", "a"), seg("s1", "b")] }).success).toBe(false);
  });
});

describe("saída da IA (estruturar)", () => {
  it("valida schema estrito", () => {
    expect(AiPageOutput.safeParse(page()).success).toBe(true);
    expect(AiPageOutput.safeParse(page({ extra: true })).success).toBe(false);
    expect(AiPageOutput.safeParse(page({ blocks: [] })).success).toBe(false);
    expect(AiPageOutput.safeParse(page({ blocks: [{ type: "paragraph", text: "x", evidence: [] }] })).success).toBe(false);
    expect(AiPageOutput.safeParse(page({ type: "poema" })).success).toBe(false);
    expect(AiPageOutput.safeParse(page({ suggestedTopics: ["a", "b", "c", "d"] })).success).toBe(false);
  });
  it("referências devem existir; URLs só se estiverem na fonte", () => {
    const p = AiPageOutput.parse(page());
    expect(validateAiPage(p, ex)).toEqual([]);
    expect(validateAiPage(AiPageOutput.parse(page({ blocks: [{ type: "paragraph", text: "x", evidence: ["s9"] }] })), ex)[0]?.code).toBe("unknown_segment");
    expect(validateAiPage(AiPageOutput.parse(page({ summary: "ver www.fake.org" })), ex)[0]?.code).toBe("unsupported_url");
    expect(validateAiPage(AiPageOutput.parse(page({ summary: "ver https://exemplo.com/a" })), ex)).toEqual([]);   // pontuação final tolerada
    expect(extractUrls("a https://X.com/b, e www.y.org.")).toEqual(["x.com/b", "y.org"]);
  });
  it("toPageBlocks mapeia chaves para ids e marca origem 'extracted'", () => {
    const ids = new Map([["s1", randomUUID()], ["s2", randomUUID()]]);
    const blocks = toPageBlocks(AiPageOutput.parse(page()), ids, () => "b1");
    expect(blocks[0]).toMatchObject({ id: "b1", origin: "extracted", evidence: [ids.get("s1")] });
    expect(() => toPageBlocks(AiPageOutput.parse(page({ blocks: [{ type: "paragraph", text: "x", evidence: ["s7"] }] })), ids, () => "b")).toThrow();
  });
});

describe("contratos de API", () => {
  it("finalize e salvar versão", () => {
    const id = randomUUID();
    expect(FinalizeRequest.safeParse({ batch_id: id, mode: "separate", items: [{ kind: "image", id, mime: "image/png", size_bytes: 10, position: 0 }] }).success).toBe(true);
    expect(FinalizeRequest.safeParse({ batch_id: id, mode: "separate", items: [] }).success).toBe(false);
    expect(SaveVersionRequest.safeParse({ page_id: id, base_version_id: id, title: " ", summary: "", blocks: [] }).success).toBe(false);
  });
});
