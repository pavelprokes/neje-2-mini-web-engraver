import { describe, expect, it } from 'vitest';
import { escapeXml, textToSvg } from './text';

const measure = (line: string) => line.length * 60; // fake monospace metrics
const base = { fontFamily: 'Georgia, serif', bold: false, italic: false, align: 'start' } as const;

describe('textToSvg', () => {
  it('lays out lines and sizes the viewBox to the longest one', () => {
    const svg = textToSvg({ ...base, text: 'Eliška & Michal\n25. 4. 2026' }, measure)!;
    expect(svg).toContain('viewBox="0 0 940 295"'); // 15 chars × 60 + 2 × 20 padding; last baseline 245 + descender 30 + 20
    expect(svg).toContain('xml:space="preserve"'); // repeated spaces survive, matching what was measured
    expect(svg.match(/<text /g)).toHaveLength(2);
    expect(svg).toContain('Eliška &amp; Michal');
  });

  it('escapes markup so typed text can never inject elements or attributes', () => {
    const svg = textToSvg({ ...base, text: '<script>alert(1)</script> "x" \'y\'' }, measure)!;
    expect(svg).not.toContain('<script>');
    expect(svg).toContain('&lt;script&gt;');
    expect(escapeXml(`"'<>&`)).toBe('&quot;&apos;&lt;&gt;&amp;');
    expect(textToSvg({ ...base, fontFamily: '"><script>', text: 'a' }, measure)).not.toContain('"><script>');
  });

  it('leaves room below the last baseline for descenders', () => {
    const svg = textToSvg({ ...base, text: 'gypsy' }, measure)!;
    const [, , , h] = /viewBox="([\d ]+)"/.exec(svg)![1]!.split(' ').map(Number);
    const baseline = Number(/<text x="\d+" y="(\d+)"/.exec(svg)![1]);
    expect(h! - baseline).toBeGreaterThanOrEqual(30); // ≥ 0.3 em at font size 100
  });

  it('applies style and alignment, and returns null for blank text', () => {
    const svg = textToSvg({ ...base, text: 'Hi', bold: true, italic: true, align: 'middle' }, measure)!;
    expect(svg).toContain('font-weight="700"');
    expect(svg).toContain('font-style="italic"');
    expect(svg).toContain('text-anchor="middle"');
    expect(svg).toContain('x="80"'); // 20 padding + 120 / 2
    expect(textToSvg({ ...base, text: '  \n ' }, measure)).toBeNull();
  });
});
