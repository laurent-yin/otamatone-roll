const A4_FREQUENCY = 440;
const A4_MIDI = 69;

/** Default lowest MIDI note number (C1) */
export const DEFAULT_LOWEST_MIDI = 24;
/** Default highest MIDI note number (C8) */
export const DEFAULT_HIGHEST_MIDI = 108;

/**
 * Converts a MIDI note number to frequency in Hz.
 * Uses A4 = 440 Hz as the reference pitch.
 *
 * @param midi - MIDI note number (0-127, where 69 = A4)
 * @returns Frequency in Hz, or 0 if input is invalid
 *
 * @example
 * midiToFrequency(69) // 440 (A4)
 * midiToFrequency(60) // 261.63 (Middle C)
 */
export const midiToFrequency = (midi: number): number => {
  if (!Number.isFinite(midi)) {
    return 0;
  }
  return A4_FREQUENCY * Math.pow(2, (midi - A4_MIDI) / 12);
};

/**
 * Converts a frequency in Hz to a MIDI note number.
 * Uses A4 = 440 Hz as the reference pitch.
 *
 * @param frequency - Frequency in Hz (must be positive)
 * @returns MIDI note number (may be fractional), or 69 (A4) if input is invalid
 *
 * @example
 * frequencyToMidi(440) // 69 (A4)
 * frequencyToMidi(261.63) // ~60 (Middle C)
 */
export const frequencyToMidi = (frequency: number): number => {
  if (!Number.isFinite(frequency) || frequency <= 0) {
    return A4_MIDI;
  }
  return A4_MIDI + 12 * Math.log2(frequency / A4_FREQUENCY);
};

/** Default lowest frequency in Hz (~G#3, typical otamatone low end) */
export const DEFAULT_LOWEST_FREQUENCY = 204;
/** Default highest frequency in Hz (~B5, typical otamatone high end) */
export const DEFAULT_HIGHEST_FREQUENCY = 960;

/**
 * Calculates the normalized position (0-1) of a frequency on an otamatone stem.
 * Uses inverse frequency scaling for perceptually linear pitch spacing.
 *
 * @param fMin - Minimum frequency of the range (Hz)
 * @param fMax - Maximum frequency of the range (Hz)
 * @param f - Frequency to position (Hz)
 * @returns Normalized position (0 = fMin, 1 = fMax), clamped to [0, 1]
 *
 * @example
 * stemPosition(200, 800, 400) // ~0.33 (lower third of stem)
 */
export const stemPosition = (fMin: number, fMax: number, f: number): number => {
  if (
    !Number.isFinite(fMin) ||
    !Number.isFinite(fMax) ||
    !Number.isFinite(f) ||
    fMin <= 0 ||
    fMax <= 0 ||
    fMax === fMin
  ) {
    return 0;
  }

  const clamped = Math.min(
    Math.max(f, Math.min(fMin, fMax)),
    Math.max(fMin, fMax)
  );
  const invMin = 1 / fMin;
  const invMax = 1 / fMax;
  const invF = 1 / clamped;
  const denominator = invMax - invMin;
  if (denominator === 0) {
    return 0;
  }

  const normalized = (invF - invMin) / denominator;
  return Math.min(Math.max(normalized, 0), 1);
};

const NOTE_NAMES_SHARP = [
  'C',
  'C#',
  'D',
  'D#',
  'E',
  'F',
  'F#',
  'G',
  'G#',
  'A',
  'A#',
  'B',
];

const NOTE_NAMES_FLAT = [
  'C',
  'Db',
  'D',
  'Eb',
  'E',
  'F',
  'Gb',
  'G',
  'Ab',
  'A',
  'Bb',
  'B',
];

/**
 * Converts a MIDI note number to a note name (e.g., "C#/Db").
 * Returns both sharp and flat names for accidentals.
 *
 * @param midi - MIDI note number (rounded to nearest integer)
 * @returns Note name string, or empty string if input is invalid
 *
 * @example
 * midiToNoteName(60) // "C"
 * midiToNoteName(61) // "C#/Db"
 * midiToNoteName(69) // "A"
 */
export const midiToNoteName = (midi: number): string => {
  if (!Number.isFinite(midi)) {
    return '';
  }
  const rounded = Math.round(midi);
  const index = ((rounded % 12) + 12) % 12;
  const sharp = NOTE_NAMES_SHARP[index] ?? '';
  const flat = NOTE_NAMES_FLAT[index] ?? '';
  if (!sharp && !flat) {
    return '';
  }
  if (!sharp) {
    return flat;
  }
  if (!flat || sharp === flat) {
    return sharp;
  }
  return `${sharp}/${flat}`;
};
