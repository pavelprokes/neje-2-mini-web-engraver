import type { RhythmNote } from '@/lib/protocol';

/** A note of a motor jingle in physical units; converted to device pixels by the caller. */
export interface JingleNote {
  readonly mm: number;
  readonly ms: number;
}

const EIGHTH = 170;
const SHORT = 1.5;
const LONG = 3;

/**
 * "Shave and a haircut — two bits", the classic knock. Rhythm only: stepper pitch depends on
 * travel speed, which the NEJE protocol does not expose.
 */
export const CONNECT_JINGLE: readonly JingleNote[] = [
  { mm: LONG, ms: 2 * EIGHTH }, // shave
  { mm: SHORT, ms: EIGHTH }, // and
  { mm: SHORT, ms: EIGHTH }, // a
  { mm: LONG, ms: 2 * EIGHTH }, // hair-
  { mm: LONG, ms: 4 * EIGHTH }, // -cut (+ rest)
  { mm: LONG, ms: 2 * EIGHTH }, // two
  { mm: LONG, ms: 2 * EIGHTH }, // bits
];

export const toRhythm = (jingle: readonly JingleNote[], mmToPx: (mm: number) => number): RhythmNote[] =>
  jingle.map((n) => ({ lengthPx: n.mm > 0 ? Math.max(1, mmToPx(n.mm)) : 0, durationMs: n.ms }));
