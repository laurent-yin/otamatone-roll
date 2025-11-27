export interface NoteSourceMeta {
  startChar?: number;
  endChar?: number;
  staffIndex?: number;
  voiceIndex?: number;
}

export interface Note {
  pitch: number; // MIDI note number
  startTime: number; // in seconds
  duration: number; // in seconds
  velocity: number; // 0-127
  source?: NoteSourceMeta;
}

export interface NoteTimeline {
  notes: Note[];
  totalDuration: number;
  secondsPerBeat?: number;
  measureBoundaries?: number[];
  beatBoundaries?: number[];
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
