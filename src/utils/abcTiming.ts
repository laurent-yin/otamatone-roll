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

/** Default BPM when not specified */
const DEFAULT_BPM = 120;
/**
 * Default seconds per subdivision at 120 BPM (assuming quarter note subdivision).
 * Used as fallback when tempo cannot be determined from ABC notation.
 */
export const DEFAULT_SECONDS_PER_SUBDIVISION = 60 / DEFAULT_BPM;

/**
 * @deprecated Use DEFAULT_SECONDS_PER_SUBDIVISION instead
 */
export const DEFAULT_SECONDS_PER_BEAT = DEFAULT_SECONDS_PER_SUBDIVISION;

/**
 * Result of building timing data from ABC notation.
 * Contains both the subdivision-based timeline (invariant) and tempo info for playback.
 */
export interface TimingDerivedData {
  /** Map from character position to time in seconds (for cursor sync) */
  charMap: NoteCharTimeMap;
  /** The musical timeline in subdivisions (invariant to tempo) */
  timeline: NoteTimeline;
  /** Seconds per subdivision (for converting to real time) */
  secondsPerSubdivision: number;
  /**
   * @deprecated Use secondsPerSubdivision instead
   */
  secondsPerBeat: number;
}

/**
 * Extract meter information from the visual object.
 *
 * Returns subdivision-based meter info:
 * - subdivisionsPerMeasure: The meter numerator (e.g., 12 for 12/8)
 * - subdivisionUnit: The meter denominator (e.g., 8 for 12/8)
 */
const getMeterInfo = (visualObj: VisualObjWithTimings) => {
  const meter =
    typeof visualObj?.getMeterFraction === 'function'
      ? visualObj.getMeterFraction()
      : undefined;

  const subdivisionsPerMeasure =
    meter &&
    typeof meter.num === 'number' &&
    Number.isFinite(meter.num) &&
    meter.num > 0
      ? meter.num
      : 4; // default to 4/4

  const subdivisionUnit =
    meter &&
    typeof meter.den === 'number' &&
    Number.isFinite(meter.den) &&
    meter.den > 0
      ? meter.den
      : 4; // default quarter note

  return { subdivisionsPerMeasure, subdivisionUnit };
};

/**
 * Determine how many subdivisions make up one musical beat.
 *
 * For compound meters (6/8, 9/8, 12/8), a beat is typically a dotted quarter = 3 subdivisions.
 * For simple meters (4/4, 3/4, 2/4), a beat equals one subdivision.
 *
 * @param subdivisionsPerMeasure - The meter numerator
 * @param subdivisionUnit - The meter denominator
 * @returns Number of subdivisions per beat
 */
const getSubdivisionsPerBeat = (
  subdivisionsPerMeasure: number,
  subdivisionUnit: number
): number => {
  // Compound meter detection: numerator divisible by 3 (but not 3 itself) and denominator is 8
  const isCompoundMeter =
    subdivisionUnit === 8 &&
    subdivisionsPerMeasure > 3 &&
    subdivisionsPerMeasure % 3 === 0;

  return isCompoundMeter ? 3 : 1;
};

/**
 * Calculate seconds per subdivision from the visual object or timing events.
 *
 * IMPORTANT: This returns the ORIGINAL tempo from the ABC notation, NOT the
 * current playback tempo (which may be affected by warp/speed control).
 *
 * abcjs behavior:
 * - `visualObj.millisecondsPerMeasure()` always returns the original tempo
 * - This value does NOT change when setWarp() is called
 * - `synthControl.currentTempo` is ROUNDED to an integer - DO NOT USE for calculations!
 * - For real-time playback sync, calculate precise tempo from millisecondsPerMeasure() and warp
 *
 * This function is appropriate for:
 * - Building the initial timeline (which is tempo-invariant)
 * - Getting the base tempo before any warp is applied
 *
 * This function is NOT appropriate for:
 * - Converting real-time playback position to subdivisions (use precise calculation)
 */
