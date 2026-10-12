import { useEffect, useState } from 'react';
import { t } from '../i18n/t';
import { InstallCard } from './InstallGuide';
import ShellModal, { FormSection } from './ShellModal';
import ThemePicker from './ThemePicker';
import { OPEN_APPEARANCE_EVENT } from './TopBar';

/** Theme picker and install card in a popup, for anyone (the Settings tab is for admins). */
export default function AppearanceModal() {
  const [open, setOpen] = useState(false);
  useEffect(() => {
    const on = () => setOpen(true);
    window.addEventListener(OPEN_APPEARANCE_EVENT, on);
    return () => window.removeEventListener(OPEN_APPEARANCE_EVENT, on);
  }, []);
  if (!open) return null;
  return (
    <ShellModal icon="palette" title={t('Appearance')} subtitle={t('Kept on this device')} onClose={() => setOpen(false)} width={680} testid="appearance-modal"
      footer={<button type="button" className="btn-primary" onClick={() => setOpen(false)}>{t('Done')}</button>}>
      <FormSection icon="palette" title={t('Theme')} hint={t('Applies at once')}>
        <ThemePicker />
      </FormSection>
      <InstallCard />
    </ShellModal>
  );
}
