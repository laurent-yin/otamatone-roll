import type { TuneObject, NoteTimingEvent, MidiPitch } from 'abcjs';
import { Note, NoteCharTimeMap, NoteTimeline } from '../types/music';

/**
 * Type alias for TuneObject - the visual object returned by abcjs.renderAbc()
 * has methods for getting timing and meter information.
 */
export type VisualObjWithTimings = TuneObject;

/**
 * Type alias for MidiPitch from abcjs.
 * @deprecated Use MidiPitch from 'abcjs' directly
 */
export type TimingMidiPitch = MidiPitch;

/**
 * Extended timing event type that includes additional event types
 * observed at runtime but not in the official abcjs type definitions.
 */
export type TimingEventType = 'end' | 'event' | 'bar' | 'measure';

/**
 * Extended NoteTimingEvent with additional properties that exist at runtime
 * but are not fully typed in abcjs. These properties are observed in actual
 * abcjs timing callback events.
 */
export interface TimingEvent extends Omit<NoteTimingEvent, 'type'> {
  /** Event type - extended to include bar/measure types */
  type?: TimingEventType;
  /** Duration in milliseconds (not always present in abcjs types) */
  duration?: number;
  /** Bar number for bar events */
  barNumber?: number;
}

/** Default beats per quarter note (standard music notation) */
const BEATS_PER_QUARTER_NOTE = 1;
/** Quarter notes per whole note */
const QUARTER_NOTES_PER_WHOLE = 4;
/** Default BPM when not specified */
const DEFAULT_BPM = 120;
/** Default seconds per beat at 120 BPM */
export const DEFAULT_SECONDS_PER_BEAT = 60 / DEFAULT_BPM;

/**
 * Result of building timing data from ABC notation.
 * Contains both the beat-based timeline (invariant) and tempo info for playback.
 */
export interface TimingDerivedData {
  /** Map from character position to time in seconds (for cursor sync) */
  charMap: NoteCharTimeMap;
  /** The musical timeline in beats (invariant to tempo) */
  timeline: NoteTimeline;
  /** Baseline tempo from the ABC notation */
  secondsPerBeat: number;
}

/**
 * Extract meter information from the visual object.
 */
const getMeterInfo = (visualObj: VisualObjWithTimings) => {
  const meter =
    typeof visualObj?.getMeterFraction === 'function'
      ? visualObj.getMeterFraction()
      : undefined;

  const beatsPerMeasure =
    meter &&
    typeof meter.num === 'number' &&
    Number.isFinite(meter.num) &&
    meter.num > 0
      ? meter.num
      : 4; // default to 4/4

  const beatUnit =
    meter &&
    typeof meter.den === 'number' &&
    Number.isFinite(meter.den) &&
    meter.den > 0
      ? meter.den
      : 4; // default quarter note

  return { beatsPerMeasure, beatUnit };
};

/**
 * Calculate seconds per beat from the visual object or timing events.
 */
const getSecondsPerBeat = (
  visualObj: VisualObjWithTimings,
  timings: TimingEvent[]
): number => {
  const { beatsPerMeasure } = getMeterInfo(visualObj);

  // Try to get milliseconds per measure from the visual object
  const msPerMeasureFromMethod =
    typeof visualObj?.millisecondsPerMeasure === 'function'
      ? visualObj.millisecondsPerMeasure()
      : undefined;

  if (
    typeof msPerMeasureFromMethod === 'number' &&
    Number.isFinite(msPerMeasureFromMethod) &&
    msPerMeasureFromMethod > 0
  ) {
    return msPerMeasureFromMethod / 1000 / beatsPerMeasure;
  }

  // Fallback: try to get from first timing event
  const firstTimingWithMeasure = timings.find(
    (event) =>
      typeof event?.millisecondsPerMeasure === 'number' &&
      event.millisecondsPerMeasure > 0
  );

  if (firstTimingWithMeasure?.millisecondsPerMeasure) {
    return (
      firstTimingWithMeasure.millisecondsPerMeasure / 1000 / beatsPerMeasure
    );
  }

  return DEFAULT_SECONDS_PER_BEAT;
};

/**
 * Build beat-based timeline from ABC timing events.
 * The resulting timeline is invariant to tempo changes.
 */
