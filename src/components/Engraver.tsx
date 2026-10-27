'use client';

import { useCallback, useDeferredValue, useEffect, useMemo, useRef, useState, useSyncExternalStore } from 'react';
import type { MessageKey } from '@/i18n';
import { useI18n } from '@/i18n/I18nProvider';
import { errorKeyFor, errorNotice, useDevice, type Notice } from '@/hooks/useDevice';
import { addHistory, clearHistory, importHistory, listHistory, removeHistory, type HistoryEntry } from '@/lib/history';
import { HistoryFileError, MAX_IMPORT_BYTES, parseHistoryFile, serializeHistory } from '@/lib/historyFile';
import { patternFile, type TestPattern } from '@/lib/patterns';
import { decodeImage, ImageDecodeError, type ImageAsset } from '@/lib/imaging/decode';
import { fitPadded, renderRaster, type Raster } from '@/lib/imaging/raster';
import { DEFAULT_JOB_SETTINGS, DEFAULT_WORK_AREA, estimateSeconds, LIMITS, mmToPx, pxToMm, type JobSettings, type WorkArea as Area } from '@/lib/job';
import { BUILT_IN_PRESETS, userPresetStore } from '@/lib/presets';
import { motionTestOnConnect } from '@/lib/storage';
import { bitmapLength, packBitmap, transferSeconds, type NejeSession, type SessionSnapshot } from '@/lib/protocol';
import { isWebSerialSupported } from '@/lib/transport/webSerial';
import { useDebouncedEffect } from './fields';
import { HelpPanel, MachinePanel, PatternsPanel, TextPanel } from './featurePanels';
import { HistoryPanel } from './HistoryPanel';
import { JobPhases } from './JobPhases';
import { AdvancedPanel, AppHeader, EngravePanel, ImagePanel, LaserPanel, PositionPanel } from './panels';
import { StartDialog } from './StartDialog';
import { selectTab, Tabs } from './Tabs';
import { WorkArea } from './WorkArea';

interface Motif {
  readonly asset: ImageAsset;
  readonly file: Blob;
  readonly name: string;
}

