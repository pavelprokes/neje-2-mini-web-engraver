'use client';

import { useId, useRef, useState, type DragEvent, type ReactNode } from 'react';
import { LOCALE_NAMES, LOCALES, type MessageKey } from '@/i18n';
import { useI18n, type LocalePreference } from '@/i18n/I18nProvider';
import { ACCEPTED_TYPES } from '@/lib/imaging/decode';
import { LIMITS, type DitherMode, type JobSettings } from '@/lib/job';
import type { OddRowOrder } from '@/lib/protocol';
import type { Preset } from '@/lib/presets';
import { CheckboxField, NumberField, Panel, RangeField, SelectField } from './fields';

type Patch = (patch: Partial<JobSettings>) => void;

// ---------------------------------------------------------------------------------------------

interface HeaderProps {
  readonly statusKey: MessageKey;
  readonly statusState: 'off' | 'ready' | 'busy';
  readonly deviceMeta: string | null;
  readonly connected: boolean;
  readonly canDisconnect: boolean;
  readonly stopButtonId: string;
  readonly connecting: boolean;
  readonly serialSupported: boolean;
  readonly onConnect: () => void;
  readonly onSimulator: () => void;
  readonly onDisconnect: () => void;
  readonly onStop: () => void;
}

export function AppHeader(p: HeaderProps) {
  const { t, preference, setPreference } = useI18n();
  const languageId = useId();
  return (
    <header className="app-header">
      <div className="brand">
        <h1>{t('appName')}</h1>
        <p>{t('tagline')}</p>
      </div>
      <div className="connection">
        <p className="status" role="status" aria-label={t('statusLabel')}>
          <span className="status-dot" data-state={p.statusState} aria-hidden="true" />
          {t(p.statusKey)}
        </p>
        {p.deviceMeta && <span className="device-meta">{p.deviceMeta}</span>}
        {p.connected ? (
          <button type="button" onClick={p.onDisconnect} disabled={!p.canDisconnect}>
            {t('disconnect')}
          </button>
        ) : (
          <>
            <button type="button" className="primary" onClick={p.onConnect} disabled={!p.serialSupported || p.connecting} title={t('connectHint')}>
              {t('connect')}
            </button>
            <button type="button" onClick={p.onSimulator} disabled={p.connecting}>
              {t('simulator')}
            </button>
          </>
        )}
        <label htmlFor={languageId} className="visually-hidden">
          {t('language')}
        </label>
        <select id={languageId} value={preference} onChange={(e) => setPreference(e.currentTarget.value as LocalePreference)} style={{ width: 'auto' }}>
          <option value="auto">{t('languageAuto')}</option>
          {LOCALES.map((l) => (
            <option key={l} value={l} lang={l}>
              {LOCALE_NAMES[l]}
            </option>
          ))}
        </select>
        <button id={p.stopButtonId} type="button" className="stop-button" onClick={p.onStop} disabled={!p.connected} aria-keyshortcuts="Escape" title={t('stopHint')}>
          {t('stop')}
        </button>
      </div>
    </header>
  );
}

// ---------------------------------------------------------------------------------------------

interface ImagePanelProps {
  readonly settings: JobSettings;
  readonly patch: Patch;
  readonly motifLabel: string | null;
  readonly heightMm: number | null;
  readonly onFile: (file: File) => void;
}

