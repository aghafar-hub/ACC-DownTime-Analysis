import { useState } from 'react';
import { useAuth } from '../auth/AuthContext';
import AliasesTab from '../admin/master/AliasesTab';
import AreasTab from '../admin/master/AreasTab';
import EquipmentTab from '../admin/master/EquipmentTab';
import ReasonsTab from '../admin/master/ReasonsTab';
import { useToast } from '../admin/useToast';
import DataNotes from '../components/DataNotes';
import { PageHeader, TabBar } from '../components/Tile';
import { useStartup } from '../data/useStartup';
import { t } from '../i18n/t';
import { pageById, pageLabel } from '../navigation';
import { num } from '../util/format';
import '../components/ui.css';
import '../admin/admin.css';

type Sub = 'equipment' | 'areas' | 'reasons' | 'aliases';

export default function Master() {
  const st = useStartup();
  const { canEdit } = useAuth();
  const [sub, setSub] = useState<Sub>('equipment');
  const [toastNode, toast] = useToast();
  const s = st.startup;
  const edit = canEdit('master');
  const review = s ? s.equipment.filter((e) => e.needs_review).length : 0;
  const props = s ? { startup: s, canEdit: edit, reload: st.reload, toast } : null;
  return (
    <div className="page" data-testid="page-master">
      <PageHeader
        title={pageLabel(pageById('master'))}
        subtitle={s ? t('{codes} codes · {review} need review · {areas} areas · {reasons} reasons · {aliases} aliases', { codes: num(s.equipment.length), review: num(review), areas: s.areas.length, reasons: s.reasons.length, aliases: s.aliases.length }) : t('Loading…')}
      />
      <p className="status-line" style={{ marginBottom: 12 }} data-testid="access-level">
        {edit ? t('Your access to this page: can edit.') : t('Your access to this page: view only.')}
      </p>
      <DataNotes st={st} />
      {props && (
        <>
          <div className="adm-tabs">
            <TabBar
              testid="master-tabs" value={sub} onChange={(id) => setSub(id as Sub)}
              tabs={[
                { id: 'equipment', label: t('Equipment'), count: props.startup.equipment.length },
                { id: 'areas', label: t('Areas'), count: props.startup.areas.length },
                { id: 'reasons', label: t('Reasons'), count: props.startup.reasons.length },
                { id: 'aliases', label: t('Aliases'), count: props.startup.aliases.length },
              ]}
            />
          </div>
          {sub === 'equipment' && <EquipmentTab {...props} />}
          {sub === 'areas' && <AreasTab {...props} />}
          {sub === 'reasons' && <ReasonsTab {...props} />}
          {sub === 'aliases' && <AliasesTab {...props} />}
        </>
      )}
      {toastNode}
    </div>
  );
}
