import { describe, expect, it } from "vitest";
import { finalizeBlocks, withText } from "./editing";
import type { Block } from "@klypo/shared";

const ev = "11111111-1111-4111-8111-111111111111";
const ex = (id: string, text: string): Block => ({ id, origin: "extracted", type: "paragraph", text, evidence: [ev] });

describe("edição de blocos", () => {
  it("bloco extraído alterado vira 'Sua anotação' sem evidência; intacto permanece extraído", () => {
    const original = [ex("a", "um"), ex("b", "dois")];
    const out = finalizeBlocks(original, [withText(original[0]!, "UM EDITADO"), original[1]!]);
    expect(out[0]).toMatchObject({ origin: "user", evidence: [], text: "UM EDITADO" });
    expect(out[1]).toMatchObject({ origin: "extracted", evidence: [ev] });
  });
  it("descarta blocos vazios e mantém anotações novas", () => {
    const note: Block = { id: "n", origin: "user", type: "paragraph", text: "minha", evidence: [] };
    const out = finalizeBlocks([ex("a", "um")], [withText(ex("a", "um"), "  "), note]);
    expect(out).toEqual([note]);
  });
  it("lista: uma linha por item", () => {
    const l: Block = { id: "l", origin: "extracted", type: "list", items: ["a"], evidence: [ev] };
    expect((withText(l, "x\n y \n") as any).items).toEqual(["x", "y"]);
  });
});
