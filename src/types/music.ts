export interface NoteSourceMeta {
  startChar?: number;
  endChar?: number;
  staffIndex?: number;
  voiceIndex?: number;
}

/**
 * A note in the timeline, with timing expressed in subdivisions.
 *
 * Subdivisions are the smallest rhythmic unit in the meter:
 * - In 4/4 time, a subdivision is a quarter note (denominator = 4)
 * - In 12/8 time, a subdivision is an eighth note (denominator = 8)
 *
 * This makes calculations simpler and more consistent across meters.
 * Beats (the human-perceivable pulse) can be derived for display using
 * `subdivisionsPerBeat` from the timeline.
 */
export interface Note {
  pitch: number; // MIDI note number
  startSubdivision: number; // position in subdivisions (invariant)
  durationSubdivisions: number; // length in subdivisions (invariant)
  velocity: number; // 0-127
  source?: NoteSourceMeta;
}

/**
 * The musical timeline - all timing is in subdivisions, making it invariant to tempo changes.
 * Only needs to be computed once from the ABC notation.
 *
 * Terminology:
 * - Subdivision: The meter's base unit (denominator). In 12/8, an eighth note.
 * - Beat: The human-perceivable pulse. In 12/8, a dotted quarter (3 subdivisions).
 * - Measure: A complete bar. In 12/8, 12 subdivisions = 4 beats.
 */
export interface NoteTimeline {
  notes: Note[];
  totalSubdivisions: number; // total duration in subdivisions
  subdivisionsPerMeasure: number; // meter numerator (e.g., 12 for 12/8)
  subdivisionUnit: number; // meter denominator (e.g., 8 for 12/8)
  subdivisionsPerBeat: number; // how many subdivisions make one beat (e.g., 3 for 12/8)
  measureBoundaries?: number[]; // in subdivisions
}

/**
 * Generates an array of integer subdivision boundary positions.
 * Used for drawing grid lines in the piano roll visualization.
 *
 * @param totalSubdivisions - Total duration in subdivisions
 * @returns Array of subdivision positions (1, 2, 3, ...) up to totalSubdivisions
 *
 * @example
 * getSubdivisionBoundaries(4.5) // [1, 2, 3, 4]
 * getSubdivisionBoundaries(2) // [1]
 */
export const getSubdivisionBoundaries = (totalSubdivisions: number): number[] =>
  Array.from({ length: Math.floor(totalSubdivisions) }, (_, i) => i + 1).filter(
    (sub) => sub < totalSubdivisions - 1e-4
  );

/**
 * Generates an array of beat boundary positions in subdivisions.
 * Used for drawing beat grid lines in the piano roll visualization.
 *
 * @param totalSubdivisions - Total duration in subdivisions
 * @param subdivisionsPerBeat - Number of subdivisions per beat (1 for simple meters, 3 for compound)
 * @returns Array of subdivision positions where beats occur
 *
 * @example
 * getBeatBoundaries(12, 1) // [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11] (simple meter)
 * getBeatBoundaries(12, 3) // [3, 6, 9] (compound meter like 12/8)
 */
export const getBeatBoundaries = (
  totalSubdivisions: number,
  subdivisionsPerBeat: number = 1
): number[] => {
  const step = Math.max(1, subdivisionsPerBeat);
  const result: number[] = [];
  for (let pos = step; pos < totalSubdivisions - 1e-4; pos += step) {
    result.push(pos);
  }
  return result;
};

export interface NotePlaybackEvent {
  sequenceId: number;
  timeSeconds: number;
  durationSeconds?: number;
  midiPitches: number[];
  startChar?: number;
  endChar?: number;
}

export type NoteCharTimeMap = Record<number, number>;
