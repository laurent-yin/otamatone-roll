import { useMemo } from 'react';
import abcjs from 'abcjs';
import type { TuneObject, SynthOptions, AnimationOptions } from 'abcjs';
import { NoteTimeline } from '../types/music';
import {
  buildTimingDerivedData,
  TimingEvent,
  VisualObjWithTimings,
  DEFAULT_SECONDS_PER_BEAT,
  TimingDerivedData,
} from '../utils/abcTiming';

/**
 * Result of the useOtamatoneRollNotes hook.
 * Contains the beat-based timeline (invariant) plus tempo info for playback.
 */
export type OtamatoneRollNotesResult = NoteTimeline & {
  /** Baseline tempo from the ABC notation (seconds per beat) */
  secondsPerBeat: number;
};

// Re-export for backward compatibility
export { DEFAULT_SECONDS_PER_BEAT };

/**
 * Extended TuneObject with setUpAudio method for preparing timing data.
 */
type VisualObjWithAudioSupport = TuneObject & {
  setUpAudio?: (options?: SynthOptions) => void;
};

/**
 * Instance type for TimingCallbacks with the properties we use.
 */
type TimingCallbacksInstance = {
  noteTimings?: TimingEvent[];
  replaceTarget?: (target: VisualObjWithTimings) => void;
  qpm?: number;
};

const isBrowser = () => typeof document !== 'undefined';

const createEmptyTimeline = (): NoteTimeline => ({
  notes: [],
  totalBeats: 0,
  beatsPerMeasure: 4,
  measureBoundaries: [],
  beatBoundaries: [],
});

const createEmptyResult = (): OtamatoneRollNotesResult => ({
  ...createEmptyTimeline(),
  secondsPerBeat: DEFAULT_SECONDS_PER_BEAT,
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
): TimingDerivedData => {
  if (!callbacks) {
    return {
      charMap: {},
      timeline: createEmptyTimeline(),
      secondsPerBeat: DEFAULT_SECONDS_PER_BEAT,
    };
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
    return {
      charMap: {},
      timeline: createEmptyTimeline(),
      secondsPerBeat: DEFAULT_SECONDS_PER_BEAT,
    };
  }
  return buildTimingDerivedData(visualObj, timings, {
    secondsPerBeat: extractSecondsPerBeat(callbacks.qpm),
  });
};

/**
 * Build the beat-based timeline from ABC notation.
 * This is computed once and is invariant to tempo changes.
 */
export const buildTimelineFromNotation = (
  notation: string
): OtamatoneRollNotesResult => {
  if (!notation || notation.trim() === '') {
    return createEmptyResult();
  }

  if (!isBrowser()) {
    return createEmptyResult();
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
      return createEmptyResult();
    }

    const TimingCallbacksCtor = abcjs.TimingCallbacks as unknown as
      | (new (
          target: TuneObject,
          options?: AnimationOptions
        ) => TimingCallbacksInstance)
      | undefined;
    if (typeof TimingCallbacksCtor !== 'function') {
      console.warn(
        'abcjs TimingCallbacks unavailable; returning fallback timeline.'
      );
      return createEmptyResult();
    }

    const timingCallbacks = new TimingCallbacksCtor(visualObj, {});
    const derived = deriveTimelineFromTimingData(visualObj, timingCallbacks);
    return {
      ...derived.timeline,
      secondsPerBeat: derived.secondsPerBeat,
    };
  } catch (error) {
    console.error('Error deriving timeline from abcjs timing data', error);
    return createEmptyResult();
  } finally {
    if (container) {
      container.remove();
    }
  }
};

/**
 * Hook to get the beat-based note timeline from ABC notation.
 * The timeline is computed once and is invariant to tempo/warp changes.
 *
 * @param notation - The ABC notation string
 * @returns The beat-based timeline plus tempo info
 */
export const useOtamatoneRollNotes = (
  notation: string
): OtamatoneRollNotesResult => {
  return useMemo(() => {
    return buildTimelineFromNotation(notation);
  }, [notation]);
};
