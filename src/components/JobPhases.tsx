'use client';

import { useEffect, useState } from 'react';
import { useI18n } from '@/i18n/I18nProvider';
import type { JobProgress } from '@/lib/protocol';

interface Props {
  readonly job: JobProgress;
  /** Dwell-time estimate of the burn, used while the device does not report progress. */
  readonly burnEstimateSeconds: number | null;
  /** Formats seconds as a short duration ("40 s", "3 min"). */
  readonly duration: (seconds: number) => string;
  /** "Stopped" or "Job failed: …" for jobs that did not finish. */
  readonly outcome: string | null;
}

/** m:ss, or h:mm:ss for long jobs. */
const clock = (ms: number): string => {
  const total = Math.max(0, Math.floor(ms / 1000));
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = String(total % 60).padStart(2, '0');
  return h > 0 ? `${h}:${String(m).padStart(2, '0')}:${s}` : `${m}:${s}`;
};

/** Re-renders every second while `active`, for elapsed-time displays. */
function useNow(active: boolean): number {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (!active) return;
    const timer = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(timer);
  }, [active]);
  return now;
}

type PhaseState = 'pending' | 'active' | 'done' | 'stopped';

/**
 * Two-step job progress. The device first receives the whole image and only then burns, so each
 * phase gets its own bar; the burn bar is indeterminate while the device reports no progress.
 */
export function JobPhases({ job, burnEstimateSeconds, duration, outcome }: Props) {
  const { t, formatTime } = useI18n();
  const active = job.stage === 'uploading' || job.stage === 'burning';
  const now = useNow(active);
  if (job.stage === 'none') return null;

  const upload: { state: PhaseState; value: number | undefined; text: string; detail: string | null } = (() => {
    if (job.stage === 'uploading') {
      const percent = Math.round((job.sent / job.total) * 100);
      // `now` ticks once a second and may predate the phase start
      const elapsed = Math.max(0, now - job.startedAt);
      // remaining time from the measured rate, once there is enough data to measure it
      const remaining = job.sent > 0 && elapsed > 1000 ? ((job.total - job.sent) * elapsed) / job.sent / 1000 : null;
      return {
        state: 'active',
        value: percent,
        text: t('progressUploading', { percent }),
        detail: remaining === null ? t('elapsed', { elapsed: clock(elapsed) }) : t('elapsedRemaining', { elapsed: clock(elapsed), remaining: duration(remaining) }),
      };
    }
    if (job.stage === 'burning' || job.stage === 'finished') return { state: 'done', value: 100, text: t('phaseDone'), detail: null };
    // a stopped or failed job keeps showing how far it got
    if ((job.stage === 'cancelled' || job.stage === 'failed') && job.reached !== 'none')
      return job.reached === 'burning'
        ? { state: 'done', value: 100, text: t('phaseDone'), detail: null }
        : { state: 'stopped', value: 0, text: outcome ?? '', detail: null };
    return { state: 'pending', value: 0, text: t('phaseWaiting'), detail: null };
  })();

  const burn: { state: PhaseState; value: number | undefined; text: string; detail: string | null } = (() => {
    if (job.stage === 'burning') {
      // prefer the device's own burn clock; fall back to the host clock
      const elapsed = job.elapsedSeconds !== null ? job.elapsedSeconds * 1000 : Math.max(0, now - job.startedAt);
      const percent = job.percent;
      const remaining =
        elapsed < 1000
          ? null
          : percent !== null && percent > 0
          ? ((100 - percent) * elapsed) / percent / 1000
          : burnEstimateSeconds !== null
            ? Math.max(0, burnEstimateSeconds - elapsed / 1000)
            : null;
      const timing = remaining === null ? t('elapsed', { elapsed: clock(elapsed) }) : t('elapsedRemaining', { elapsed: clock(elapsed), remaining: duration(remaining) });
      return {
        state: 'active',
        value: percent ?? undefined, // undefined = indeterminate bar
        text: percent === null ? t('statusWorking') : t('progressBurning', { percent }),
        detail: remaining === null ? timing : `${timing}, ${t('finishesAround', { time: formatTime(now + remaining * 1000) })}`,
      };
    }
    if (job.stage === 'finished')
      return { state: 'done', value: 100, text: t('phaseDone'), detail: t('finishedAt', { time: formatTime(job.finishedAt), duration: clock(job.durationMs) }) };
    if ((job.stage === 'cancelled' || job.stage === 'failed') && job.reached === 'burning') return { state: 'stopped', value: 0, text: outcome ?? '', detail: null };
    return { state: 'pending', value: 0, text: t('phaseWaiting'), detail: null };
  })();

  return (
    <div className="phases">
      <ol>
        {(
          [
            ['phaseUpload', upload],
            ['phaseBurn', burn],
          ] as const
        ).map(([label, phase], i) => (
          <li key={label} data-state={phase.state}>
            <div className="phase-head">
              <span className="phase-num" aria-hidden="true">
                {phase.state === 'done' ? '✓' : phase.state === 'stopped' ? '×' : i + 1}
              </span>
              <span className="phase-label">{t(label)}</span>
              <span className="phase-status">{phase.text}</span>
            </div>
            <progress max={100} value={phase.value} aria-label={t(label)} aria-valuetext={phase.text} />
            {phase.detail && <p className="hint">{phase.detail}</p>}
          </li>
        ))}
      </ol>
      {outcome && <p className="hint">{outcome}</p>}
    </div>
  );
}
