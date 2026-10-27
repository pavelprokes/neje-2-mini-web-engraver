/**
 * Built-in test patterns for calibrating focus, power and mechanics. They are designed so one SVG
 * unit is one device dot, hence their width in dots (sized by the machine's pitch, 75 µm on the
 * Master 2 family) and the threshold (no dithering) they are inserted with.
 */
import type { MessageKey } from '@/i18n';

export interface TestPattern {
  readonly id: string;
  readonly nameKey: MessageKey;
  readonly descriptionKey: MessageKey;
  readonly fileName: string;
  /** Width in device dots: the SVG's viewBox width, 1 unit = 1 dot. */
  readonly widthDots: number;
  readonly svg: string;
}

export const TEST_PATTERNS: readonly TestPattern[] = [
  {
    id: 'focus',
    nameKey: 'patternFocus',
    descriptionKey: 'patternFocusHint',
    fileName: 'focus-test.svg',
    widthDots: 267,
    svg: `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 267 160" shape-rendering="crispEdges">
  <!-- Focus and resolution test (20 × 12 mm at 75 µm, 1 unit = 1 dot). Left: groups of three
       lines, line = gap = 1, 2, 3, 4 dots, vertical on top, horizontal below. Right: rings
       as in the NEJE focus guide; with good focus they stay separate. -->
  <rect x="8" y="6" width="1" height="52"/>
  <rect x="10" y="6" width="1" height="52"/>
  <rect x="12" y="6" width="1" height="52"/>
  <rect x="30" y="6" width="2" height="52"/>
  <rect x="34" y="6" width="2" height="52"/>
  <rect x="38" y="6" width="2" height="52"/>
  <rect x="58" y="6" width="3" height="52"/>
  <rect x="64" y="6" width="3" height="52"/>
  <rect x="70" y="6" width="3" height="52"/>
  <rect x="92" y="6" width="4" height="52"/>
  <rect x="100" y="6" width="4" height="52"/>
  <rect x="108" y="6" width="4" height="52"/>
  <rect x="8" y="70" width="104" height="1"/>
  <rect x="8" y="72" width="104" height="1"/>
  <rect x="8" y="74" width="104" height="1"/>
  <rect x="8" y="82" width="104" height="2"/>
  <rect x="8" y="86" width="104" height="2"/>
  <rect x="8" y="90" width="104" height="2"/>
  <rect x="8" y="100" width="104" height="3"/>
  <rect x="8" y="106" width="104" height="3"/>
  <rect x="8" y="112" width="104" height="3"/>
  <rect x="8" y="124" width="104" height="4"/>
  <rect x="8" y="132" width="104" height="4"/>
  <rect x="8" y="140" width="104" height="4"/>
  <g fill="none" stroke="#000" stroke-width="3" shape-rendering="geometricPrecision">
    <circle cx="200" cy="80" r="8"/>
    <circle cx="200" cy="80" r="18"/>
    <circle cx="200" cy="80" r="28"/>
    <circle cx="200" cy="80" r="38"/>
    <circle cx="200" cy="80" r="48"/>
    <circle cx="200" cy="80" r="58"/>
  </g>
  <circle cx="200" cy="80" r="3"/>
</svg>`,
  },
  {
    id: 'lines',
    nameKey: 'patternLines',
    descriptionKey: 'patternLinesHint',
    fileName: 'line-widths.svg',
    widthDots: 133,
    svg: `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 133 67" shape-rendering="crispEdges">
  <!-- 10 × 5 mm at 75 µm = 133 × 67 device pixels, so 1 unit = 1 dot. Separates causes of missing
       detail: line widths 1/2/4/8 dots in both directions, plus an asymmetric solid block. -->
  <rect x="5" y="4" width="1" height="30"/>
  <rect x="15" y="4" width="2" height="30"/>
  <rect x="27" y="4" width="4" height="30"/>
  <rect x="43" y="4" width="8" height="30"/>
  <rect x="5" y="40" width="50" height="1"/>
  <rect x="5" y="45" width="50" height="2"/>
  <rect x="5" y="51" width="50" height="4"/>
  <rect x="5" y="58" width="50" height="8"/>
  <rect x="72" y="4" width="30" height="26"/>
  <rect x="110" y="40" width="12" height="12"/>
</svg>`,
  },
  {
    id: 'square',
    nameKey: 'patternSquare',
    descriptionKey: 'patternSquareHint',
    fileName: 'calibration-square.svg',
    widthDots: 67,
    // 5 × 5 mm on the 67-dot grid: 2-dot frame, bars of 1, 2 and 4 dots, 2-dot diagonal
    svg: `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 67 67" shape-rendering="crispEdges">
  <path d="M0 0h67v67H0zM2 2v63h63V2z" fill-rule="evenodd"/>
  <rect x="14" y="7" width="1" height="53"/>
  <rect x="31" y="7" width="4" height="53"/>
  <rect x="50" y="7" width="2" height="53"/>
  <path d="M7 60 L60 7" stroke="#000" stroke-width="2" shape-rendering="geometricPrecision"/>
</svg>`,
  },
];

export const patternFile = (p: TestPattern): File => new File([p.svg], p.fileName, { type: 'image/svg+xml' });
