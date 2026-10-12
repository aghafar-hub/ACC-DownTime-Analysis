import type { ReactNode } from 'react';
import ShellModal from '../components/ShellModal';
import { t } from '../i18n/t';

/** A small popup that asks before something that is hard to undo. Esc, the close button and Back all cancel. */
export default function ConfirmDialog({
  title, children, confirmLabel, danger, busy, onConfirm, onCancel, icon = 'alert', testid = 'confirm-dialog',
}: {
  title: string;
  children: ReactNode;
  confirmLabel: string;
  danger?: boolean;
  busy?: boolean;
  onConfirm: () => void;
  onCancel: () => void;
  icon?: string;
  testid?: string;
}) {
  return (
    <ShellModal
      icon={icon}
      title={title}
      onClose={onCancel}
      width={460}
      testid={testid}
      footer={
        <>
          <button type="button" className="btn" onClick={onCancel} disabled={busy} data-testid="confirm-cancel">{t('Cancel')}</button>
          <button type="button" className={danger ? 'btn-danger' : 'btn-primary'} onClick={onConfirm} disabled={busy} data-testid="confirm-ok">
            {busy ? t('Working…') : confirmLabel}
          </button>
        </>
      }
    >
      <div className="adm-note" style={{ margin: 0 }}>{children}</div>
    </ShellModal>
  );
}