export function ImagePanel({ settings: s, patch, motifLabel, heightMm, onFile }: ImagePanelProps) {
  const { t, formatNumber } = useI18n();
  const input = useRef<HTMLInputElement>(null);
  const hintId = useId();
  const [over, setOver] = useState(false);
  const onDrop = (e: DragEvent) => {
    e.preventDefault();
    setOver(false);
    // the page-level handler loads the file; this zone only gives visual feedback
  };

  const ditherOptions: { value: DitherMode; label: string }[] = [
    { value: 'floyd-steinberg', label: t('ditherFloyd') },
    { value: 'atkinson', label: t('ditherAtkinson') },
    { value: 'threshold', label: t('ditherThreshold') },
  ];

  return (
    <Panel title={t('imageHeading')}>
      <div
        className="dropzone"
        data-over={over}
        onDragEnter={() => setOver(true)}
        onDragOver={(e) => e.preventDefault()}
        onDragLeave={() => setOver(false)}
        onDrop={onDrop}
      >
        <span aria-hidden="true">{t('dropZone')}</span>
        <button type="button" onClick={() => input.current?.click()} aria-describedby={hintId}>
          {t('chooseFile')}
        </button>
        <input
          ref={input}
          type="file"
          accept={ACCEPTED_TYPES}
          hidden
          onChange={(e) => {
            const file = e.currentTarget.files?.[0];
            if (file) onFile(file);
            e.currentTarget.value = '';
          }}
        />
      </div>
      <p id={hintId} className="hint">
        {t('dropHint')}
      </p>
      <p className="hint" aria-live="polite">
        <strong>{motifLabel ?? t('noImage')}</strong>
      </p>

      <fieldset>
        <legend>{t('sizeHeading')}</legend>
        <NumberField label={t('widthMm')} value={s.widthMm} min={LIMITS.widthMm.min} max={LIMITS.widthMm.max} onChange={(widthMm) => patch({ widthMm })} />
        <NumberField label={t('heightMm')} value={heightMm ?? 0} readOnly />
        <div className="row">
          <button type="button" onClick={() => patch({ rotation: ((s.rotation + 90) % 360) as JobSettings['rotation'] })}>
            {t('rotate')}
          </button>
          <button type="button" aria-pressed={s.mirrored} onClick={() => patch({ mirrored: !s.mirrored })}>
            {t('mirror')}
          </button>
        </div>
      </fieldset>

      <fieldset>
        <legend>{t('adjustHeading')}</legend>
        <RangeField label={t('brightness')} {...LIMITS.brightness} value={s.brightness} display={formatNumber(s.brightness)} onChange={(brightness) => patch({ brightness })} />
        <RangeField label={t('contrast')} {...LIMITS.contrast} value={s.contrast} display={formatNumber(s.contrast)} onChange={(contrast) => patch({ contrast })} />
        <RangeField label={t('threshold')} {...LIMITS.threshold} value={s.threshold} display={formatNumber(s.threshold)} onChange={(threshold) => patch({ threshold })} />
        <SelectField label={t('dither')} value={s.dither} options={ditherOptions} onChange={(dither) => patch({ dither })} />
        <CheckboxField label={t('invert')} checked={s.invert} onChange={(invert) => patch({ invert })} />
      </fieldset>
    </Panel>
  );
}

// ---------------------------------------------------------------------------------------------

interface PositionPanelProps {
  readonly xMm: number;
  readonly yMm: number;
  readonly patch: Patch;
  readonly onCenter: () => void;
  readonly canMoveHead: boolean;
  readonly onMoveHead: () => void;
  readonly canTestMotion: boolean;
  readonly motionTesting: boolean;
  readonly onTestMotion: () => void;
}

export function PositionPanel({ xMm, yMm, patch, onCenter, canMoveHead, onMoveHead, canTestMotion, motionTesting, onTestMotion }: PositionPanelProps) {
  const { t } = useI18n();
  const hintId = useId();
  const motionHintId = useId();
  return (
    <Panel title={t('positionHeading')}>
      <NumberField label={t('positionX')} value={xMm} min={0} onChange={(v) => patch({ xMm: v })} />
      <NumberField label={t('positionY')} value={yMm} min={0} onChange={(v) => patch({ yMm: v })} />
      <div className="row">
        <button type="button" onClick={onCenter}>
          {t('center')}
        </button>
        <button type="button" onClick={() => patch({ xMm: 0, yMm: 0 })}>
          {t('topLeft')}
        </button>
        <button type="button" onClick={onMoveHead} disabled={!canMoveHead} aria-describedby={hintId}>
          {t('moveHead')}
        </button>
      </div>
      <p id={hintId} className="hint">
        {t('moveHeadHint')}
      </p>
      <div className="row">
        <button type="button" onClick={onTestMotion} disabled={!canTestMotion} aria-describedby={motionHintId}>
          {motionTesting ? t('motionTestRunning') : t('motionTest')}
        </button>
      </div>
      <p id={motionHintId} className="hint">
        {t('motionTestHint')}
      </p>
    </Panel>
  );
}

// ---------------------------------------------------------------------------------------------

interface LaserPanelProps {
  readonly power: number;
  readonly burnTimeMs: number;
  /** Locked while a job runs: the job carries its own parameters. */
  readonly disabled: boolean;
  readonly patch: Patch;
  readonly presets: readonly Preset[];
  readonly selectedPresetId: string;
  readonly onSavePreset: (name: string) => void;
  readonly onDeletePreset: (id: string) => void;
}