const getSecondsPerSubdivision = (
  visualObj: VisualObjWithTimings,
  timings: TimingEvent[]
): number => {
  const { subdivisionsPerMeasure } = getMeterInfo(visualObj);

  // NOTE: millisecondsPerMeasure() returns the ORIGINAL tempo, unaffected by warp.
  // This is intentional here since we're building the invariant timeline.
  const msPerMeasureFromMethod =
    typeof visualObj?.millisecondsPerMeasure === 'function'
      ? visualObj.millisecondsPerMeasure()
      : undefined;

  if (
    typeof msPerMeasureFromMethod === 'number' &&
    Number.isFinite(msPerMeasureFromMethod) &&
    msPerMeasureFromMethod > 0
  ) {
    return msPerMeasureFromMethod / 1000 / subdivisionsPerMeasure;
  }

  // Fallback: millisecondsPerMeasure on timing events also reflects original tempo
  const firstTimingWithMeasure = timings.find(
    (event) =>
      typeof event?.millisecondsPerMeasure === 'number' &&
      event.millisecondsPerMeasure > 0
  );

  if (firstTimingWithMeasure?.millisecondsPerMeasure) {
    return (
      firstTimingWithMeasure.millisecondsPerMeasure /
      1000 /
      subdivisionsPerMeasure
    );
  }

  return DEFAULT_SECONDS_PER_BEAT;
};

/**
 * Builds subdivision-based timeline data from ABC notation timing events.
 * This is the core function that transforms abcjs timing callbacks into
 * a tempo-invariant musical timeline.
 *
 * The resulting timeline stores all timing in subdivisions (not seconds), making it
 * independent of tempo changes. The `secondsPerSubdivision` value can be used to
 * convert to real time for playback.
 *
 * Terminology:
 * - Subdivision: The meter's base unit (denominator). In 12/8, this is an eighth note.
 * - Beat: The human-perceivable pulse. In 12/8, a dotted quarter (3 subdivisions).
 *
 * @param visualObj - The abcjs TuneObject (from renderAbc)
 * @param timings - Array of timing events from abcjs TimingCallbacks
 * @param options - Optional configuration
 * @param options.secondsPerSubdivision - Override tempo (seconds per subdivision)
 * @returns Derived timing data including charMap, timeline, and tempo
 *
 * @example
 * const visualObjs = abcjs.renderAbc('container', notation);
 * const timingCallbacks = new abcjs.TimingCallbacks(visualObjs[0], {});
 * const derived = buildTimingDerivedData(visualObjs[0], timingCallbacks.noteTimings);
 * console.log(derived.timeline.notes); // Subdivision-based notes
 * console.log(derived.secondsPerSubdivision); // Tempo for playback conversion
 */
