import { Note, NoteCharTimeMap, NoteTimeline } from '../types/music';

export interface VisualObjWithTimings {
  getMeterFraction?: () => { num?: number; den?: number };
  millisecondsPerMeasure?: () => number;
}

export interface TimingMidiPitch {
  pitch?: number;
  duration?: number;
  volume?: number;
  start?: number;
}

export interface TimingEvent {
  type?: string;
  milliseconds?: number;
  duration?: number;
  millisecondsPerMeasure?: number;
  startChar?: number | null;
  startCharArray?: Array<number | null>;
  endChar?: number | null;
  endCharArray?: Array<number | null>;
  midiPitches?: Array<TimingMidiPitch | null>;
}

const getSecondsPerWholeNote = (
  visualObj: VisualObjWithTimings,
  fallbackMsPerMeasure?: number
): number => {
  const meter =
    typeof visualObj?.getMeterFraction === 'function'
      ? visualObj.getMeterFraction()
      : undefined;
  const meterSize =
    meter && typeof meter.num === 'number' && typeof meter.den === 'number'
      ? meter.den !== 0
        ? meter.num / meter.den
        : 0
      : 1;

  const msPerMeasureFromMethod =
    typeof visualObj?.millisecondsPerMeasure === 'function'
      ? visualObj.millisecondsPerMeasure()
      : undefined;
  const msPerMeasure =
    typeof msPerMeasureFromMethod === 'number'
      ? msPerMeasureFromMethod
      : fallbackMsPerMeasure;

  if (
    typeof msPerMeasure !== 'number' ||
    !Number.isFinite(msPerMeasure) ||
    meterSize <= 0
  ) {
    return 0;
  }

  return msPerMeasure / 1000 / meterSize;
};

export const buildTimingDerivedData = (
  visualObj: VisualObjWithTimings,
  timings: TimingEvent[],
  options?: { secondsPerBeat?: number }
): { charMap: NoteCharTimeMap; timeline: NoteTimeline } => {
  const mapping: NoteCharTimeMap = {};
  const notes: Note[] = [];

  const firstTimingWithMeasure = timings.find(
    (event) => typeof event?.millisecondsPerMeasure === 'number'
  );
  const secondsPerWholeNote = getSecondsPerWholeNote(
    visualObj,
    firstTimingWithMeasure?.millisecondsPerMeasure
  );
  const fallbackSecondsPerBeat =
    secondsPerWholeNote > 0 ? secondsPerWholeNote / 4 : undefined;

  let maxEndSeconds = 0;

  timings.forEach((event) => {
    if (!event) return;
    const timeSeconds =
      typeof event.milliseconds === 'number'
        ? event.milliseconds / 1000
        : undefined;

    if (typeof timeSeconds === 'number') {
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

    if (event.type !== 'event' || !Array.isArray(event.midiPitches)) {
      return;
    }

    event.midiPitches.forEach((pitchInfo, index) => {
      if (!pitchInfo || typeof pitchInfo.pitch !== 'number') return;
      const startSeconds =
        typeof timeSeconds === 'number'
          ? timeSeconds
          : typeof pitchInfo.start === 'number' && secondsPerWholeNote > 0
            ? pitchInfo.start * secondsPerWholeNote
            : 0;

      const durationSeconds =
        typeof event.duration === 'number'
          ? event.duration / 1000
          : typeof pitchInfo.duration === 'number' && secondsPerWholeNote > 0
            ? pitchInfo.duration * secondsPerWholeNote
            : 0;

      const effectiveEnd = Math.max(
        startSeconds + durationSeconds,
        startSeconds
      );
      if (effectiveEnd > maxEndSeconds) {
        maxEndSeconds = effectiveEnd;
      }

      const startChar = Array.isArray(event.startCharArray)
        ? (event.startCharArray[index] as number | null | undefined)
        : event.startChar;
      const endChar = Array.isArray(event.endCharArray)
        ? (event.endCharArray[index] as number | null | undefined)
        : event.endChar;

      notes.push({
        pitch: pitchInfo.pitch,
        startTime: startSeconds,
        duration: durationSeconds,
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

  return {
    charMap: mapping,
    timeline: {
      notes,
      totalDuration: maxEndSeconds,
      secondsPerBeat: options?.secondsPerBeat ?? fallbackSecondsPerBeat,
    },
  };
};
