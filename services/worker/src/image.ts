import { createHash } from "node:crypto";
import sharp from "sharp";
import { PermanentError } from "./errors";

export type SniffedMime = "image/jpeg" | "image/png";

/** Valida o CONTEÚDO real do arquivo (magic bytes), não o MIME declarado. */
export function sniffMime(buf: Buffer): SniffedMime | null {
  if (buf.length >= 3 && buf[0] === 0xff && buf[1] === 0xd8 && buf[2] === 0xff) return "image/jpeg";
  if (buf.length >= 8 && buf.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))) return "image/png";
  return null;
}

export const sha256 = (b: Buffer) => createHash("sha256").update(b).digest("hex");

export async function prepareImage(original: Buffer, declaredMime: string | null, maxBytes: number) {
  if (original.length > maxBytes) throw new PermanentError("file_too_large");
  const real = sniffMime(original);
  if (!real || (declaredMime && declaredMime !== real)) throw new PermanentError("unsupported_content");
  try {
    // rotate() aplica a orientação EXIF; sharp descarta EXIF/GPS por padrão ao reencodar.
    const derivative = await sharp(original).rotate().resize({ width: 2000, height: 2000, fit: "inside", withoutEnlargement: true })
      .jpeg({ quality: 85 }).toBuffer();
    return { mime: real, hash: sha256(original), derivative };
  } catch {
    throw new PermanentError("unsupported_content");
  }
}
