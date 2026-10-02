/** Defaults. A fonte da verdade é a tabela server_config (migration); o app só usa isso para UX. */
export const DEFAULT_LIMITS = {
  maxImagesPerBatch: 10,
  maxImageBytes: 15 * 1024 * 1024,
  maxTextChars: 20_000,
  allowedMimes: ["image/jpeg", "image/png"] as const,
} as const;

export const PIPELINE_VERSION = "p1";