const REPO_URL = 'https://github.com/pavelprokes/neje-2-mini-web-engraver';
const MOTION_TEST_MM = 5;
/** Errors whose fix is in the Help tab. */
const CONNECTION_ERRORS = new Set<MessageKey>(['errorNoResponse', 'errorPortOpen', 'errorDisconnected', 'errorUnresponsive']);
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
  if (!snapshot.responsive) return { key: 'statusUnresponsive', state: 'off' };
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
    // re-check at fire time: a job may have started since (it carries its own parameters)
    if (key) void run((s) => (s.isBusy() ? Promise.resolve() : s.setLaserParams({ power: settings.power, burnTimeMs: settings.burnTimeMs })));
  });
  // trace only what will burn; fall back to the full image box for blank images
  const traceRect = useMemo(() => (raster ? fitPadded(raster.burnBounds ?? raster.rect, area) : null), [raster, area]);
  useDebouncedEffect(snapshot?.previewing ? traceRect : null, 300, (rect) => {
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
        await s.home();
        if (await s.traceSquare(mmToPx(MOTION_TEST_MM, area))) setAnnouncement(t('motionTestDone'));
      } finally {
        setMotionTesting(false);
      }
    },
    [t],
  );
  const afterConnect = async (s: NejeSession) => {
    // adopt what the machine is set to instead of silently overwriting it with UI defaults
    const params = s.getSnapshot().params ?? (await s.waitFor('params', 1000).then((m) => m.params, () => null));
    if (params) patch({ power: clamp(params.power, LIMITS.power), burnTimeMs: clamp(params.burnTimeMs, LIMITS.burnTimeMs) });
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

  const startJob = async (save: boolean) => {
    setConfirming(false);
    if (!raster) return;
    if (save) void saveToHistory();
    const { rect, dots } = raster;
    // the Start button becomes disabled; put focus where it matters during a job
    requestAnimationFrame(() => document.getElementById(STOP_BUTTON_ID)?.focus());
    await run((s) => s.engrave(rect, packBitmap(dots, rect.width, rect.height, settings.oddRows), { power: settings.power, burnTimeMs: settings.burnTimeMs }));
  };

  const insertPattern = async (pattern: TestPattern) => {
    // calibration patterns are drawn 1 unit = 1 dot: use their size, no dithering. Applied
    // before the (async) load, so anything the user changes meanwhile is not overwritten.
    patch({ widthMm: pattern.widthMm, dither: 'threshold', invert: false, rotation: 0, mirrored: false });
    await loadFile(patternFile(pattern));
  };

  const exportHistoryFile = async () => {
    try {
      const json = await serializeHistory(await listHistory());
      const url = URL.createObjectURL(new Blob([json], { type: 'application/json' }));
      const a = Object.assign(document.createElement('a'), { href: url, download: `neje-history-${new Date().toISOString().slice(0, 10)}.json` });
      a.click();
      setTimeout(() => URL.revokeObjectURL(url), 10_000);
    } catch (e) {
      setLocalError(errorNotice(e));
    }
  };

  const importHistoryFile = async (file: File) => {
    try {
      if (file.size > MAX_IMPORT_BYTES) throw new HistoryFileError('file too large');
      const count = await importHistory(parseHistoryFile(await file.text()));
      setAnnouncement(t('historyImported', { count }));
      refreshHistory();
    } catch (e) {
      setLocalError({ key: 'historyImportError', vars: { reason: e instanceof Error ? e.message : String(e) } });
    }
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
  const burnSeconds = raster ? estimateSeconds(raster.burnedDots, settings.burnTimeMs) : null;
  const estimate = burnSeconds !== null ? t('estimate', { time: duration(burnSeconds) }) : null;
  const uploadSeconds = raster && device.kind !== 'simulator' ? transferSeconds(bitmapLength(raster.rect.width, raster.rect.height), device.baudRate ?? undefined) : null;

  const outcome =
    job.stage === 'cancelled' ? t('progressCancelled') : job.stage === 'failed' ? t('progressFailed', { reason: t(errorKeyFor(job.code)) }) : null;

  // announced once per stage, unlike the percentage text which changes constantly
  const stageText = (
    {
      none: '',
      uploading: t('progressUploading', { percent: 0 }),
      burning: t('statusWorking'),
      finished: t('progressFinished'),
      cancelled: t('progressCancelled'),
      failed: outcome ?? '',
    } as const
  )[job.stage];

  const head = snapshot?.head;
  const headText = !connected ? null : head ? t('headPosition', { x: mm(head.x), y: mm(head.y) }) : t('headUnknown');

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

  const error = localError ?? device.error ?? (connected && !snapshot.responsive ? ({ key: 'errorUnresponsive' } as const) : null);

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
              {CONNECTION_ERRORS.has(error.key) && (
                <button type="button" onClick={() => selectTab('help')}>
                  {t('openHelp')}
                </button>
              )}
              {(localError ?? device.error) && (
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
              )}
            </div>
          )}
          <EngravePanel
            connected={connected}
            hasMotif={!!raster}
            busy={jobActive || motionTesting}
            canPause={connected && job.stage !== 'uploading' && (snapshot?.machine === 'working' || snapshot?.machine === 'paused')}
            stageText={stageText}
            paused={snapshot?.machine === 'paused'}
            previewing={!!snapshot?.previewing}
            canStopTrace={connected && !motionTesting && job.stage !== 'uploading'}
            estimate={estimate}
            progress={<JobPhases job={job} burnEstimateSeconds={burnSeconds} duration={duration} outcome={outcome} />}
            onStop={stop}
            onTrace={() => void run((s) => (s.getSnapshot().previewing ? s.previewOff() : traceRect ? s.previewOn(traceRect) : Promise.resolve()))}
            onPauseResume={() => void run((s) => (s.getSnapshot().machine === 'paused' ? s.resume() : s.pause()))}
            onStart={() => setConfirming(true)}
          />
          <Tabs
            label={t('tabsLabel')}
            tabs={[
              {
                id: 'image',
                label: t('tabImage'),
                content: (
                  <>
                    <ImagePanel settings={settings} patch={patch} motifLabel={motifLabel} heightMm={raster ? pxToMm(raster.rect.height, area) : null} onFile={loadFile} />
                    <PatternsPanel onInsert={(p) => void insertPattern(p)} />
                  </>
                ),
              },
              { id: 'text', label: t('tabText'), content: <TextPanel onUse={(file) => void loadFile(file)} /> },
              {
                id: 'position',
                label: t('tabPosition'),
                content: (
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
                  />
                ),
              },
              {
                id: 'laser',
                label: t('tabLaser'),
                content: (
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
                ),
              },
              {
                id: 'history',
                label: t('tabHistory'),
                content: (
                  <HistoryPanel
                    entries={history}
                    canSave={!!raster}
                    onSave={() => void saveToHistory()}
                    onOpen={(e) => void openEntry(e)}
                    onApplySettings={(e) => !jobActive && setSettings(e.settings)}
                    onDelete={(e) => void removeHistory(e.id).then(refreshHistory, () => setHistory(null))}
                    onExport={() => void exportHistoryFile()}
                    onImport={(file) => void importHistoryFile(file)}
                    onClear={() => void clearHistory().then(refreshHistory, () => setHistory(null))}
                  />
                ),
              },
              {
                id: 'machine',
                label: t('tabMachine'),
                content: (
                  <>
                    <MachinePanel
                      params={connected ? (snapshot?.params ?? null) : null}
                      disabled={jobActive || motionTesting}
                      onChange={(p) => void run((s) => (s.isBusy() ? Promise.resolve() : s.setLaserParams(p)))}
                    />
                    <AdvancedPanel
                      oddRows={settings.oddRows}
                      patch={patch}
                      autoMotionTest={autoMotionTest}
                      onAutoMotionTest={motionTestOnConnect.set}
                      showTraffic={showTraffic}
                      onShowTraffic={setShowTraffic}
                      traffic={device.traffic}
                    />
                  </>
                ),
              },
              { id: 'help', label: t('tabHelp'), content: <HelpPanel /> },
            ]}
          />
        </div>

        <div className="stage">
          <WorkArea
            area={area}
            raster={raster}
            highlight={!!snapshot?.previewing}
            trace={traceRect}
            head={connected ? (snapshot?.head ?? null) : null}
            canMoveHead={connected && !jobActive && !motionTesting && !snapshot?.previewing}
            onHeadTo={(x, y) => void run((s) => s.moveTo(x, y))}
            headText={headText}
            onGoHome={() => void run((s) => s.home())}
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
          estimate={[uploadSeconds !== null ? t('uploadFirst', { time: duration(uploadSeconds) }) : '', estimate ?? ''].join(' ').trim()}
          onConfirm={(save) => void startJob(save)}
          onClose={() => setConfirming(false)}
        />
      )}
    </>
  );
}

