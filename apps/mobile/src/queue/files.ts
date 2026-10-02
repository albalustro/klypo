import { Directory, File, Paths } from "expo-file-system";
import type { LocalFiles } from "./core";

export const capturesDir = () => new Directory(Paths.document, "captures");

export const localFiles: LocalFiles = {
  async exists(path) { return new File(path).exists; },
  async delete(path) { const f = new File(path); if (f.exists) f.delete(); },
};

/** Copia para armazenamento durável do app ANTES de registrar na fila (cache do sistema pode ser limpo). */
export function copyToDurable(srcUri: string, id: string, ext: "jpg" | "png"): string {
  const dir = capturesDir();
  if (!dir.exists) dir.create({ intermediates: true });
  const dest = new File(dir, `${id}.${ext}`);
  new File(srcUri).copy(dest);
  return dest.uri;
}
