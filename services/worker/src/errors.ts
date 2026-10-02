import type { ErrorCode } from "@klypo/shared";

/** Falha definitiva: o job termina como 'failed' e a fonte é preservada. */
export class PermanentError extends Error {
  constructor(public code: ErrorCode, message = code) { super(message); this.name = "PermanentError"; }
}
/** Falha transitória: reagenda com backoff até o limite de tentativas. */
export class RetryableError extends Error {
  constructor(public code: ErrorCode, message = code) { super(message); this.name = "RetryableError"; }
}
/** O job perdeu o lease ou foi cancelado (ex.: exclusão): abandonar sem efeitos. */
export class AbortJob extends Error {
  constructor(public reason: "lease_lost" | "cancelled") { super(reason); this.name = "AbortJob"; }
}
