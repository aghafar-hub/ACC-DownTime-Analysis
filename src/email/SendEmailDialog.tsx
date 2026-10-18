// "Send by email" (backend 1.9.0): To (typed addresses as chips, or people picked from the app), Cc, subject, a message
// and, when the caller offers one, "Attach Excel". The caller builds the summary body and the files when Send is pressed
// (the PDF is drawn from the pages on screen); this dialog only collects and sends. Used by Reports and the actions report.
import { useId, useMemo, useState, type KeyboardEvent } from 'react';
import { api, describeError } from '../api';
import type { ActionPerson, MailAttachment, SendResult } from '../api/types';
import { useAuth } from '../auth/AuthContext';
import ShellModal from '../components/ShellModal';
import { t } from '../i18n/t';
import { Icon } from '../icons';
import { parseAddresses } from './emailHtml';
import './email.css';

export interface BuiltEmail { html: string; attachments: MailAttachment[] }

export interface SendEmailProps {
  title: string;
  defaultSubject: string;
  kind: 'report' | 'actions';
  /** people of the app to pick from (no addresses needed: the server looks them up) */
  people: ActionPerson[];
  /** offer "Attach Excel" */
  excel: boolean;
  /** makes the body and the files; `progress` shows what it is doing */
  build: (opts: { message: string; attachExcel: boolean; progress: (text: string) => void }) => Promise<BuiltEmail>;
  onClose: () => void;
  onSent: (r: SendResult, to: number) => void;
}

/** The addresses typed so far but not turned into chips yet count as well (Send works without pressing Enter first). */
function AddressField({ id, label, chips, onChips, text, onText, people, picked, onPicked, testid }: {
  id: string; label: string; chips: string[]; onChips: (c: string[]) => void; text: string; onText: (s: string) => void;
  people?: ActionPerson[]; picked?: string[]; onPicked?: (ids: string[]) => void; testid: string;
}) {
  const setText = onText;
  const [bad, setBad] = useState<string[]>([]);
  const commit = (raw: string) => {
    const { ok, bad: wrong } = parseAddresses(raw);
    if (ok.length) onChips([...chips, ...ok.filter((a) => !chips.includes(a))]);
    setBad(wrong);
    setText(wrong.join(' '));
  };
  const onKey = (e: KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Enter' || e.key === ',' || e.key === ';') { e.preventDefault(); commit(text); }
    if (e.key === 'Backspace' && text === '' && chips.length) onChips(chips.slice(0, -1));
  };
  const names = new Map((people ?? []).map((p) => [p.user_id, p.display_name]));
  const free = (people ?? []).filter((p) => !(picked ?? []).includes(p.user_id));
  return (
    <div className="field ems-field">
      <label htmlFor={id}>{label}</label>
      <div className="ems-chips" data-testid={`${testid}-chips`}>
        {(picked ?? []).map((uid) => (
          <span key={uid} className="ems-chip ems-chip--person" data-testid={`${testid}-person`}>
            <Icon name="users" size={12} /> {names.get(uid) ?? uid}
            <button type="button" onClick={() => onPicked?.((picked ?? []).filter((x) => x !== uid))} aria-label={t('Remove {n}', { n: names.get(uid) ?? uid })}><Icon name="close" size={12} /></button>
          </span>
        ))}
        {chips.map((c) => (
          <span key={c} className="ems-chip" data-testid={`${testid}-chip`}>
            {c}
            <button type="button" onClick={() => onChips(chips.filter((x) => x !== c))} aria-label={t('Remove {n}', { n: c })}><Icon name="close" size={12} /></button>
          </span>
        ))}
        <input
          id={id} className="ems-input" type="email" inputMode="email" autoComplete="off" multiple value={text}
          placeholder={chips.length || (picked ?? []).length ? '' : t('name@company.com')}
          onChange={(e) => setText(e.target.value)} onKeyDown={onKey} onBlur={() => text.trim() && commit(text)} data-testid={testid}
        />
      </div>
      {bad.length > 0 && <span className="field-error" role="alert" data-testid={`${testid}-bad`}>{t('Not an email address: {a}', { a: bad.join(', ') })}</span>}
      {people && onPicked && free.length > 0 && (
        <select className="input ems-pick" value="" onChange={(e) => { if (e.target.value) onPicked([...(picked ?? []), e.target.value]); }} aria-label={t('Add a person from the app')} data-testid={`${testid}-pick`}>
          <option value="">{t('+ Add a person from the app…')}</option>
          {free.map((p) => <option key={p.user_id} value={p.user_id}>{p.display_name}</option>)}
        </select>
      )}
    </div>
  );
}

