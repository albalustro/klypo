import pg from "pg";

export type ClaimedJob = {
  id: string; owner_id: string; kind: "process_source" | "purge_source"; source_id: string;
  lease_token: string; attempts: number; max_attempts: number; request_key: string | null; pipeline_version: string | null;
};
export type Status = { status: string; [k: string]: any };

export interface JobDb {
  claim(worker: string, leaseSeconds: number): Promise<ClaimedJob | null>;
  heartbeat(job: ClaimedJob, leaseSeconds: number): Promise<Status>;
  setStage(job: ClaimedJob, stage: "extracting" | "structuring" | "indexing"): Promise<Status>;
  getSource(job: ClaimedJob): Promise<Status>;
  setFileInfo(job: ClaimedJob, hash: string, mime: string, size: number): Promise<Status>;
  getJobExtraction(job: ClaimedJob): Promise<Status>;
  saveExtraction(job: ClaimedJob, extraction: unknown, model: string, pipeline: string): Promise<Status>;
  finishNeedsReview(job: ClaimedJob, reason: string): Promise<Status>;
  persistPage(job: ClaimedJob, extractionId: string, page: unknown, model: string, usage: unknown): Promise<Status>;
  failJob(job: ClaimedJob, code: string, retryable: boolean): Promise<Status>;
  getPurgeTarget(job: ClaimedJob): Promise<Status>;
  completePurge(job: ClaimedJob): Promise<Status>;
  recordEvent(owner: string, name: string, entity: string | null, props: Record<string, unknown>): Promise<void>;
}

/** Acesso via funções SQL worker_* (cada uma revalida lease, dono e exclusão). */
export class PgJobDb implements JobDb {
  constructor(private pool: pg.Pool) {}
  private async one(sql: string, params: unknown[]): Promise<any> { return (await this.pool.query(sql, params)).rows[0]?.r; }
  private j = (job: ClaimedJob) => [job.id, job.lease_token];

  claim = (w: string, lease: number) => this.one("select public.claim_job($1,$2) r", [w, lease]);
  heartbeat = (job: ClaimedJob, s: number) => this.one("select public.worker_heartbeat($1,$2,$3) r", [...this.j(job), s]);
  setStage = (job: ClaimedJob, st: string) => this.one("select public.worker_set_stage($1,$2,$3) r", [...this.j(job), st]);
  getSource = (job: ClaimedJob) => this.one("select public.worker_get_source($1,$2) r", this.j(job));
  setFileInfo = (job: ClaimedJob, h: string, m: string, s: number) => this.one("select public.worker_set_file_info($1,$2,$3,$4,$5) r", [...this.j(job), h, m, s]);
  getJobExtraction = (job: ClaimedJob) => this.one("select public.worker_get_job_extraction($1,$2) r", this.j(job));
  saveExtraction = (job: ClaimedJob, e: unknown, model: string, p: string) => this.one("select public.worker_save_extraction($1,$2,$3,$4,$5) r", [...this.j(job), JSON.stringify(e), model, p]);
  finishNeedsReview = (job: ClaimedJob, r: string) => this.one("select public.worker_finish_needs_review($1,$2,$3) r", [...this.j(job), r]);
  persistPage = (job: ClaimedJob, x: string, page: unknown, model: string, usage: unknown) =>
    this.one("select public.worker_persist_page($1,$2,$3,$4,$5,$6) r", [...this.j(job), x, JSON.stringify(page), model, JSON.stringify(usage)]);
  failJob = (job: ClaimedJob, code: string, retryable: boolean) => this.one("select public.worker_fail_job($1,$2,$3,$4) r", [...this.j(job), code, retryable]);
  getPurgeTarget = (job: ClaimedJob) => this.one("select public.worker_get_purge_target($1,$2) r", this.j(job));
  completePurge = (job: ClaimedJob) => this.one("select public.worker_complete_purge($1,$2) r", this.j(job));
  async recordEvent(owner: string, name: string, entity: string | null, props: Record<string, unknown>) {
    await this.pool.query("select public.worker_record_event($1,$2,$3,$4)", [owner, name, entity, JSON.stringify(props)]);
  }
}
