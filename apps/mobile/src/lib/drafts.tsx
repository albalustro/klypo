import * as ImageManipulator from "expo-image-manipulator";
import * as ImagePicker from "expo-image-picker";
import { createContext, useCallback, useContext, useMemo, useState, type ReactNode } from "react";
import { randomUUID } from "expo-crypto";
import { DEFAULT_LIMITS } from "@klypo/shared";
import { File } from "expo-file-system";

export type Draft = { id: string; kind: "image" | "text"; uri?: string; mime?: "image/jpeg" | "image/png"; sizeBytes?: number; text?: string };
export type PickResult = { ok: true; added: number } | { ok: false; reason: "permission_photos" | "permission_camera" | "too_many" | "too_large" | "canceled" | "failed" };

type Ctx = {
  drafts: Draft[]; batchId: string;
  pickFromGallery: () => Promise<PickResult>; takePhoto: () => Promise<PickResult>;
  addText: (text: string) => void; addShared: (files: { path: string; mimeType?: string | null }[], text?: string | null) => Promise<PickResult>;
  remove: (id: string) => void; clear: () => void;
};
const DraftCtx = createContext<Ctx | null>(null);

/** JPEG/PNG passam direto; HEIC e demais formatos são normalizados para JPEG no aparelho. */
async function normalize(uri: string, mime?: string | null): Promise<Draft | "too_large"> {
  let outUri = uri; let outMime: "image/jpeg" | "image/png" = mime === "image/png" ? "image/png" : "image/jpeg";
  const isJpegOrPng = mime === "image/jpeg" || mime === "image/png" || /\.(jpe?g|png)$/i.test(uri);
  if (!isJpegOrPng) {
    const ref = await ImageManipulator.ImageManipulator.manipulate(uri).renderAsync();
    const saved = await ref.saveAsync({ format: ImageManipulator.SaveFormat.JPEG, compress: 0.9 });
    outUri = saved.uri; outMime = "image/jpeg";
  } else if (/\.png$/i.test(uri)) outMime = "image/png";
  const size = new File(outUri).size ?? 0;
  if (size > DEFAULT_LIMITS.maxImageBytes) return "too_large";
  return { id: randomUUID(), kind: "image", uri: outUri, mime: outMime, sizeBytes: size };
}

export function DraftProvider({ children }: { children: ReactNode }) {
  const [drafts, setDrafts] = useState<Draft[]>([]);
  const [batchId, setBatchId] = useState(() => randomUUID());

  const append = useCallback((next: Draft[]) => setDrafts((d) => [...d, ...next]), []);
  const normalizeAll = useCallback(async (assets: { uri: string; mimeType?: string | null }[]): Promise<PickResult> => {
    if (drafts.length + assets.length > DEFAULT_LIMITS.maxImagesPerBatch) return { ok: false, reason: "too_many" };
    try {
      const out: Draft[] = [];
      for (const a of assets) { const r = await normalize(a.uri, a.mimeType); if (r === "too_large") return { ok: false, reason: "too_large" }; out.push(r); }
      append(out);
      return { ok: true, added: out.length };
    } catch { return { ok: false, reason: "failed" }; }
  }, [drafts.length, append]);

  const value = useMemo<Ctx>(() => ({
    drafts, batchId,
    async pickFromGallery() {
      const perm = await ImagePicker.requestMediaLibraryPermissionsAsync();
      if (!perm.granted && perm.accessPrivileges !== "limited") return { ok: false, reason: "permission_photos" };
      const res = await ImagePicker.launchImageLibraryAsync({
        mediaTypes: ["images"], allowsMultipleSelection: true, selectionLimit: DEFAULT_LIMITS.maxImagesPerBatch - drafts.length, exif: false, quality: 1,
      });
      if (res.canceled) return { ok: false, reason: "canceled" };
      return normalizeAll(res.assets.map((a) => ({ uri: a.uri, mimeType: a.mimeType })));
    },
    async takePhoto() {
      const perm = await ImagePicker.requestCameraPermissionsAsync();
      if (!perm.granted) return { ok: false, reason: "permission_camera" };
      const res = await ImagePicker.launchCameraAsync({ mediaTypes: ["images"], exif: false, quality: 1 });
      if (res.canceled) return { ok: false, reason: "canceled" };
      return normalizeAll(res.assets.map((a) => ({ uri: a.uri, mimeType: a.mimeType })));
    },
    addText(text) { append([{ id: randomUUID(), kind: "text", text }]); },
    async addShared(files, text) {
      const r = files.length ? await normalizeAll(files.filter((f) => !f.mimeType || f.mimeType.startsWith("image/")).map((f) => ({ uri: f.path, mimeType: f.mimeType }))) : ({ ok: true, added: 0 } as PickResult);
      if (text && text.trim()) append([{ id: randomUUID(), kind: "text", text: text.trim() }]);
      return r;
    },
    remove(id) { setDrafts((d) => d.filter((x) => x.id !== id)); },
    clear() { setDrafts([]); setBatchId(randomUUID()); },
  }), [drafts, batchId, normalizeAll, append]);
  return <DraftCtx.Provider value={value}>{children}</DraftCtx.Provider>;
}
export const useDrafts = () => { const c = useContext(DraftCtx); if (!c) throw new Error("DraftProvider ausente"); return c; };
