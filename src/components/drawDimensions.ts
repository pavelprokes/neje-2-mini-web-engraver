import type { Dimensions } from '@/lib/dimensions';
import type { Point, Rect } from '@/lib/protocol';

/** Shared by the canvas and the text table, so both use the same colour per group. */
export const DIMENSION_COLORS = { image: '#c81e1e', head: '#1d4ed8', relative: '#b45309' } as const;
const COLORS = DIMENSION_COLORS;

interface Style {
  /** Device pixels per CSS pixel on screen, so strokes and text keep a constant size. */
  readonly unit: number;
  readonly label: (px: number) => string;
}

interface Box {
  readonly x: number;
  readonly y: number;
  readonly w: number;
  readonly h: number;
}

const overlaps = (a: Box, b: Box) => a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h;

function dimension(ctx: CanvasRenderingContext2D, placed: Box[], from: Point, to: Point, text: string, color: string, s: Style, side: 1 | -1 = 1) {
  const length = Math.hypot(to.x - from.x, to.y - from.y);
  if (length < 1) return;
  const horizontal = from.y === to.y;
  const tick = 5 * s.unit;
  ctx.save();
  ctx.strokeStyle = color;
  ctx.lineWidth = 1.25 * s.unit;
  ctx.setLineDash([]);
  ctx.beginPath();
  ctx.moveTo(from.x, from.y);
  ctx.lineTo(to.x, to.y);
  for (const p of [from, to]) {
    if (horizontal) {
      ctx.moveTo(p.x, p.y - tick);
      ctx.lineTo(p.x, p.y + tick);
    } else {
      ctx.moveTo(p.x - tick, p.y);
      ctx.lineTo(p.x + tick, p.y);
    }
  }
  ctx.stroke();

  // label on a pill so it stays readable over burned dots and grid lines
  ctx.font = `600 ${12 * s.unit}px system-ui, sans-serif`;
  const w = ctx.measureText(text).width + 8 * s.unit;
  const h = 16 * s.unit;
  const mid = { x: (from.x + to.x) / 2, y: (from.y + to.y) / 2 };
  const place = (sd: number, shift: number): Box =>
    horizontal
      ? { x: mid.x - w / 2 + shift, y: mid.y + (sd > 0 ? 3 * s.unit : -h - 3 * s.unit), w, h }
      : { x: mid.x + (sd > 0 ? 4 * s.unit : -w - 4 * s.unit), y: mid.y - h / 2 + shift, w, h };
  // keep labels apart: try the preferred side, the other side, then slide along the line
  const along = horizontal ? Math.abs(to.x - from.x) : Math.abs(to.y - from.y);
  const step = horizontal ? w + 4 * s.unit : h + 4 * s.unit;
  const shifts = [0, step, -step, 2 * step, -2 * step].filter((d) => Math.abs(d) < along / 2);
  let at: Box | undefined;
  for (const shift of shifts) {
    for (const sd of [side, -side]) {
      const box = place(sd, shift);
      if (!placed.some((p) => overlaps(p, box))) {
        at = box;
        break;
      }
    }
    if (at) break;
  }
  if (!at) {
    ctx.restore();
    return; // no free spot: the value is still in the dimensions table
  }
  placed.push(at);
  ctx.fillStyle = 'rgba(255,255,255,0.92)';
  ctx.fillRect(at.x, at.y, w, h);
  ctx.fillStyle = color;
  ctx.textBaseline = 'middle';
  ctx.fillText(text, at.x + 4 * s.unit, at.y + h / 2);
  ctx.restore();
}

/** Draws image size and offsets, head-to-edge distances and head-to-image-corner offsets. */
export function drawDimensions(ctx: CanvasRenderingContext2D, area: { width: number; height: number }, image: Rect | null, head: Point | null, d: Dimensions, s: Style) {
  const placed: Box[] = [];
  if (image && d.image) {
    const { x, y, width, height } = image;
    const cx = x + width / 2;
    const cy = y + height / 2;
    const gap = 14 * s.unit;
    // size along the outside of the box: above/left when there is room, else below/right,
    // else (box fills the area) just inside the box
    const outside = (start: number, size: number, limit: number) =>
      start - gap > 0 ? start - gap : start + size + gap < limit ? start + size + gap : start + gap;
    const sizeY = outside(y, height, area.height);
    const sizeX = outside(x, width, area.width);
    dimension(ctx, placed, { x, y: sizeY }, { x: x + width, y: sizeY }, s.label(d.image.width), COLORS.image, s, -1);
    dimension(ctx, placed, { x: sizeX, y }, { x: sizeX, y: y + height }, s.label(d.image.height), COLORS.image, s, -1);
    dimension(ctx, placed, { x: 0, y: cy }, { x, y: cy }, s.label(d.image.left), COLORS.image, s);
    dimension(ctx, placed, { x: x + width, y: cy }, { x: area.width, y: cy }, s.label(d.image.right), COLORS.image, s);
    dimension(ctx, placed, { x: cx, y: 0 }, { x: cx, y }, s.label(d.image.top), COLORS.image, s);
    dimension(ctx, placed, { x: cx, y: y + height }, { x: cx, y: area.height }, s.label(d.image.bottom), COLORS.image, s);
  }
  if (head && d.head) {
    dimension(ctx, placed, { x: 0, y: head.y }, { x: head.x, y: head.y }, s.label(d.head.left), COLORS.head, s);
    dimension(ctx, placed, { x: head.x, y: head.y }, { x: area.width, y: head.y }, s.label(d.head.right), COLORS.head, s);
    dimension(ctx, placed, { x: head.x, y: 0 }, { x: head.x, y: head.y }, s.label(d.head.top), COLORS.head, s);
    dimension(ctx, placed, { x: head.x, y: head.y }, { x: head.x, y: area.height }, s.label(d.head.bottom), COLORS.head, s);
  }
  if (head && image && d.headToImage) {
    // drawn last and labelled on the other side, so it reads clearly over the head lines
    dimension(ctx, placed, { x: head.x, y: head.y }, { x: image.x, y: head.y }, s.label(d.headToImage.dx), COLORS.relative, s, -1);
    dimension(ctx, placed, { x: head.x, y: head.y }, { x: head.x, y: image.y }, s.label(d.headToImage.dy), COLORS.relative, s, -1);
  }
}
