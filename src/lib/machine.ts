/**
 * Machine settings: device-wide values the engraver stores itself (they survive power cycles),
 * as opposed to job settings. Ranges follow the vendor app's settings window.
 */

/** Brightness of the pointer laser while idle. */
export const POINTER_LEVEL = { min: 0, max: 100 } as const;

/** Motion-detection sensitivity: the machine pauses a job when it is moved or tilted. */
export const SENSITIVITY_LEVELS = [
  { value: 0, key: 'sensitivityOff' },
  { value: 1, key: 'sensitivityLow' },
  { value: 2, key: 'sensitivityMedium' },
  { value: 3, key: 'sensitivityHigh' },
] as const;

/**
 * Motor speed as NEJE's Windows software offers it for the Master 2 family: a four-step slider,
 * Medium (2) being the default and what a factory Master 2 Mini reports.
 */
export const SPEED_MODES = [
  { value: 0, key: 'speedSlowest' },
  { value: 1, key: 'speedSlow' },
  { value: 2, key: 'speedMedium' },
  { value: 3, key: 'speedFast' },
] as const;
