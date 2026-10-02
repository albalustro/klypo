import { File } from "expo-file-system";
import { finalizeCapture, ApiError } from "../lib/api";
import { supabase } from "../lib/supabase";
import { UploadError, type QueueItem, type Remote } from "./core";

export const supabaseRemote: Remote = {
  async upload(item: QueueItem) {
    if (!item.localPath || !item.mime) throw new UploadError("fatal");
    const bytes = await new File(item.localPath).arrayBuffer();
    const { error } = await supabase.storage.from("captures").upload(`${item.ownerId}/${item.id}`, bytes, { contentType: item.mime, upsert: false });
    if (!error) return;
    const e = error as { statusCode?: string | number; message?: string };
    const status = Number(e.statusCode);
    if (status === 409 || /already exists|Duplicate/i.test(e.message ?? "")) throw new UploadError("exists");
    if (status === 401 || status === 403 || /JWT|expired/i.test(e.message ?? "")) throw new UploadError("auth");
    if (status === 413 || status === 415) throw new UploadError("fatal");
    throw new UploadError("transient");
  },
  async finalize(batchId, items) {
    try {
      const res = await finalizeCapture({
        batch_id: batchId, mode: "separate",
        items: items.map((i) => i.kind === "image"
          ? { kind: "image" as const, id: i.id, mime: i.mime!, size_bytes: i.sizeBytes ?? 1, position: i.position, note: i.note }
          : { kind: "text" as const, id: i.id, text: i.text ?? "", position: i.position, note: i.note }),
      });
      return res.map((r) => ({ id: r.id, status: r.status, error_code: r.error_code ?? null }));
    } catch (e) {
      if (e instanceof ApiError && e.code === "auth") throw new UploadError("auth");
      throw new UploadError("transient");
    }
  },
};
