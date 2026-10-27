'use client';

import { useCallback, useDeferredValue, useEffect, useMemo, useRef, useState, useSyncExternalStore } from 'react';
import type { MessageKey } from '@/i18n';
import { useI18n } from '@/i18n/I18nProvider';
import { errorKeyFor, errorNotice, useDevice, type Notice } from '@/hooks/useDevice';
import { addHistory, listHistory, removeHistory, type HistoryEntry } from '@/lib/history';
import { decodeImage, ImageDecodeError, type ImageAsset } from '@/lib/imaging/decode';
import { renderRaster, type Raster } from '@/lib/imaging/raster';
import { DEFAULT_JOB_SETTINGS, DEFAULT_WORK_AREA, estimateSeconds, LIMITS, mmToPx, pxToMm, type JobSettings, type WorkArea as Area } from '@/lib/job';
import { BUILT_IN_PRESETS, userPresetStore } from '@/lib/presets';
import { CONNECT_JINGLE, toRhythm } from '@/lib/jingle';
import { jingleOnConnect, motionTestOnConnect } from '@/lib/storage';
import { packBitmap, type NejeSession, type SessionSnapshot } from '@/lib/protocol';
import { isWebSerialSupported } from '@/lib/transport/webSerial';
import { useDebouncedEffect } from './fields';
import { HistoryPanel } from './HistoryPanel';
import { AdvancedPanel, AppHeader, EngravePanel, ImagePanel, LaserPanel, PositionPanel } from './panels';
import { StartDialog } from './StartDialog';
import { WorkArea } from './WorkArea';

interface Motif {
  readonly asset: ImageAsset;
  readonly file: Blob;
  readonly name: string;
}

const REPO_URL = 'https://github.com/pavelprokes/neje-2-mini-web-engraver';
const MOTION_TEST_MM = 5;
export const STOP_BUTTON_ID = 'stop-button';
const clamp = (v: number, { min, max }: { min: number; max: number }) => Math.min(max, Math.max(min, v));
const THUMBNAIL_SIZE = 112;

async function thumbnailOf(raster: Raster): Promise<Blob> {
  const { width, height } = raster.rect;
  const scale = THUMBNAIL_SIZE / Math.max(width, height);
  const dots = new OffscreenCanvas(width, height);
  const pixels = new ImageData(width, height);
  raster.dots.forEach((d, i) => d && (pixels.data[i * 4 + 3] = 255));
  dots.getContext('2d')!.putImageData(pixels, 0, 0);
  const thumb = new OffscreenCanvas(Math.max(1, Math.round(width * scale)), Math.max(1, Math.round(height * scale)));
  const ctx = thumb.getContext('2d')!;
  ctx.fillStyle = '#fff';
  ctx.fillRect(0, 0, thumb.width, thumb.height);
  ctx.drawImage(dots, 0, 0, thumb.width, thumb.height);
  return thumb.convertToBlob({ type: 'image/png' });
}

function statusOf(snapshot: SessionSnapshot | null): { key: MessageKey; state: 'off' | 'ready' | 'busy' } {
  if (!snapshot) return { key: 'statusDisconnected', state: 'off' };
  if (snapshot.link === 'connecting') return { key: 'statusConnecting', state: 'busy' };
  if (snapshot.machine === 'paused') return { key: 'statusPaused', state: 'busy' };
  if (snapshot.machine === 'working' || snapshot.job.stage === 'uploading') return { key: 'statusWorking', state: 'busy' };
  return { key: 'statusReady', state: 'ready' };
}

const serialSupport = () => isWebSerialSupported();

