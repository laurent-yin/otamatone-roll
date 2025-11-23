const A4_FREQUENCY = 440;
const A4_MIDI = 69;

export const DEFAULT_LOWEST_MIDI = 24;
export const DEFAULT_HIGHEST_MIDI = 108;

export const midiToFrequency = (midi: number): number => {
  if (!Number.isFinite(midi)) {
    return 0;
  }
  return A4_FREQUENCY * Math.pow(2, (midi - A4_MIDI) / 12);
};

export const frequencyToMidi = (frequency: number): number => {
  if (!Number.isFinite(frequency) || frequency <= 0) {
    return A4_MIDI;
  }
  return A4_MIDI + 12 * Math.log2(frequency / A4_FREQUENCY);
};

export const DEFAULT_LOWEST_FREQUENCY = midiToFrequency(DEFAULT_LOWEST_MIDI);
export const DEFAULT_HIGHEST_FREQUENCY = midiToFrequency(DEFAULT_HIGHEST_MIDI);

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