export const buildTimingDerivedData = (
  visualObj: VisualObjWithTimings,
  timings: TimingEvent[],
  options?: { secondsPerSubdivision?: number }
): TimingDerivedData => {
  const mapping: NoteCharTimeMap = {};
  const notes: Note[] = [];
  const measureBoundaries: number[] = [];

  // Get tempo and meter info
  const { subdivisionsPerMeasure, subdivisionUnit } = getMeterInfo(visualObj);
  const secondsPerSubdivision =
    options?.secondsPerSubdivision ??
    getSecondsPerSubdivision(visualObj, timings);
  const subdivisionsPerBeat = getSubdivisionsPerBeat(
    subdivisionsPerMeasure,
    subdivisionUnit
  );

  // Calculate how many subdivisions are in a whole note
  // This is needed to convert pitchInfo.duration (in whole notes) to subdivisions
  // Example for 12/8:
  // - subdivisionUnit = 8 (eighth notes)
  // - An eighth note (0.125 whole) = 0.125 * 8 = 1 subdivision ✓
  // - A dotted quarter (0.375 whole) = 0.375 * 8 = 3 subdivisions ✓
  const wholeNoteInSubdivisions = subdivisionUnit;

  // Helper to add unique boundaries
  const addBoundary = (collection: number[], subdivision?: number) => {
    if (
      typeof subdivision !== 'number' ||
      !Number.isFinite(subdivision) ||
      subdivision < 0
    ) {
      return;
    }
    const normalized = Number(subdivision.toFixed(6));
    const last = collection[collection.length - 1];
    if (typeof last === 'number' && Math.abs(last - normalized) < 1e-4) {
      return;
    }
    collection.push(normalized);
  };

  let maxEndSubdivisions = 0;
  let lastMeasureIndex: number | null = null;

  timings.forEach((event) => {
    if (!event) return;

    // Convert milliseconds to subdivisions
    const timeSubdivisions =
      typeof event.milliseconds === 'number' && secondsPerSubdivision > 0
        ? event.milliseconds / 1000 / secondsPerSubdivision
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
      typeof timeSubdivisions === 'number'
    ) {
      addBoundary(measureBoundaries, timeSubdivisions);
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
          typeof timeSubdivisions === 'number' &&
          timeSubdivisions > 0 &&
          (hasMeasureStartFlag || measureStartUnknown)
        ) {
          addBoundary(measureBoundaries, timeSubdivisions);
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

      // Get start subdivision - prefer event milliseconds, fall back to pitchInfo.start (in whole notes)
      let startSubdivision: number;
      if (typeof timeSubdivisions === 'number') {
        startSubdivision = timeSubdivisions;
      } else if (typeof pitchInfo.start === 'number') {
        // pitchInfo.start is in whole notes, convert to subdivisions
        startSubdivision = pitchInfo.start * wholeNoteInSubdivisions;
      } else {
        startSubdivision = 0;
      }

      // Get duration in subdivisions
      let durationSubdivisions: number;
      if (typeof event.duration === 'number' && secondsPerSubdivision > 0) {
        // event.duration is in milliseconds
        durationSubdivisions = event.duration / 1000 / secondsPerSubdivision;
      } else if (typeof pitchInfo.duration === 'number') {
        // pitchInfo.duration is in whole notes, convert to subdivisions
        durationSubdivisions = pitchInfo.duration * wholeNoteInSubdivisions;
      } else {
        durationSubdivisions = 0;
      }

      const effectiveEnd = Math.max(
        startSubdivision + durationSubdivisions,
        startSubdivision
      );
      if (effectiveEnd > maxEndSubdivisions) {
        maxEndSubdivisions = effectiveEnd;
      }

      const startChar = Array.isArray(event.startCharArray)
        ? (event.startCharArray[index] as number | null | undefined)
        : event.startChar;
      const endChar = Array.isArray(event.endCharArray)
        ? (event.endCharArray[index] as number | null | undefined)
        : event.endChar;

      notes.push({
        pitch: pitchInfo.pitch,
        startSubdivision,
        durationSubdivisions,
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
  if (measureBoundaries.length === 0 && subdivisionsPerMeasure > 0) {
    for (
      let boundary = subdivisionsPerMeasure;
      boundary <= maxEndSubdivisions + 1e-6;
      boundary += subdivisionsPerMeasure
    ) {
      addBoundary(measureBoundaries, boundary);
    }
  }

  if (typeof console !== 'undefined' && typeof console.debug === 'function') {
    console.debug('[abcTiming] timeline summary (subdivisions)', {
      totalSubdivisions: Number(maxEndSubdivisions.toFixed(4)),
      secondsPerSubdivision: Number(secondsPerSubdivision.toFixed(4)),
      subdivisionsPerMeasure,
      subdivisionUnit,
      subdivisionsPerBeat,
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
      totalSubdivisions: maxEndSubdivisions,
      subdivisionsPerMeasure,
      subdivisionUnit,
      subdivisionsPerBeat,
      measureBoundaries,
    },
    secondsPerSubdivision,
    // Deprecated alias for backward compatibility
    secondsPerBeat: secondsPerSubdivision,
  };
};
