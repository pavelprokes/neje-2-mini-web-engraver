'use client';

import { useEffect, useId, useMemo, useRef, useState, type KeyboardEvent, type PointerEvent } from 'react';
import { useI18n } from '@/i18n/I18nProvider';
import type { Raster } from '@/lib/imaging/raster';
import { mmToPx, pxToMm, type WorkArea as Area } from '@/lib/job';
import type { Rect } from '@/lib/protocol';

interface Props {
  readonly area: Area;
  readonly raster: Raster | null;
  readonly highlight: boolean;
  /** Outline the "trace frame" function follows: the burned area, margins trimmed. */
  readonly trace: Rect | null;
  /** Known head position in device pixels, drawn as a crosshair. */
  readonly head: { readonly x: number; readonly y: number } | null;
  /** Requests a new top-left position in device pixels (the caller clamps). */
  readonly onMove: (x: number, y: number) => void;
  /** Relative keyboard move in millimetres, applied to the latest state by the caller. */
  readonly onNudge: (dxMm: number, dyMm: number) => void;
}

const MAX_CANVAS_HEIGHT = 900;
const GRID_MM = 10;

/** Pre-renders the dot matrix once per raster; redraws then only blit it. */
function useDotImage(raster: Raster | null) {
  return useMemo(() => {
    if (!raster || typeof OffscreenCanvas === 'undefined') return null;
    const { width, height } = raster.rect;
    const pixels = new ImageData(width, height);
    for (let i = 0; i < raster.dots.length; i++) if (raster.dots[i]) pixels.data[i * 4 + 3] = 255;
    const canvas = new OffscreenCanvas(width, height);
    canvas.getContext('2d')?.putImageData(pixels, 0, 0);
    return canvas;
  }, [raster]);
}

