import { useMemo } from 'react';
import abcjs from 'abcjs';
import { NoteTimeline } from '../types/music';
import {
  buildTimingDerivedData,
  TimingEvent,
  VisualObjWithTimings,
} from '../utils/abcTiming';

export type OtamatoneRollNotesResult = NoteTimeline & {
  baselineSecondsPerBeat: number;
  playbackSecondsPerBeat: number;
};
type TimingCallbacksInstance = {
  noteTimings?: TimingEvent[];
  replaceTarget?: (target: VisualObjWithTimings) => void;
  qpm?: number;
};

type VisualObjWithAudioSupport = VisualObjWithTimings & {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  setUpAudio?: (options?: Record<string, any>) => void;
};
const isPositiveNumber = (value: unknown): value is number =>
  typeof value === 'number' && Number.isFinite(value) && value > 0;

const isBrowser = () => typeof document !== 'undefined';
const DEFAULT_BPM = 120;
export const DEFAULT_SECONDS_PER_BEAT = 60 / DEFAULT_BPM;

const createEmptyTimeline = (secondsPerBeat = DEFAULT_SECONDS_PER_BEAT) => ({
  notes: [],
  totalDuration: 0,
  secondsPerBeat,
  measureBoundaries: [],
});

const extractSecondsPerBeat = (qpm?: number): number | undefined => {
  if (typeof qpm === 'number' && Number.isFinite(qpm) && qpm > 0) {
    return 60 / qpm;
  }
  return undefined;
};

const createHiddenContainer = () => {
  const container = document.createElement('div');
  container.style.position = 'absolute';
  container.style.left = '-9999px';
  container.style.height = '0';
  container.style.overflow = 'hidden';
  container.style.pointerEvents = 'none';
  container.setAttribute('aria-hidden', 'true');
  document.body?.appendChild(container);
  return container;
};

const deriveTimelineFromTimingData = (
  visualObj: VisualObjWithAudioSupport,
  callbacks: TimingCallbacksInstance | null
): NoteTimeline => {
  if (!callbacks) {
    return createEmptyTimeline();
  }
  try {
    visualObj.setUpAudio?.();
  } catch (error) {
    console.warn('Unable to prime audio data for timeline extraction', error);
  }

  callbacks.replaceTarget?.(visualObj);
  const timings = Array.isArray(callbacks.noteTimings)
    ? callbacks.noteTimings
    : [];
  if (timings.length === 0) {
    return createEmptyTimeline();
  }
  const derived = buildTimingDerivedData(visualObj, timings, {
    secondsPerBeat: extractSecondsPerBeat(callbacks.qpm),
  });
  return derived.timeline;
};

export const buildBaselineTimelineFromNotation = (
  notation: string
): NoteTimeline => {
  if (!notation || notation.trim() === '') {
    return createEmptyTimeline();
  }

  if (!isBrowser()) {
    return createEmptyTimeline();
  }

  let container: HTMLDivElement | null = null;
  try {
    container = createHiddenContainer();
    const visualObjs = abcjs.renderAbc(container, notation, {
      responsive: 'resize',
    });

    const visualObj =
      (Array.isArray(visualObjs) && visualObjs[0]
        ? (visualObjs[0] as VisualObjWithAudioSupport)
        : null) ?? null;

    if (!visualObj) {
      return createEmptyTimeline();
    }

    const TimingCallbacksCtor = abcjs.TimingCallbacks as unknown as
      | (new (
          target: VisualObjWithTimings,
          options?: Record<string, unknown>
        ) => TimingCallbacksInstance)
      | undefined;
    if (typeof TimingCallbacksCtor !== 'function') {
      console.warn(
        'abcjs TimingCallbacks unavailable; returning fallback timeline.'
      );
      return createEmptyTimeline();
    }

    const timingCallbacks = new TimingCallbacksCtor(visualObj, {});
    return deriveTimelineFromTimingData(visualObj, timingCallbacks);
  } catch (error) {
    console.error(
      'Error deriving baseline timeline from abcjs timing data',
      error
    );
    return createEmptyTimeline();
  } finally {
    if (container) {
      container.remove();
    }
  }
};

export const normalizeTimelineToBaseline = (
  timeline: NoteTimeline,
  baselineSecondsPerBeat: number
): NoteTimeline => {
  return {
    notes: timeline.notes.map((note) => ({ ...note })),
    totalDuration: timeline.totalDuration,
    secondsPerBeat: baselineSecondsPerBeat,
    measureBoundaries: Array.isArray(timeline.measureBoundaries)
      ? [...timeline.measureBoundaries]
      : [],
  };
};

export const createOtamatoneRollNotesResult = (
  baselineTimeline: NoteTimeline,
  overrideTimeline?: NoteTimeline | null
): OtamatoneRollNotesResult => {
  const baselineSecondsPerBeat = isPositiveNumber(
    baselineTimeline.secondsPerBeat
  )
    ? (baselineTimeline.secondsPerBeat as number)
    : DEFAULT_SECONDS_PER_BEAT;

  const sourceTimeline = overrideTimeline ?? baselineTimeline;
  const playbackSecondsPerBeat = isPositiveNumber(sourceTimeline.secondsPerBeat)
    ? (sourceTimeline.secondsPerBeat as number)
    : baselineSecondsPerBeat;
  const normalizedTimeline = normalizeTimelineToBaseline(
    sourceTimeline,
    baselineSecondsPerBeat
  );
  return {
    ...normalizedTimeline,
    baselineSecondsPerBeat,
    playbackSecondsPerBeat,
  };
};

export const useOtamatoneRollNotes = (
  notation: string,
  override?: NoteTimeline | null
): OtamatoneRollNotesResult => {
  const baselineTimeline = useMemo<NoteTimeline>(() => {
    return buildBaselineTimelineFromNotation(notation);
  }, [notation]);
  return useMemo(() => {
    return createOtamatoneRollNotesResult(baselineTimeline, override);
  }, [baselineTimeline, override]);
};
