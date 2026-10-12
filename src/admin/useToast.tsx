import { useCallback, useEffect, useRef, useState, type ReactNode } from 'react';
import { t } from '../i18n/t';
import './admin.css';

/** A short "Saved" message that goes away by itself. Returns [element to render, show(text)]. */
export function useToast(): [ReactNode, (text: string) => void] {
  const [text, setText] = useState<string | null>(null);
  const timer = useRef<number | undefined>(undefined);
  const show = useCallback((msg: string) => {
    setText(msg);
    window.clearTimeout(timer.current);
    timer.current = window.setTimeout(() => setText(null), 5000);
  }, []);
  useEffect(() => () => window.clearTimeout(timer.current), []);
  const node = text ? (
    <div className="adm-toast" role="status" data-testid="saved-toast">
      <span><span aria-hidden="true">✓ </span>{text}</span>
      <button type="button" onClick={() => setText(null)} aria-label={t('Dismiss')}>×</button>
    </div>
  ) : null;
  return [node, show];
}