export function WorkArea({ area, raster, highlight, trace, head, onMove, onNudge }: Props) {
  const { t, formatNumber } = useI18n();
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const drag = useRef<{ startX: number; startY: number; x: number; y: number } | null>(null);
  const descriptionId = useId();
  const [keyboardMoved, setKeyboardMoved] = useState(0);
  const [announcement, setAnnouncement] = useState('');
  const dots = useDotImage(raster);
  const scale = Math.min(1, MAX_CANVAS_HEIGHT / area.height);

  useEffect(() => {
    const canvas = canvasRef.current;
    const ctx = canvas?.getContext('2d');
    if (!canvas || !ctx) return;
    const ratio = window.devicePixelRatio || 1;
    canvas.width = Math.round(area.width * scale * ratio);
    canvas.height = Math.round(area.height * scale * ratio);
    ctx.setTransform(scale * ratio, 0, 0, scale * ratio, 0, 0);

    const style = getComputedStyle(canvas);
    ctx.fillStyle = style.getPropertyValue('--material') || '#f7f5ef';
    ctx.fillRect(0, 0, area.width, area.height);
    ctx.strokeStyle = style.getPropertyValue('--grid') || '#dedbd2';
    ctx.lineWidth = 1 / (scale * ratio);
    const step = mmToPx(GRID_MM, area);
    ctx.beginPath();
    for (let x = step; x < area.width; x += step) {
      ctx.moveTo(x, 0);
      ctx.lineTo(x, area.height);
    }
    for (let y = step; y < area.height; y += step) {
      ctx.moveTo(0, y);
      ctx.lineTo(area.width, y);
    }
    ctx.stroke();

    if (raster && dots) {
      const { x, y, width, height } = raster.rect;
      ctx.imageSmoothingEnabled = true;
      ctx.drawImage(dots, x, y, width, height);
      ctx.setLineDash([6 / scale, 4 / scale]);
      ctx.lineWidth = 2 / scale;
      ctx.strokeStyle = '#c81e1e';
      ctx.strokeRect(x, y, width, height);
    }

    if (trace) {
      // solid while the laser traces it, dashed as a hint otherwise
      ctx.setLineDash(highlight ? [] : [2 / scale, 3 / scale]);
      ctx.lineWidth = (highlight ? 3 : 1.5) / scale;
      ctx.strokeStyle = '#b45309';
      ctx.strokeRect(trace.x, trace.y, trace.width, trace.height);
    }

    if (head) {
      const r = 14 / scale;
      ctx.setLineDash([]);
      ctx.lineWidth = 2 / scale;
      ctx.strokeStyle = '#1d4ed8';
      ctx.beginPath();
      ctx.moveTo(head.x - r, head.y);
      ctx.lineTo(head.x + r, head.y);
      ctx.moveTo(head.x, head.y - r);
      ctx.lineTo(head.x, head.y + r);
      ctx.stroke();
      ctx.beginPath();
      ctx.arc(head.x, head.y, r / 2, 0, Math.PI * 2);
      ctx.stroke();
    }
  }, [area, scale, raster, dots, highlight, trace, head]);

  const toDevice = (clientDelta: number) => {
    const shown = canvasRef.current?.getBoundingClientRect().width || 1;
    return (clientDelta * area.width) / shown;
  };

  const onPointerDown = (e: PointerEvent<HTMLCanvasElement>) => {
    if (!raster) return;
    e.currentTarget.setPointerCapture(e.pointerId);
    drag.current = { startX: e.clientX, startY: e.clientY, x: raster.rect.x, y: raster.rect.y };
  };

  const onPointerMove = (e: PointerEvent<HTMLCanvasElement>) => {
    const d = drag.current;
    if (!d) return;
    onMove(Math.round(d.x + toDevice(e.clientX - d.startX)), Math.round(d.y + toDevice(e.clientY - d.startY)));
  };

  const onKeyDown = (e: KeyboardEvent<HTMLDivElement>) => {
    if (!raster) return;
    const step = e.shiftKey ? 10 : 1;
    const delta = { ArrowLeft: [-step, 0], ArrowRight: [step, 0], ArrowUp: [0, -step], ArrowDown: [0, step] }[e.key];
    if (!delta) return;
    e.preventDefault();
    onNudge(delta[0]!, delta[1]!);
    setKeyboardMoved((n) => n + 1);
  };

  const mm = (px: number) => formatNumber(pxToMm(px, area));
  const size = { width: mm(area.width), height: mm(area.height) };
  const description = raster
    ? t('workAreaDescription', { ...size, x: mm(raster.rect.x), y: mm(raster.rect.y), w: mm(raster.rect.width), h: mm(raster.rect.height) })
    : t('workAreaEmpty', size);

  // Speak the position once keyboard moves settle. `description` follows the deferred raster,
  // so it is a dependency; pointer drags change it too but are skipped via `announced`.
  const announced = useRef(0);
  useEffect(() => {
    if (keyboardMoved === announced.current) return;
    const timer = setTimeout(() => {
      announced.current = keyboardMoved;
      setAnnouncement(description);
    }, 500);
    return () => clearTimeout(timer);
  }, [keyboardMoved, description]);

  return (
    <figure className="work-area" style={{ margin: 0 }}>
      <div role="group" tabIndex={0} aria-label={t('workAreaLabel')} aria-describedby={descriptionId} onKeyDown={onKeyDown}>
        <canvas
          ref={canvasRef}
          aria-hidden="true"
          style={{ aspectRatio: `${area.width} / ${area.height}` }}
          onPointerDown={onPointerDown}
          onPointerMove={onPointerMove}
          onPointerUp={() => (drag.current = null)}
          onPointerCancel={() => (drag.current = null)}
        />
      </div>
      <figcaption>
        <span>{t('workAreaCaption', size)}</span>
        <span id={descriptionId} className="visually-hidden">
          {description}
        </span>
        <span className="visually-hidden" aria-live="polite">
          {announcement}
        </span>
      </figcaption>
    </figure>
  );
}
