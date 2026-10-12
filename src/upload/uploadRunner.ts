// Sends the rows to the server: start, chunks of about 300 rows, finish.
// Every step is safe to repeat (the server skips rows it already has), so a
// dropped connection is retried, and a run that still fails can be resumed
// from where it stopped.
import type { Api, UploadBatch, UploadRow } from '../api/types';
import { ApiError } from '../api/types';
import { t } from '../i18n/t';
import type { FinishWarning } from './review';

export const CHUNK_SIZE = 300;

export interface Progress {
  batchId?: string;
  /** chunks fully sent */
  chunksDone: number;
  totalChunks: number;
  rowsSent: number;
  totalRows: number;
  added: number;
  identical: number;
  rejected: { source_row: number; reason: string }[];
}

export interface UploadJob {
  fileName: string;
  fileHash: string;
  rows: UploadRow[];
  summary: { rows_read: number; rows_skipped: number };
  warnings: FinishWarning[];
}

export interface UploadOutcome { batch: UploadBatch; progress: Progress }

/** Thrown when sending stopped; `progress` is what to pass back to resume. */
export class UploadStopped extends Error {
  progress: Progress;
  constructor(message: string, progress: Progress) {
    super(message);
    this.name = 'UploadStopped';
    this.progress = progress;
  }
}

export interface RunnerOptions {
  chunkSize?: number;
  /** pause between tries, ms (tests pass 0) */
  retryDelaysMs?: number[];
  resume?: Progress;
  onProgress?: (p: Progress) => void;
  sleep?: (ms: number) => Promise<void>;
}

const RETRYABLE = new Set(['network', 'busy', 'server']);
const DEFAULT_DELAYS = [800, 2500, 6000];

async function withRetry<T>(fn: () => Promise<T>, delays: number[], sleep: (ms: number) => Promise<void>): Promise<T> {
  for (let attempt = 0; ; attempt++) {
    try {
      return await fn();
    } catch (err) {
      const retry = err instanceof ApiError ? RETRYABLE.has(err.code) : err instanceof TypeError;
      if (!retry || attempt >= delays.length) throw err;
      await sleep(delays[attempt] as number);
    }
  }
}

export function emptyProgress(totalRows: number, chunkSize = CHUNK_SIZE): Progress {
  return { chunksDone: 0, totalChunks: Math.ceil(totalRows / chunkSize), rowsSent: 0, totalRows, added: 0, identical: 0, rejected: [] };
}

export async function runUpload(api: Pick<Api, 'uploadStart' | 'uploadChunk' | 'uploadFinish'>, token: string, job: UploadJob, opts: RunnerOptions = {}): Promise<UploadOutcome> {
  const size = opts.chunkSize ?? CHUNK_SIZE;
  const delays = opts.retryDelaysMs ?? DEFAULT_DELAYS;
  const sleep = opts.sleep ?? ((ms: number) => new Promise<void>((r) => window.setTimeout(r, ms)));
  const p: Progress = opts.resume ? { ...opts.resume, rejected: [...opts.resume.rejected] } : emptyProgress(job.rows.length, size);
  const report = () => opts.onProgress?.({ ...p, rejected: [...p.rejected] });
  const stop = (err: unknown): never => {
    const why = err instanceof ApiError || err instanceof Error ? err.message : t('Something went wrong.');
    throw new UploadStopped(why, { ...p, rejected: [...p.rejected] });
  };
  try {
    if (!p.batchId) {
      p.batchId = (await withRetry(() => api.uploadStart(token, job.fileName, job.fileHash), delays, sleep)).batch_id;
    }
    report();
    for (let c = p.chunksDone; c < p.totalChunks; c++) {
      const part = job.rows.slice(c * size, (c + 1) * size);
      const res = await withRetry(() => api.uploadChunk(token, p.batchId as string, part), delays, sleep);
      p.added += res.added;
      p.identical += res.identical;
      p.rejected.push(...res.rejected);
      p.chunksDone = c + 1;
      p.rowsSent += part.length;
      report();
    }
    // rows the server refused are not stored: count them as skipped too
    const summary = { rows_read: job.summary.rows_read, rows_skipped: job.summary.rows_skipped + p.rejected.length };
    const batch = await withRetry(() => api.uploadFinish(token, p.batchId as string, summary, job.warnings), delays, sleep);
    return { batch, progress: p };
  } catch (err) {
    return stop(err);
  }
}
