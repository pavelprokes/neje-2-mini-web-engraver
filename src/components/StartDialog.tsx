'use client';

import { useEffect, useId, useRef, useState } from 'react';
import { useI18n } from '@/i18n/I18nProvider';
import { CheckboxField } from './fields';

interface Props {
  readonly open: boolean;
  readonly summary: string;
  readonly estimate: string;
  readonly onConfirm: () => void;
  readonly onClose: () => void;
}

/** Modal safety confirmation. Native <dialog> provides focus trapping, Esc and inertness. */
export function StartDialog({ open, onClose, ...content }: Props) {
  const ref = useRef<HTMLDialogElement>(null);
  const titleId = useId();

  useEffect(() => {
    const dialog = ref.current;
    if (open && dialog && !dialog.open) dialog.showModal();
    if (!open && dialog?.open) dialog.close();
  }, [open]);

  // The form mounts per opening, so the safety checkboxes always start unchecked.
  return (
    <dialog ref={ref} aria-labelledby={titleId} onClose={onClose}>
      {open && <StartForm titleId={titleId} onClose={onClose} {...content} />}
    </dialog>
  );
}

function StartForm({ titleId, summary, estimate, onConfirm, onClose }: Omit<Props, 'open'> & { readonly titleId: string }) {
  const { t } = useI18n();
  const [goggles, setGoggles] = useState(false);
  const [material, setMaterial] = useState(false);
  return (
    <form
      method="dialog"
      onSubmit={(e) => {
        e.preventDefault();
        if (goggles && material) onConfirm();
      }}
    >
      <h2 id={titleId}>{t('confirmTitle')}</h2>
      <p>{summary}</p>
      <p className="hint">{estimate}</p>
      <p className="notice">{t('safetyNote')}</p>
      <CheckboxField label={t('confirmGoggles')} checked={goggles} onChange={setGoggles} />
      <CheckboxField label={t('confirmMaterial')} checked={material} onChange={setMaterial} />
      <div className="row">
        <button type="submit" className="primary" disabled={!goggles || !material}>
          {t('confirmStart')}
        </button>
        <button type="button" onClick={onClose}>
          {t('cancel')}
        </button>
      </div>
    </form>
  );
}
