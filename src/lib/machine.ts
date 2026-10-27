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
 * Speed mode as the vendor app sets it for models that offer it (0 = slow, 1 = fast, from its
 * settings window). The vendor app does not offer it for the Master 2 Mini, which ships with 2,
 * so the effect on that model is unverified; the UI marks it experimental.
 */
export const SPEED_MODES = [
  { value: 0, key: 'speedSlow' },
  { value: 1, key: 'speedFast' },
] as const;
