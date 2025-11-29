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
  beatBoundaries?: number[]; // in beats (0, 1, 2, 3, ...)
}

export interface NotePlaybackEvent {
  sequenceId: number;
  timeSeconds: number;
  durationSeconds?: number;
  midiPitches: number[];
  startChar?: number;
  endChar?: number;
}

export type NoteCharTimeMap = Record<number, number>;
