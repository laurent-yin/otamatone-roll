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
  barNumber?: number;
  measureNumber?: number;
  measureStart?: boolean;
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
  const measureBoundaries: number[] = [];

  const addMeasureBoundary = (timeSeconds?: number) => {
    if (
      typeof timeSeconds !== 'number' ||
      !Number.isFinite(timeSeconds) ||
      timeSeconds < 0
    ) {
      return;
    }
    const normalized = Number(timeSeconds.toFixed(6));
    const last = measureBoundaries[measureBoundaries.length - 1];
    if (typeof last === 'number' && Math.abs(last - normalized) < 1e-4) {
      return;
    }
    measureBoundaries.push(normalized);
  };

  const meterFraction =
    typeof visualObj?.getMeterFraction === 'function'
      ? visualObj.getMeterFraction()
      : undefined;
  const beatsPerMeasure =
    meterFraction &&
    typeof meterFraction.num === 'number' &&
    Number.isFinite(meterFraction.num) &&
    meterFraction.num > 0
      ? meterFraction.num
      : undefined;
  const firstTimingWithMeasure = timings.find(
    (event) => typeof event?.millisecondsPerMeasure === 'number'
  );
  const secondsPerWholeNote = getSecondsPerWholeNote(
    visualObj,
    firstTimingWithMeasure?.millisecondsPerMeasure
  );
  const fallbackSecondsPerBeat =
    secondsPerWholeNote > 0 ? secondsPerWholeNote / 4 : undefined;
  const baselineSecondsPerBeat =
    options?.secondsPerBeat ?? fallbackSecondsPerBeat;

  const fallbackSecondsPerMeasure = (() => {
    if (
      typeof firstTimingWithMeasure?.millisecondsPerMeasure === 'number' &&
      firstTimingWithMeasure.millisecondsPerMeasure > 0
    ) {
      return firstTimingWithMeasure.millisecondsPerMeasure / 1000;
    }
    if (
      typeof beatsPerMeasure === 'number' &&
      typeof baselineSecondsPerBeat === 'number' &&
      beatsPerMeasure > 0 &&
      baselineSecondsPerBeat > 0
    ) {
      return beatsPerMeasure * baselineSecondsPerBeat;
    }
    return undefined;
  })();

  let maxEndSeconds = 0;
  let lastMeasureIndex: number | null = null;

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

    if (
      (event.type === 'bar' || event.type === 'measure') &&
      typeof timeSeconds === 'number'
    ) {
      addMeasureBoundary(timeSeconds);
    }

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
          typeof timeSeconds === 'number' &&
          timeSeconds > 0 &&
          (hasMeasureStartFlag || measureStartUnknown)
        ) {
          addMeasureBoundary(timeSeconds);
        }
        lastMeasureIndex = eventMeasureIndex;
      }
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

  if (
    measureBoundaries.length === 0 &&
    typeof fallbackSecondsPerMeasure === 'number' &&
    fallbackSecondsPerMeasure > 0
  ) {
    for (
      let boundary = fallbackSecondsPerMeasure;
      boundary <= maxEndSeconds + 1e-6;
      boundary += fallbackSecondsPerMeasure
    ) {
      addMeasureBoundary(boundary);
    }
  }

  if (typeof console !== 'undefined' && typeof console.debug === 'function') {
    const preview = measureBoundaries
      .slice(0, 5)
      .map((value) => Number(value.toFixed(4)));
    console.debug('[abcTiming] timeline summary', {
      totalDuration: Number(maxEndSeconds.toFixed(4)),
      secondsPerBeat: baselineSecondsPerBeat,
      measurePreview: preview,
      measureCount: measureBoundaries.length,
    });
  }

  return {
    charMap: mapping,
    timeline: {
      notes,
      totalDuration: maxEndSeconds,
      secondsPerBeat: baselineSecondsPerBeat,
      measureBoundaries,
    },
  };
};
