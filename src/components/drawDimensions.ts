import type { Dimensions } from '@/lib/dimensions';
import type { Point, Rect } from '@/lib/protocol';

const COLORS = { image: '#c81e1e', head: '#1d4ed8', relative: '#b45309' } as const;

interface Style {
  /** Device pixels per CSS pixel on screen, so strokes and text keep a constant size. */
  readonly unit: number;
  readonly label: (px: number) => string;
}

function dimension(ctx: CanvasRenderingContext2D, from: Point, to: Point, text: string, color: string, s: Style, side: 1 | -1 = 1) {
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
  const at = horizontal ? { x: mid.x - w / 2, y: mid.y + (side > 0 ? 3 * s.unit : -h - 3 * s.unit) } : { x: mid.x + (side > 0 ? 4 * s.unit : -w - 4 * s.unit), y: mid.y - h / 2 };
  ctx.fillStyle = 'rgba(255,255,255,0.92)';
  ctx.fillRect(at.x, at.y, w, h);
  ctx.fillStyle = color;
  ctx.textBaseline = 'middle';
  ctx.fillText(text, at.x + 4 * s.unit, at.y + h / 2);
  ctx.restore();
}

/** Draws image size and offsets, head-to-edge distances and head-to-image-corner offsets. */
export function drawDimensions(ctx: CanvasRenderingContext2D, area: { width: number; height: number }, image: Rect | null, head: Point | null, d: Dimensions, s: Style) {
  if (image && d.image) {
    const { x, y, width, height } = image;
    const cx = x + width / 2;
    const cy = y + height / 2;
    const gap = 14 * s.unit;
    // size along the outside of the box, flipped inside when the box touches the area edge
    const sizeY = y - gap > 0 ? y - gap : y + height + gap;
    const sizeX = x - gap > 0 ? x - gap : x + width + gap;
    dimension(ctx, { x, y: sizeY }, { x: x + width, y: sizeY }, s.label(d.image.width), COLORS.image, s, -1);
    dimension(ctx, { x: sizeX, y }, { x: sizeX, y: y + height }, s.label(d.image.height), COLORS.image, s, -1);
    dimension(ctx, { x: 0, y: cy }, { x, y: cy }, s.label(d.image.left), COLORS.image, s);
    dimension(ctx, { x: x + width, y: cy }, { x: area.width, y: cy }, s.label(d.image.right), COLORS.image, s);
    dimension(ctx, { x: cx, y: 0 }, { x: cx, y }, s.label(d.image.top), COLORS.image, s);
    dimension(ctx, { x: cx, y: y + height }, { x: cx, y: area.height }, s.label(d.image.bottom), COLORS.image, s);
  }
  if (head && d.head) {
    dimension(ctx, { x: 0, y: head.y }, { x: head.x, y: head.y }, s.label(d.head.left), COLORS.head, s);
    dimension(ctx, { x: head.x, y: head.y }, { x: area.width, y: head.y }, s.label(d.head.right), COLORS.head, s);
    dimension(ctx, { x: head.x, y: 0 }, { x: head.x, y: head.y }, s.label(d.head.top), COLORS.head, s);
    dimension(ctx, { x: head.x, y: head.y }, { x: head.x, y: area.height }, s.label(d.head.bottom), COLORS.head, s);
  }
  if (head && image && d.headToImage) {
    // drawn last and labelled on the other side, so it reads clearly over the head lines
    dimension(ctx, { x: head.x, y: head.y }, { x: image.x, y: head.y }, s.label(d.headToImage.dx), COLORS.relative, s, -1);
    dimension(ctx, { x: head.x, y: head.y }, { x: head.x, y: image.y }, s.label(d.headToImage.dy), COLORS.relative, s, -1);
  }
}