export function LaserPanel({ power, burnTimeMs, disabled, patch, presets, selectedPresetId, onSavePreset, onDeletePreset }: LaserPanelProps) {
  const { t } = useI18n();
  const [name, setName] = useState('');
  const nameId = useId();
  const label = (p: Preset) => ('key' in p.label ? t(p.label.key) : p.label.name);
  const selected = presets.find((p) => p.id === selectedPresetId);
  const deletable = selected && 'name' in selected.label;

  return (
    <Panel title={t('laserHeading')}>
      <fieldset disabled={disabled} style={{ margin: 0 }}>
      <SelectField
        label={t('preset')}
        value={selectedPresetId}
        options={[{ value: 'custom', label: t('presetCustom') }, ...presets.map((p) => ({ value: p.id, label: label(p) }))]}
        onChange={(id) => {
          const p = presets.find((x) => x.id === id);
          if (p) patch({ power: p.power, burnTimeMs: p.burnTimeMs });
        }}
      />
      <RangeField label={t('power')} {...LIMITS.power} value={power} display={`${power} %`} onChange={(v) => patch({ power: v })} />
      <RangeField label={t('burnTime')} {...LIMITS.burnTimeMs} value={burnTimeMs} display={`${burnTimeMs} ms`} onChange={(v) => patch({ burnTimeMs: v })} />
      <form
        className="row"
        onSubmit={(e) => {
          e.preventDefault();
          if (!name.trim()) return;
          onSavePreset(name.trim());
          setName('');
        }}
      >
        <label htmlFor={nameId} className="visually-hidden">
          {t('presetName')}
        </label>
        <input id={nameId} type="text" value={name} maxLength={80} placeholder={t('presetName')} onChange={(e) => setName(e.currentTarget.value)} style={{ flex: '1 1 10rem' }} />
        <button type="submit" disabled={!name.trim()}>
          {t('savePreset')}
        </button>
        {deletable && (
          <button type="button" onClick={() => onDeletePreset(selected.id)}>
            {t('deletePreset')}
          </button>
        )}
      </form>
      </fieldset>
    </Panel>
  );
}

// ---------------------------------------------------------------------------------------------

interface EngravePanelProps {
  readonly connected: boolean;
  readonly hasMotif: boolean;
  /** A job, upload or motion routine is running. */
  readonly busy: boolean;
  readonly canPause: boolean;
  readonly paused: boolean;
  /** Changes once per job stage; announced to screen readers. */
  readonly stageText: string;
  readonly previewing: boolean;
  /** Tracing can be switched off (connected, nothing streaming or moving). */
  readonly canStopTrace: boolean;
  readonly estimate: string | null;
  /** The two-phase progress display. */
  readonly progress: ReactNode;
  readonly onTrace: () => void;
  readonly onStop: () => void;
  readonly onPauseResume: () => void;
  readonly onStart: () => void;
}

export function EngravePanel(p: EngravePanelProps) {
  const { t } = useI18n();
  const traceHint = useId();
  const ready = p.connected && p.hasMotif && !p.busy;
  return (
    <Panel title={t('engraveHeading')}>
      <p className="notice">{t('safetyNote')}</p>
      <div className="row">
        <button type="button" aria-pressed={p.previewing} onClick={p.onTrace} disabled={p.previewing ? !p.canStopTrace : !ready} aria-describedby={traceHint}>
          {p.previewing ? t('traceStop') : t('traceFrame')}
        </button>
        <button type="button" className="stop-button" onClick={p.onStop} disabled={!p.connected} aria-keyshortcuts="Escape">
          {t('stopJob')}
        </button>
        <button type="button" onClick={p.onPauseResume} disabled={!p.canPause}>
          {p.paused ? t('resume') : t('pause')}
        </button>
      </div>
      <p id={traceHint} className="hint">
        {t('traceFrameHint')}
      </p>
      <div className="row">
        <button type="button" className="primary block" onClick={p.onStart} disabled={!ready}>
          {t('start')}
        </button>
      </div>
      {p.estimate && <p className="hint">{p.estimate}</p>}
      {p.progress}
      <p className="visually-hidden" aria-live="polite">
        {p.stageText}
      </p>
    </Panel>
  );
}

// ---------------------------------------------------------------------------------------------

interface AdvancedPanelProps {
  readonly oddRows: OddRowOrder;
  readonly patch: Patch;
  readonly autoMotionTest: boolean;
  readonly onAutoMotionTest: (enabled: boolean) => void;
  readonly showTraffic: boolean;
  readonly onShowTraffic: (show: boolean) => void;
  readonly traffic: readonly string[];
}

export function AdvancedPanel({ oddRows, patch, autoMotionTest, onAutoMotionTest, showTraffic, onShowTraffic, traffic }: AdvancedPanelProps) {
  const { t } = useI18n();
  const hintId = useId();
  return (
    <section className="panel">
      <details>
        <summary>{t('advancedHeading')}</summary>
        <SelectField
          label={t('oddRows')}
          value={oddRows}
          describedBy={hintId}
          options={[
            { value: 'mirror', label: t('oddRowsMirror') },
            { value: 'legacy', label: t('oddRowsLegacy') },
          ]}
          onChange={(v) => patch({ oddRows: v })}
        />
        <p id={hintId} className="hint">
          {t('oddRowsHint')}
        </p>
        <CheckboxField label={t('motionTestOnConnect')} checked={autoMotionTest} onChange={onAutoMotionTest} />
        <CheckboxField label={t('trafficLog')} checked={showTraffic} onChange={onShowTraffic} />
        {showTraffic && (
          <pre className="traffic" role="region" tabIndex={0} aria-label={t('trafficLogLabel')}>
            {traffic.join('\n')}
          </pre>
        )}
      </details>
    </section>
  );
}
