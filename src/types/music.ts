export interface NoteSourceMeta {
  startChar?: number;
  endChar?: number;
  staffIndex?: number;
  voiceIndex?: number;
}

/**
 * A note in the timeline, with timing expressed in beats (invariant to tempo).
 */
export interface Note {
  pitch: number; // MIDI note number
  startBeat: number; // in beats (invariant)
  durationBeats: number; // in beats (invariant)
  velocity: number; // 0-127
  source?: NoteSourceMeta;
}

/**
 * The musical timeline - all timing is in beats, making it invariant to tempo changes.
 * Only needs to be computed once from the ABC notation.
 */
export interface NoteTimeline {
  notes: Note[];
  totalBeats: number; // total duration in beats
  beatsPerMeasure?: number; // e.g., 4 for 4/4 time
  measureBoundaries?: number[]; // in beats
}

/**
 * Generates an array of integer beat boundary positions.
 * Used for drawing beat grid lines in the piano roll visualization.
 *
 * @param totalBeats - Total duration in beats
 * @returns Array of beat positions (1, 2, 3, ...) up to totalBeats
 *
 * @example
 * getBeatBoundaries(4.5) // [1, 2, 3, 4]
 * getBeatBoundaries(2) // [1]
 */
export const getBeatBoundaries = (totalBeats: number): number[] =>
  Array.from({ length: Math.floor(totalBeats) }, (_, i) => i + 1).filter(
    (beat) => beat < totalBeats - 1e-4
  );

export interface NotePlaybackEvent {
  sequenceId: number;
  timeSeconds: number;
  durationSeconds?: number;
  midiPitches: number[];
  startChar?: number;
  endChar?: number;
}

export type NoteCharTimeMap = Record<number, number>;