export default function SendEmailDialog({ title, defaultSubject, kind, people, excel, build, onClose, onSent }: SendEmailProps) {
  const uid = useId();
  const { token } = useAuth();
  const [toChips, setTo] = useState<string[]>([]);
  const [toText, setToText] = useState('');
  const [users, setUsers] = useState<string[]>([]);
  const [ccChips, setCc] = useState<string[]>([]);
  const [ccText, setCcText] = useState('');
  const merge = (chips: string[], text: string) => [...new Set([...chips, ...parseAddresses(text).ok])];
  const to = useMemo(() => merge(toChips, toText), [toChips, toText]);
  const cc = useMemo(() => merge(ccChips, ccText).filter((x) => !to.includes(x)), [ccChips, ccText, to]);
  const typedBad = parseAddresses(toText).bad.length + parseAddresses(ccText).bad.length;
  const [subject, setSubject] = useState(defaultSubject);
  const [message, setMessage] = useState('');
  const [attachExcel, setAttachExcel] = useState(false);
  const [busy, setBusy] = useState(false);
  const [step, setStep] = useState('');
  const [error, setError] = useState<string | null>(null);
  const count = to.length + users.length;
  const problem = useMemo(() => (typedBad ? t('Correct or remove what is not an email address.') : count === 0 ? t('Add at least one recipient.') : count > 25 ? t('At most 25 recipients in To.') : cc.length > 25 ? t('At most 25 in Cc.')
    : !subject.trim() ? t('Write a subject.') : subject.length > 200 ? t('The subject is longer than 200 characters.') : null), [count, cc.length, subject, typedBad]);

  async function send() {
    if (problem || busy || !token) return;
    setBusy(true);
    setError(null);
    try {
      const built = await build({ message, attachExcel, progress: setStep });
      setStep(t('Sending…'));
      const r = await api.sendReport(token, { to, users, cc, subject: subject.trim(), html: built.html, attachments: built.attachments, kind });
      onSent(r, r.recipients ?? count + cc.length);
    } catch (err) {
      setError(describeError(err));
      setStep('');
    } finally {
      setBusy(false);
    }
  }

  const footer = (
    <>
      <span className="sm-foot-note" role="status" aria-live="polite" data-testid="ems-step">{busy ? step : problem ?? ''}</span>
      <button type="button" className="btn" onClick={onClose} disabled={busy} data-testid="ems-cancel">{t('Cancel')}</button>
      <button type="button" className="btn-primary" onClick={() => void send()} disabled={busy || !!problem} data-testid="ems-send">
        <Icon name="send" size={15} /> {busy ? t('Sending…') : t('Send')}
      </button>
    </>
  );
  return (
    <ShellModal icon="mail" title={title} width={640} testid="send-email" onClose={busy ? () => undefined : onClose} footer={footer}
      subtitle={t('The email holds a summary; the report goes with it as a PDF. Replies come back to you.')}>
      {error && <div className="callout callout--danger" role="alert" data-testid="ems-error"><Icon name="alert" size={16} /><span>{error}</span></div>}
      <div className="ems-grid">
        <AddressField id={`${uid}-to`} label={t('To')} chips={toChips} onChips={setTo} text={toText} onText={setToText} people={people} picked={users} onPicked={setUsers} testid="ems-to" />
        <AddressField id={`${uid}-cc`} label={t('Cc (optional)')} chips={ccChips} onChips={setCc} text={ccText} onText={setCcText} testid="ems-cc" />
        <div className="field ems-field">
          <label htmlFor={`${uid}-subject`}>{t('Subject')}</label>
          <input id={`${uid}-subject`} className="input" value={subject} maxLength={220} onChange={(e) => setSubject(e.target.value)} data-testid="ems-subject" />
        </div>
        <div className="field ems-field">
          <label htmlFor={`${uid}-msg`}>{t('Message (optional)')}</label>
          <textarea id={`${uid}-msg`} className="input ems-msg" rows={4} maxLength={4000} value={message} onChange={(e) => setMessage(e.target.value)} data-testid="ems-message"
            placeholder={t('A few words above the summary.')} />
        </div>
        {excel && (
          <label className="ems-check">
            <input type="checkbox" checked={attachExcel} onChange={(e) => setAttachExcel(e.target.checked)} data-testid="ems-excel" />
            {t('Also attach the Excel file')}
          </label>
        )}
      </div>
    </ShellModal>
  );
}
