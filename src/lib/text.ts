/**
 * Turns typed text into an SVG motif, so it is rendered sharp at device resolution like any other
 * vector image. Text is user input: it is escaped before going into the markup.
 */

export type TextAlign = 'start' | 'middle' | 'end';

export interface TextOptions {
  readonly text: string;
  /** CSS font family list, e.g. "Georgia, serif". */
  readonly fontFamily: string;
  readonly bold: boolean;
  readonly italic: boolean;
  readonly align: TextAlign;
}

/** Fonts that exist on practically every system, plus the generic families. */
export const FONT_FAMILIES = [
  { id: 'sans', label: 'Sans-serif', css: 'Helvetica, Arial, sans-serif' },
  { id: 'serif', label: 'Serif', css: 'Georgia, "Times New Roman", serif' },
  { id: 'mono', label: 'Monospace', css: '"Courier New", Menlo, monospace' },
  { id: 'rounded', label: 'Rounded', css: '"Arial Rounded MT Bold", "Trebuchet MS", sans-serif' },
  { id: 'script', label: 'Script', css: '"Brush Script MT", "Segoe Script", cursive' },
] as const;

const FONT_SIZE = 100; // layout units; the motif is scaled to the job width anyway
const LINE_HEIGHT = 1.25;
// generous padding: descenders (p, y, g) reach ~0.3 em below the baseline, italic/script
// glyphs overhang their advance width
const PADDING = 20;
const DESCENDER = 0.3;

export const escapeXml = (s: string): string =>
  s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&apos;' })[c]!);

/** `measure` returns the advance width of a line in layout units (canvas measureText in the app). */
export function textToSvg(o: TextOptions, measure: (line: string, font: string) => number): string | null {
  const lines = o.text.replace(/\r\n?/g, '\n').split('\n');
  if (lines.every((l) => l.trim() === '')) return null;
  const font = `${o.italic ? 'italic ' : ''}${o.bold ? 'bold ' : ''}${FONT_SIZE}px ${o.fontFamily}`;
  const width = Math.max(1, ...lines.map((l) => measure(l, font)));
  const x = o.align === 'start' ? PADDING : o.align === 'middle' ? PADDING + width / 2 : PADDING + width;
  const rows = lines
    .map((line, i) => `<text x="${x}" y="${PADDING + FONT_SIZE * (i * LINE_HEIGHT + 1)}">${escapeXml(line)}</text>`)
    .join('');
  const lastBaseline = PADDING + FONT_SIZE * ((lines.length - 1) * LINE_HEIGHT + 1);
  const w = Math.ceil(width + 2 * PADDING);
  const h = Math.ceil(lastBaseline + FONT_SIZE * DESCENDER + PADDING);
  return (
    `<svg xmlns="http://www.w3.org/2000/svg" xml:space="preserve" viewBox="0 0 ${w} ${h}" width="${w}" height="${h}">` +
    `<g font-family="${escapeXml(o.fontFamily)}" font-size="${FONT_SIZE}" font-weight="${o.bold ? 700 : 400}" ` +
    `font-style="${o.italic ? 'italic' : 'normal'}" text-anchor="${o.align}" fill="#000">${rows}</g></svg>`
  );
}
