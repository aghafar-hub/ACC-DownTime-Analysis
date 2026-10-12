import { useCallback, useRef, useState } from 'react';
import { api, describeError } from '../api';
import type { UploadBatch } from '../api/types';
import { useAuth } from '../auth/AuthContext';
import { startupResource } from '../data/stores';
import { t } from '../i18n/t';
import { loadReview, refreshAfterUpload } from './loadReview';
import { parseWorkbook, type RefusedFile } from './parseWorkbook';
import {
  buildPlan, decideAll, decisionsComplete, type Decision, type Decisions, type Plan, type Review,
} from './review';
import { runUpload, UploadStopped, type Progress } from './uploadRunner';

export type Phase = 'idle' | 'reading' | 'review' | 'sending' | 'done';

export interface Result { batch: UploadBatch; progress: Progress; plan: Plan; fileName: string }

async function sha256Hex(buf: ArrayBuffer): Promise<string> {
  if (!globalThis.crypto?.subtle) return '';
  const d = await globalThis.crypto.subtle.digest('SHA-256', buf);
  return Array.from(new Uint8Array(d), (b) => b.toString(16).padStart(2, '0')).join('');
}

/** The steps of one upload: choose a file, review, send, result. Nothing is sent before the person confirms. */
export function useUploadFlow(onDone: () => void) {
  const { token } = useAuth();
  const [phase, setPhase] = useState<Phase>('idle');
  const [stage, setStage] = useState('');
  const [fileName, setFileName] = useState('');
  const [refusal, setRefusal] = useState<RefusedFile | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [review, setReview] = useState<Review | null>(null);
  const [decisions, setDecisions] = useState<Decisions>({});
  const [progress, setProgress] = useState<Progress | null>(null);
  const [stopped, setStopped] = useState<UploadStopped | null>(null);
  const [result, setResult] = useState<Result | null>(null);
  const busy = useRef(false);
  const hash = useRef('');
  const plan = useRef<Plan | null>(null);

  const reset = useCallback(() => {
    busy.current = false;
    setPhase('idle');
    setRefusal(null);
    setError(null);
    setReview(null);
    setDecisions({});
    setProgress(null);
    setStopped(null);
    setResult(null);
    setFileName('');
    plan.current = null;
  }, []);

  const chooseFile = useCallback(async (file: File) => {
    if (!token || busy.current) return;
    busy.current = true;
    setRefusal(null);
    setError(null);
    setReview(null);
    setDecisions({});
    setResult(null);
    setStopped(null);
    setFileName(file.name);
    setPhase('reading');
    try {
      setStage(t('Reading the workbook…'));
      const buf = await file.arrayBuffer();
      hash.current = await sha256Hex(buf);
      const parsed = await parseWorkbook(buf);
      if (!parsed.ok) {
        setRefusal(parsed);
        setPhase('idle');
        return;
      }
      const r = await loadReview(token, parsed, setStage);
      setReview(r);
      setPhase('review');
    } catch (err) {
      setError(describeError(err));
      setPhase('idle');
    } finally {
      busy.current = false;
    }
  }, [token]);

  const decide = useCallback((fp: string, d: Decision) => setDecisions((cur) => ({ ...cur, [fp]: d })), []);
  const decideEvery = useCallback((d: Decision) => review && setDecisions(decideAll(review, d)), [review]);

  const send = useCallback(async (resume?: Progress) => {
    if (!token || !review || busy.current) return;
    if (!resume && !decisionsComplete(review, decisions)) return;
    busy.current = true;
    setStopped(null);
    setPhase('sending');
    try {
      const p = resume ? (plan.current as Plan) : buildPlan(review, decisions);
      plan.current = p;
      const out = await runUpload(
        api, token,
        { fileName, fileHash: hash.current, rows: p.rows, summary: p.summary, warnings: p.warnings },
        { resume, onProgress: setProgress },
      );
      refreshAfterUpload(token, review.parsed, startupResource.getSnapshot().data?.years ?? []);
      setResult({ batch: out.batch, progress: out.progress, plan: p, fileName });
      setPhase('done');
      onDone();
    } catch (err) {
      if (err instanceof UploadStopped) {
        setStopped(err);
        setProgress(err.progress);
      } else {
        setStopped(new UploadStopped(describeError(err), progress ?? { chunksDone: 0, totalChunks: 0, rowsSent: 0, totalRows: 0, added: 0, identical: 0, rejected: [] }));
      }
    } finally {
      busy.current = false;
    }
  }, [token, review, decisions, fileName, onDone, progress]);

  return { phase, stage, fileName, refusal, error, review, decisions, decide, decideEvery, progress, stopped, result, chooseFile, send, reset };
}
