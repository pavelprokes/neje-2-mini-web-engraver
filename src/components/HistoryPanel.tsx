'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import { useI18n } from '@/i18n/I18nProvider';
import type { HistoryEntry } from '@/lib/history';
import { Panel } from './fields';

interface Props {
  readonly entries: readonly HistoryEntry[] | null;
  readonly canSave: boolean;
  readonly onSave: () => void;
  readonly onOpen: (entry: HistoryEntry) => void;
  readonly onApplySettings: (entry: HistoryEntry) => void;
  readonly onDelete: (entry: HistoryEntry) => void;
  readonly onExport: () => void;
  readonly onImport: (file: File) => void;
  readonly onClear: () => void;
}

/** `entries === null` means history storage is unavailable in this browser. */
export function HistoryPanel({ entries, canSave, onSave, onOpen, onApplySettings, onDelete, onExport, onImport, onClear }: Props) {
  const { t, formatDate, formatNumber } = useI18n();
  // deleting removes the focused button; keep keyboard users in the panel
  const container = useRef<HTMLDivElement>(null);
  const importInput = useRef<HTMLInputElement>(null);
  // two-step delete-all: the first click arms it, a second one within 4 s confirms
  const [clearArmed, setClearArmed] = useState(false);
  useEffect(() => {
    if (!clearArmed) return;
    const timer = setTimeout(() => setClearArmed(false), 4000);
    return () => clearTimeout(timer);
  }, [clearArmed]);

  const thumbnails = useMemo(() => new Map((entries ?? []).map((e) => [e.id, URL.createObjectURL(e.thumbnail)])), [entries]);
  useEffect(() => () => thumbnails.forEach((url) => URL.revokeObjectURL(url)), [thumbnails]);

  return (
    <Panel title={t('historyHeading')}>
      <div ref={container} tabIndex={-1}>
      {entries === null ? (
        <p className="hint">{t('historyUnavailable')}</p>
      ) : entries.length === 0 ? (
        <p className="hint">{t('historyEmpty')}</p>
      ) : (
        <ul className="history">
          {entries.map((entry) => (
            <li key={entry.id}>
              {/* eslint-disable-next-line @next/next/no-img-element -- local blob URL, nothing to optimise */}
              <img src={thumbnails.get(entry.id)} alt="" width={56} height={56} />
              <div>
                <div className="name">{entry.name}</div>
                <div className="meta">
                  {t('historyMeta', {
                    date: formatDate(entry.createdAt),
                    width: formatNumber(entry.settings.widthMm),
                    power: entry.settings.power,
                    time: entry.settings.burnTimeMs,
                  })}
                </div>
              </div>
              <div className="actions">
                <button type="button" aria-label={t('historyOpenLabel', { name: entry.name })} onClick={() => onOpen(entry)}>
                  {t('historyOpen')}
                </button>
                <button type="button" aria-label={t('historyApplyLabel', { name: entry.name })} onClick={() => onApplySettings(entry)}>
                  {t('historyApply')}
                </button>
                <button
                  type="button"
                  aria-label={t('historyDeleteLabel', { name: entry.name })}
                  onClick={() => {
                    onDelete(entry);
                    container.current?.focus();
                  }}
                >
                  {t('historyDelete')}
                </button>
              </div>
            </li>
          ))}
        </ul>
      )}
      {entries !== null && (
        <>
          <div className="row">
            <button type="button" onClick={onSave} disabled={!canSave}>
              {t('historySave')}
            </button>
            <button type="button" onClick={onExport} disabled={entries.length === 0}>
              {t('historyExport')}
            </button>
            <button type="button" onClick={() => importInput.current?.click()}>
              {t('historyImport')}
            </button>
            <input
              ref={importInput}
              type="file"
              accept=".json,application/json"
              hidden
              onChange={(e) => {
                const file = e.currentTarget.files?.[0];
                if (file) onImport(file);
                e.currentTarget.value = '';
              }}
            />
            <button
              type="button"
              disabled={entries.length === 0}
              onClick={() => {
                if (!clearArmed) return setClearArmed(true);
                setClearArmed(false);
                onClear();
              }}
            >
              {clearArmed ? t('historyClearConfirm') : t('historyClear')}
            </button>
          </div>
          <p className="hint">{t('historyStorageNote')}</p>
        </>
      )}
      </div>
    </Panel>
  );
}
