import sharp from "sharp";
import { describe, expect, it } from "vitest";
import { loadConfig } from "./config";
import { logEvent, setLogSink } from "./log";
import { prepareImage, sniffMime } from "./image";
import { PermanentError } from "./errors";

describe("imagem", () => {
  it("valida conteúdo real, não o MIME declarado", async () => {
    const png = await sharp({ create: { width: 10, height: 10, channels: 3, background: "#fff" } }).png().toBuffer();
    expect(sniffMime(png)).toBe("image/png");
    expect(sniffMime(Buffer.from("GIF89a..."))).toBeNull();
    await expect(prepareImage(png, "image/jpeg", 1e6)).rejects.toMatchObject({ code: "unsupported_content" });
    await expect(prepareImage(png, "image/png", 5)).rejects.toBeInstanceOf(PermanentError);
  });

  it("derivada não carrega EXIF/GPS e respeita orientação", async () => {
    const withGps = await sharp({ create: { width: 40, height: 20, channels: 3, background: "#f00" } })
      .jpeg().withExif({ IFD0: { Make: "CamCorp" }, IFD3: { GPSLatitudeRef: "N", GPSLatitude: "-23/1 32/1 0/1" } }).toBuffer();
    expect((await sharp(withGps).metadata()).exif).toBeDefined();         // o original TEM exif
    const { derivative } = await prepareImage(withGps, "image/jpeg", 1e7);
    expect((await sharp(derivative).metadata()).exif).toBeUndefined();     // a derivada não
  });
});

describe("logs operacionais", () => {
  it("só emitem chaves permitidas; conteúdo bruto é descartado", () => {
    const lines: string[] = [];
    setLogSink((l) => lines.push(l));
    logEvent("job_error", { job_id: "abc", code: "provider_error", text: "CONTEÚDO SECRETO", extracted_text: "x", message: "trecho da imagem", duration_ms: 12 });
    setLogSink((l) => console.log(l));
    const o = JSON.parse(lines[0]!);
    expect(o).toMatchObject({ event: "job_error", job_id: "abc", code: "provider_error", duration_ms: 12 });
    expect(lines[0]).not.toMatch(/SECRETO|trecho/);
  });
});

describe("config", () => {
  it("fake é proibido em produção; provedor real exige chave", () => {
    expect(() => loadConfig({ DATABASE_URL: "x", AI_PROVIDER: "fake", NODE_ENV: "production" })).toThrow(/proibido em produção/);
    expect(() => loadConfig({ DATABASE_URL: "x", AI_PROVIDER: "anthropic" })).toThrow(/ANTHROPIC_API_KEY/);
    expect(loadConfig({ DATABASE_URL: "x", AI_PROVIDER: "fake" }).AI_PROVIDER).toBe("fake");
  });
});
