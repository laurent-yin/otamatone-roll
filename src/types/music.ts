export interface Note {
  pitch: number; // MIDI note number
  startTime: number; // in seconds
  duration: number; // in seconds
  velocity: number; // 0-127
}