export function Engraver() {
  const { t, formatNumber } = useI18n();
  const [showTraffic, setShowTraffic] = useState(false);
  const device = useDevice({ logTraffic: showTraffic });
  const { snapshot } = device;
  const serialSupported = useSyncExternalStore(() => () => {}, serialSupport, () => true);

  const [settings, setSettings] = useState<JobSettings>(DEFAULT_JOB_SETTINGS);
  const [motif, setMotif] = useState<Motif | null>(null);
  const [localError, setLocalError] = useState<Notice | null>(null);
  const [announcement, setAnnouncement] = useState('');
  const [history, setHistory] = useState<readonly HistoryEntry[] | null>([]);
  const userPresets = useSyncExternalStore(userPresetStore.subscribe, userPresetStore.getSnapshot, userPresetStore.getServerSnapshot);
  const [confirming, setConfirming] = useState(false);
  const [motionTesting, setMotionTesting] = useState(false);
  const autoJingle = useSyncExternalStore(jingleOnConnect.subscribe, jingleOnConnect.getSnapshot, jingleOnConnect.getServerSnapshot);
  const autoMotionTest = useSyncExternalStore(motionTestOnConnect.subscribe, motionTestOnConnect.getSnapshot, motionTestOnConnect.getServerSnapshot);

  const patch = useCallback((p: Partial<JobSettings>) => setSettings((s) => ({ ...s, ...p })), []);
  const connected = snapshot?.link === 'connected';
  const info = snapshot?.info ?? null;
  const area: Area = useMemo(() => (info ? { width: info.width, height: info.height, pixelPitchUm: info.pixelPitchUm } : DEFAULT_WORK_AREA), [info]);

  // ---- raster (deferred so slider drags stay responsive on large images) ----
  const tone = useDeferredValue(settings);
  const raster = useMemo(
    () => (motif ? renderRaster(motif.asset, tone, area) : null),
    // power, burn time and odd-row order do not change the raster
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [motif, area, tone.widthMm, tone.xMm, tone.yMm, tone.rotation, tone.mirrored, tone.brightness, tone.contrast, tone.threshold, tone.dither, tone.invert],
  );
  useEffect(() => () => motif?.asset.dispose(), [motif]);

  // ---- persistence -----------------------------------------------------------------------
  const refreshHistory = useCallback(() => {
    listHistory().then(setHistory, () => setHistory(null));
  }, []);
  useEffect(refreshHistory, [refreshHistory]);

  // ---- motif loading: swapping keeps every setting ----------------------------------------
  // Only the most recent request wins, so a slow decode can never replace a newer pick.
  const loadRequest = useRef(0);
  const loadFile = useCallback(async (file: Blob & { name?: string }): Promise<boolean> => {
    const request = ++loadRequest.current;
    setLocalError(null);
    try {
      const asset = await decodeImage(file);
      if (request !== loadRequest.current) {
        asset.dispose();
        return false;
      }
      setMotif({ asset, file, name: file.name || 'image' });
      return true;
    } catch (e) {
      if (request === loadRequest.current) setLocalError(e instanceof ImageDecodeError ? { key: 'errorDecode', vars: { name: e.fileName } } : errorNotice(e));
      return false;
    }
  }, []);

  useEffect(() => {
    const onDragOver = (e: DragEvent) => e.preventDefault();
    const onDrop = (e: DragEvent) => {
      e.preventDefault();
      const file = e.dataTransfer?.files[0];
      if (file) void loadFile(file);
    };
    const onPaste = (e: ClipboardEvent) => {
      const file = e.clipboardData?.files[0];
      if (file) void loadFile(file);
    };
    window.addEventListener('dragover', onDragOver);
    window.addEventListener('drop', onDrop);
    window.addEventListener('paste', onPaste);
    return () => {
      window.removeEventListener('dragover', onDragOver);
      window.removeEventListener('drop', onDrop);
      window.removeEventListener('paste', onPaste);
    };
  }, [loadFile]);

  // ---- device sync -------------------------------------------------------------------------
  const { run } = device;
  const job = snapshot?.job ?? { stage: 'none' as const };
  const jobActive = connected && (snapshot?.machine !== 'idle' || job.stage === 'uploading');
  // parameters only go out while the machine is idle; a job carries its own
  useDebouncedEffect(connected && !jobActive && !motionTesting ? `${settings.power}/${settings.burnTimeMs}` : null, 300, (key) => {
    if (key) void run((s) => s.setLaserParams({ power: settings.power, burnTimeMs: settings.burnTimeMs }));
  });
  useDebouncedEffect(snapshot?.previewing && raster ? raster.rect : null, 300, (rect) => {
    // re-check at fire time: the preview may have been switched off (or stopped) meanwhile
    if (rect) void run((s) => (s.getSnapshot().previewing ? s.previewOn(rect) : Promise.resolve()));
  });
  useEffect(() => {
    if (!jobActive) return;
    const warn = (e: BeforeUnloadEvent) => e.preventDefault();
    window.addEventListener('beforeunload', warn);
    return () => window.removeEventListener('beforeunload', warn);
  }, [jobActive]);

  const stop = useCallback(() => void run((s) => s.stop()), [run]);

  const testMotion = useCallback(
    async (s: NejeSession) => {
      const info = s.getSnapshot().info;
      if (!info) return;
      setMotionTesting(true);
      setAnnouncement(t('motionTestRunning'));
      try {
        const area = { width: info.width, height: info.height, pixelPitchUm: info.pixelPitchUm };
        if (await s.traceSquare(mmToPx(MOTION_TEST_MM, area))) setAnnouncement(t('motionTestDone'));
      } finally {
        setMotionTesting(false);
      }
    },
    [t],
  );
  const playJingle = useCallback(async (s: NejeSession) => {
    const info = s.getSnapshot().info;
    if (!info) return;
    const area = { width: info.width, height: info.height, pixelPitchUm: info.pixelPitchUm };
    setMotionTesting(true);
    try {
      await s.playRhythm(toRhythm(CONNECT_JINGLE, (mm) => mmToPx(mm, area)));
    } finally {
      setMotionTesting(false);
    }
  }, []);

  const afterConnect = async (s: NejeSession) => {
    // adopt what the machine is set to instead of silently overwriting it with UI defaults
    const params = s.getSnapshot().params ?? (await s.waitFor('params', 1000).then((m) => m.params, () => null));
    if (params) patch({ power: clamp(params.power, LIMITS.power), burnTimeMs: clamp(params.burnTimeMs, LIMITS.burnTimeMs) });
    if (autoJingle) await playJingle(s);
    if (autoMotionTest) await testMotion(s);
  };
  const connect = (kind: 'serial' | 'simulator') => void device.connect(kind, afterConnect);
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') stop();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [stop]);

  // ---- actions -----------------------------------------------------------------------------
  const saveToHistory = useCallback(async () => {
    if (!motif || !raster) return;
    try {
      await addHistory({ name: motif.name, asset: motif.file, thumbnail: await thumbnailOf(raster), settings });
      setAnnouncement(t('historySaved'));
      refreshHistory();
    } catch {
      setHistory(null);
    }
  }, [motif, raster, settings, t, refreshHistory]);

  const startJob = async () => {
    setConfirming(false);
    if (!raster) return;
    void saveToHistory();
    const { rect, dots } = raster;
    // the Start button becomes disabled; put focus where it matters during a job
    requestAnimationFrame(() => document.getElementById(STOP_BUTTON_ID)?.focus());
    await run((s) => s.engrave(rect, packBitmap(dots, rect.width, rect.height, settings.oddRows), { power: settings.power, burnTimeMs: settings.burnTimeMs }));
  };

  const openEntry = async (entry: HistoryEntry) => {
    if (await loadFile(new File([entry.asset], entry.name, { type: entry.asset.type }))) setSettings(entry.settings);
  };

  const presets = useMemo(() => [...BUILT_IN_PRESETS, ...userPresets], [userPresets]);
  const selectedPresetId = presets.find((p) => p.power === settings.power && p.burnTimeMs === settings.burnTimeMs)?.id ?? 'custom';
  const updatePresets = userPresetStore.set;

  // ---- derived text ------------------------------------------------------------------------
  const mm = (px: number) => formatNumber(pxToMm(px, area));
  const status = statusOf(snapshot);
  const duration = (seconds: number) => {
    if (seconds < 90) return t('durationSeconds', { n: Math.max(1, Math.ceil(seconds)) });
    const minutes = Math.ceil(seconds / 60);
    return minutes < 90 ? t('durationMinutes', { n: minutes }) : t('durationHours', { h: Math.floor(minutes / 60), m: minutes % 60 });
  };
  const estimate = raster ? t('estimate', { time: duration(estimateSeconds(raster.burnedDots, settings.burnTimeMs)) }) : null;

  const progress = (() => {
    switch (job.stage) {
      case 'uploading': {
        const percent = Math.round((job.sent / job.total) * 100);
        return { value: percent, text: t('progressUploading', { percent }) };
      }
      case 'burning':
        return { value: job.percent, text: t('progressBurning', { percent: job.percent }) };
      case 'finished':
        return { value: 100, text: t('progressFinished') };
      case 'cancelled':
        return { value: 0, text: t('progressCancelled') };
      case 'failed':
        return { value: 0, text: t('progressFailed', { reason: t(errorKeyFor(job.code)) }) };
      default:
        return { value: 0, text: t('progressNone') };
    }
  })();

  // announced once per stage, unlike the percentage text which changes constantly
  const stageText = (
    {
      none: '',
      uploading: t('progressUploading', { percent: 0 }),
      burning: t('statusWorking'),
      finished: t('progressFinished'),
      cancelled: t('progressCancelled'),
      failed: progress.text,
    } as const
  )[job.stage];

  const deviceMeta = info
    ? [
        t('deviceSummary', { model: info.model ?? t('unknownModel', { id: info.modelId }), firmware: info.firmware }),
        snapshot?.temperatureC != null ? t('temperature', { value: snapshot.temperatureC }) : null,
        device.kind === 'simulator' ? t('simulatorBadge') : null,
      ]
        .filter(Boolean)
        .join(' · ')
    : null;

  const motifLabel = motif
    ? motif.asset.kind === 'vector'
      ? t('imageVector', { name: motif.name })
      : t('imageRaster', { name: motif.name, width: motif.asset.width, height: motif.asset.height })
    : null;

  const error = localError ?? device.error;

  return (
    <>
      <a className="skip-link" href="#main">
        {t('skipToMain')}
      </a>
      <AppHeader
        statusKey={status.key}
        statusState={status.state}
        deviceMeta={deviceMeta}
        connected={connected}
        canDisconnect={!jobActive && !snapshot?.previewing && !motionTesting}
        stopButtonId={STOP_BUTTON_ID}
        connecting={snapshot?.link === 'connecting'}
        serialSupported={serialSupported}
        onConnect={() => connect('serial')}
        onSimulator={() => connect('simulator')}
        onDisconnect={() => void device.disconnect()}
        onStop={stop}
      />

      <main id="main" className="layout" tabIndex={-1}>
        <div className="controls">
          {!serialSupported && <p className="notice">{t('noWebSerial')}</p>}
          {error && (
            <div className="alert" role="alert">
              <span>{t(error.key, error.vars)}</span>
              <button
                type="button"
                onClick={() => {
                  setLocalError(null);
                  device.clearError();
                }}
                aria-label={t('cancel')}
              >
                ×
              </button>
            </div>
          )}
          <ImagePanel settings={settings} patch={patch} motifLabel={motifLabel} heightMm={raster ? pxToMm(raster.rect.height, area) : null} onFile={loadFile} />
          <PositionPanel
            xMm={raster ? pxToMm(raster.rect.x, area) : settings.xMm}
            yMm={raster ? pxToMm(raster.rect.y, area) : settings.yMm}
            patch={patch}
            onCenter={() => raster && patch({ xMm: pxToMm((area.width - raster.rect.width) / 2, area), yMm: pxToMm((area.height - raster.rect.height) / 2, area) })}
            canMoveHead={connected && !!raster && !jobActive && !motionTesting}
            onMoveHead={() => raster && void run((s) => s.moveTo(raster.rect.x, raster.rect.y))}
            canTestMotion={connected && !jobActive && !motionTesting}
            motionTesting={motionTesting}
            onTestMotion={() => void run(testMotion)}
            onPlayJingle={() => void run(playJingle)}
          />
          <LaserPanel
            power={settings.power}
            burnTimeMs={settings.burnTimeMs}
            disabled={jobActive}
            patch={patch}
            presets={presets}
            selectedPresetId={selectedPresetId}
            onSavePreset={(name) => {
              updatePresets([...userPresets, { id: `user-${Date.now()}`, label: { name }, power: settings.power, burnTimeMs: settings.burnTimeMs }]);
              setAnnouncement(t('presetSaved', { name }));
            }}
            onDeletePreset={(id) => updatePresets(userPresets.filter((p) => p.id !== id))}
          />
          <EngravePanel
            connected={connected}
            hasMotif={!!raster}
            jobActive={jobActive}
            busy={jobActive || motionTesting}
            canPause={connected && job.stage !== 'uploading' && (snapshot?.machine === 'working' || snapshot?.machine === 'paused')}
            stageText={stageText}
            paused={snapshot?.machine === 'paused'}
            previewing={!!snapshot?.previewing}
            progress={job.stage === 'none' ? null : progress.value}
            progressText={progress.text}
            estimate={estimate}
            onTrace={() => raster && void run((s) => (s.getSnapshot().previewing ? s.previewOff() : s.previewOn(raster.rect)))}
            onPauseResume={() => void run((s) => (s.getSnapshot().machine === 'paused' ? s.resume() : s.pause()))}
            onStart={() => setConfirming(true)}
          />
          <HistoryPanel
            entries={history}
            canSave={!!raster}
            onSave={() => void saveToHistory()}
            onOpen={(e) => void openEntry(e)}
            onApplySettings={(e) => !jobActive && setSettings(e.settings)}
            onDelete={(e) => void removeHistory(e.id).then(refreshHistory, () => setHistory(null))}
          />
          <AdvancedPanel
            oddRows={settings.oddRows}
            patch={patch}
            autoMotionTest={autoMotionTest}
            onAutoMotionTest={motionTestOnConnect.set}
            autoJingle={autoJingle}
            onAutoJingle={jingleOnConnect.set}
            showTraffic={showTraffic}
            onShowTraffic={setShowTraffic}
            traffic={device.traffic}
          />
        </div>

        <div className="stage">
          <WorkArea
            area={area}
            raster={raster}
            highlight={!!snapshot?.previewing}
            onMove={(x, y) => patch({ xMm: Math.max(0, pxToMm(x, area)), yMm: Math.max(0, pxToMm(y, area)) })}
            onNudge={(dx, dy) => {
              if (!raster) return;
              // relative to the latest settings, so fast key repeats are never lost; start from the
              // clamped (visible) position so nudging back from beyond the edge reacts at once
              const maxX = pxToMm(area.width - raster.rect.width, area);
              const maxY = pxToMm(area.height - raster.rect.height, area);
              const round = (v: number) => Math.round(v * 10) / 10;
              setSettings((s) => ({
                ...s,
                xMm: round(Math.min(maxX, Math.max(0, Math.min(maxX, s.xMm) + dx))),
                yMm: round(Math.min(maxY, Math.max(0, Math.min(maxY, s.yMm) + dy))),
              }));
            }}
          />
        </div>
      </main>

      <footer className="app-footer">
        <span>{t('footerDisclaimer')}</span>
        <a href={REPO_URL}>{t('sourceCode')}</a>
        <span>{t('offlineReady')}</span>
      </footer>

      <p className="visually-hidden" aria-live="polite">
        {announcement}
      </p>

      {raster && (
        <StartDialog
          open={confirming}
          summary={t('confirmSummary', {
            w: mm(raster.rect.width),
            h: mm(raster.rect.height),
            x: mm(raster.rect.x),
            y: mm(raster.rect.y),
            power: settings.power,
            time: settings.burnTimeMs,
          })}
          estimate={estimate ?? ''}
          onConfirm={() => void startJob()}
          onClose={() => setConfirming(false)}
        />
      )}
    </>
  );
}

