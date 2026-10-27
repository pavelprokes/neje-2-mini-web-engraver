'use client';

import { useId, useState } from 'react';
import { useI18n } from '@/i18n/I18nProvider';
import { POINTER_LEVEL, SENSITIVITY_LEVELS, SPEED_MODES } from '@/lib/machine';
import { TEST_PATTERNS, type TestPattern } from '@/lib/patterns';
import type { LaserParams, LaserParamsPatch } from '@/lib/protocol';
import { FONT_FAMILIES, textToSvg, type TextAlign } from '@/lib/text';
import { CheckboxField, Panel, RangeField, SelectField, useDebouncedEffect } from './fields';

// ---------------------------------------------------------------------------------------------

/** Measures text with the same fonts the SVG will be rendered with. */
function measure(line: string, font: string): number {
  const ctx = new OffscreenCanvas(1, 1).getContext('2d');
  if (!ctx) return line.length * 60;
  ctx.font = font;
  return ctx.measureText(line).width;
}

export function TextPanel({ onUse }: { readonly onUse: (file: File) => void }) {
  const { t } = useI18n();
  const textId = useId();
  const hintId = useId();
  const [text, setText] = useState('');
  const [font, setFont] = useState<(typeof FONT_FAMILIES)[number]['id']>('sans');
  const [bold, setBold] = useState(false);
  const [italic, setItalic] = useState(false);
  const [align, setAlign] = useState<TextAlign>('middle');

  const use = () => {
    const family = FONT_FAMILIES.find((f) => f.id === font)!.css;
    const svg = textToSvg({ text, fontFamily: family, bold, italic, align }, measure);
    if (svg) onUse(new File([svg], 'text.svg', { type: 'image/svg+xml' }));
  };

  return (
    <Panel title={t('textHeading')}>
      <label htmlFor={textId} style={{ display: 'block', marginBottom: '0.25rem' }}>
        {t('textLabel')}
      </label>
      <textarea id={textId} value={text} placeholder={t('textPlaceholder')} aria-describedby={hintId} onChange={(e) => setText(e.currentTarget.value)} maxLength={2000} />
      <SelectField label={t('textFont')} value={font} options={FONT_FAMILIES.map((f) => ({ value: f.id, label: f.label }))} onChange={setFont} />
      <SelectField
        label={t('textAlign')}
        value={align}
        options={[
          { value: 'start', label: t('alignStart') },
          { value: 'middle', label: t('alignMiddle') },
          { value: 'end', label: t('alignEnd') },
        ]}
        onChange={setAlign}
      />
      <div className="row" style={{ marginTop: 0 }}>
        <CheckboxField label={t('textBold')} checked={bold} onChange={setBold} />
        <CheckboxField label={t('textItalic')} checked={italic} onChange={setItalic} />
      </div>
      <div className="row">
        <button type="button" className="primary" onClick={use} disabled={!text.trim()}>
          {t('textUse')}
        </button>
      </div>
      <p id={hintId} className="hint">
        {t('textHint')}
      </p>
    </Panel>
  );
}

// ---------------------------------------------------------------------------------------------

const svgDataUrl = (svg: string) => `data:image/svg+xml,${encodeURIComponent(svg)}`;

export function PatternsPanel({ onInsert }: { readonly onInsert: (pattern: TestPattern) => void }) {
  const { t } = useI18n();
  return (
    <Panel title={t('patternsHeading')}>
      <p className="hint" style={{ marginTop: 0 }}>
        {t('patternsHint')}
      </p>
      <ul className="pattern-list">
        {TEST_PATTERNS.map((p) => (
          <li key={p.id}>
            {/* eslint-disable-next-line @next/next/no-img-element -- inline SVG data URL */}
            <img src={svgDataUrl(p.svg)} alt="" width={64} height={40} />
            <div>
              <button type="button" onClick={() => onInsert(p)}>
                {t(p.nameKey)}
              </button>
              <p className="hint">{t(p.descriptionKey)}</p>
            </div>
          </li>
        ))}
      </ul>
    </Panel>
  );
}

// ---------------------------------------------------------------------------------------------

interface MachinePanelProps {
  /** What the device reports; `null` while disconnected. */
  readonly params: LaserParams | null;
  readonly disabled: boolean;
  readonly onChange: (patch: LaserParamsPatch) => void;
}

export function MachinePanel({ params, disabled, onChange }: MachinePanelProps) {
  const { t } = useI18n();
  const speedHint = useId();
  const sensitivityHint = useId();
  // the slider moves freely; the device gets the value once it settles
  const [level, setLevel] = useState<number | null>(null);
  useDebouncedEffect(level, 300, (value) => {
    if (value !== null && params && value !== params.level) onChange({ level: value });
  });

  if (!params) {
    return (
      <Panel title={t('machineHeading')}>
        <p className="hint">{t('machineNotConnected')}</p>
      </Panel>
    );
  }

  const shownLevel = level ?? params.level;
  const speedOptions = SPEED_MODES.map((m) => ({ value: String(m.value), label: t(m.key) }));
  if (!SPEED_MODES.some((m) => m.value === params.mode)) speedOptions.push({ value: String(params.mode), label: t('speedDevice', { value: params.mode }) });

  return (
    <Panel title={t('machineHeading')}>
      <p className="hint" style={{ marginTop: 0 }}>
        {t('machineHint')}
      </p>
      <fieldset disabled={disabled} style={{ margin: 0 }}>
        <RangeField label={t('pointerLevel')} {...POINTER_LEVEL} value={shownLevel} display={String(shownLevel)} onChange={setLevel} />
        <SelectField
          label={t('sensitivity')}
          value={String(params.sensitivity)}
          describedBy={sensitivityHint}
          options={SENSITIVITY_LEVELS.map((s) => ({ value: String(s.value), label: t(s.key) }))}
          onChange={(v) => onChange({ sensitivity: Number(v) })}
        />
        <p id={sensitivityHint} className="hint">
          {t('sensitivityHint')}
        </p>
        <SelectField label={t('speedMode')} value={String(params.mode)} describedBy={speedHint} options={speedOptions} onChange={(v) => onChange({ mode: Number(v) })} />
        <p id={speedHint} className="hint">
          {t('speedModeHint')}
        </p>
      </fieldset>
    </Panel>
  );
}

// ---------------------------------------------------------------------------------------------

const MANUAL_URL = 'https://neje.wiki/doku.php?id=nejelaser_master_2_mini';
const DRIVER_URL = 'https://neje99.com/faq/how-to-install-serial-driver.html';

export function HelpPanel() {
  const { t } = useI18n();
  return (
    <Panel title={t('helpHeading')}>
      <h3 style={{ fontSize: '1rem', margin: '0.25rem 0' }}>{t('helpConnectHeading')}</h3>
      <ol className="help-list">
        <li>{t('helpConnect1')}</li>
        <li>{t('helpConnect2')}</li>
        <li>{t('helpConnect3')}</li>
        <li>{t('helpConnect4')}</li>
        <li>
          {t('helpConnect5')} <a href={DRIVER_URL}>{t('helpDriver')}</a>
        </li>
      </ol>
      <h3 style={{ fontSize: '1rem', margin: '1rem 0 0.25rem' }}>{t('helpQualityHeading')}</h3>
      <ul className="help-list">
        <li>{t('helpQuality1')}</li>
        <li>{t('helpQuality2')}</li>
        <li>{t('helpQuality3')}</li>
        <li>{t('helpQuality4')}</li>
      </ul>
      <p className="hint">
        <a href={MANUAL_URL}>{t('helpManual')}</a>
      </p>
    </Panel>
  );
}