export const buildTimingDerivedData = (
  visualObj: VisualObjWithTimings,
  timings: TimingEvent[],
  options?: { secondsPerBeat?: number }
): TimingDerivedData => {
  const mapping: NoteCharTimeMap = {};
  const notes: Note[] = [];
  const measureBoundaries: number[] = [];

  // Get tempo and meter info
  const secondsPerBeat =
    options?.secondsPerBeat ?? getSecondsPerBeat(visualObj, timings);
  const { beatsPerMeasure } = getMeterInfo(visualObj);

  // Helper to add unique boundaries
  const addBoundary = (collection: number[], beat?: number) => {
    if (typeof beat !== 'number' || !Number.isFinite(beat) || beat < 0) {
      return;
    }
    const normalized = Number(beat.toFixed(6));
    const last = collection[collection.length - 1];
    if (typeof last === 'number' && Math.abs(last - normalized) < 1e-4) {
      return;
    }
    collection.push(normalized);
  };

  let maxEndBeats = 0;
  let lastMeasureIndex: number | null = null;

  timings.forEach((event) => {
    if (!event) return;

    // Convert milliseconds to beats
    const timeBeats =
      typeof event.milliseconds === 'number' && secondsPerBeat > 0
        ? event.milliseconds / 1000 / secondsPerBeat
        : undefined;

    // Build char map (still in seconds for cursor sync with abcjs)
    if (typeof event.milliseconds === 'number') {
      const timeSeconds = event.milliseconds / 1000;
      const chars = Array.isArray(event.startCharArray)
        ? event.startCharArray
        : [event.startChar];

      chars?.forEach((char) => {
        if (
          typeof char === 'number' &&
          Number.isFinite(char) &&
          mapping[char] === undefined
        ) {
          mapping[char] = timeSeconds;
        }
      });
    }

    // Handle bar/measure events
    if (
      (event.type === 'bar' || event.type === 'measure') &&
      typeof timeBeats === 'number'
    ) {
      addBoundary(measureBoundaries, timeBeats);
    }

    // Handle measure number changes
    const eventMeasureIndex = (() => {
      if (
        typeof event.measureNumber === 'number' &&
        Number.isFinite(event.measureNumber)
      ) {
        return event.measureNumber;
      }
      if (
        typeof event.barNumber === 'number' &&
        Number.isFinite(event.barNumber)
      ) {
        return event.barNumber;
      }
      return null;
    })();

    if (eventMeasureIndex !== null) {
      const isNewMeasure =
        lastMeasureIndex === null || eventMeasureIndex > lastMeasureIndex;
      if (isNewMeasure) {
        const hasMeasureStartFlag = event.measureStart === true;
        const measureStartUnknown = typeof event.measureStart === 'undefined';
        if (
          typeof timeBeats === 'number' &&
          timeBeats > 0 &&
          (hasMeasureStartFlag || measureStartUnknown)
        ) {
          addBoundary(measureBoundaries, timeBeats);
        }
        lastMeasureIndex = eventMeasureIndex;
      }
    }

    // Process note events
    if (event.type !== 'event' || !Array.isArray(event.midiPitches)) {
      return;
    }

    event.midiPitches.forEach((pitchInfo, index) => {
      if (!pitchInfo || typeof pitchInfo.pitch !== 'number') return;

      // Get start beat - prefer event milliseconds, fall back to pitchInfo.start (in whole notes)
      let startBeat: number;
      if (typeof timeBeats === 'number') {
        startBeat = timeBeats;
      } else if (typeof pitchInfo.start === 'number') {
        // pitchInfo.start is in whole notes, convert to quarter note beats
        startBeat =
          pitchInfo.start * QUARTER_NOTES_PER_WHOLE * BEATS_PER_QUARTER_NOTE;
      } else {
        startBeat = 0;
      }

      // Get duration in beats
      let durationBeats: number;
      if (typeof event.duration === 'number' && secondsPerBeat > 0) {
        // event.duration is in milliseconds
        durationBeats = event.duration / 1000 / secondsPerBeat;
      } else if (typeof pitchInfo.duration === 'number') {
        // pitchInfo.duration is in whole notes
        durationBeats =
          pitchInfo.duration * QUARTER_NOTES_PER_WHOLE * BEATS_PER_QUARTER_NOTE;
      } else {
        durationBeats = 0;
      }

      const effectiveEnd = Math.max(startBeat + durationBeats, startBeat);
      if (effectiveEnd > maxEndBeats) {
        maxEndBeats = effectiveEnd;
      }

      const startChar = Array.isArray(event.startCharArray)
        ? (event.startCharArray[index] as number | null | undefined)
        : event.startChar;
      const endChar = Array.isArray(event.endCharArray)
        ? (event.endCharArray[index] as number | null | undefined)
        : event.endChar;

      notes.push({
        pitch: pitchInfo.pitch,
        startBeat,
        durationBeats,
        velocity: typeof pitchInfo.volume === 'number' ? pitchInfo.volume : 80,
        source: {
          startChar:
            typeof startChar === 'number' && Number.isFinite(startChar)
              ? startChar
              : undefined,
          endChar:
            typeof endChar === 'number' && Number.isFinite(endChar)
              ? endChar
              : undefined,
        },
      });
    });
  });

  // Generate fallback measure boundaries if none were found
  if (measureBoundaries.length === 0 && beatsPerMeasure > 0) {
    for (
      let boundary = beatsPerMeasure;
      boundary <= maxEndBeats + 1e-6;
      boundary += beatsPerMeasure
    ) {
      addBoundary(measureBoundaries, boundary);
    }
  }

  // Generate beat boundaries (simple sequence: 1, 2, 3, ...)
  const beatBoundaries: number[] = [];
  for (let beat = 1; beat < maxEndBeats - 1e-4; beat += 1) {
    beatBoundaries.push(beat);
  }

  if (typeof console !== 'undefined' && typeof console.debug === 'function') {
    console.debug('[abcTiming] timeline summary (beats)', {
      totalBeats: Number(maxEndBeats.toFixed(4)),
      secondsPerBeat: Number(secondsPerBeat.toFixed(4)),
      beatsPerMeasure,
      measurePreview: measureBoundaries
        .slice(0, 5)
        .map((v) => Number(v.toFixed(4))),
      measureCount: measureBoundaries.length,
      noteCount: notes.length,
    });
  }

  return {
    charMap: mapping,
    timeline: {
      notes,
      totalBeats: maxEndBeats,
      beatsPerMeasure,
      measureBoundaries,
      beatBoundaries,
    },
    secondsPerBeat,
  };
};
