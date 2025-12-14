import { useMemo } from 'react';
import abcjs from 'abcjs';
import type { TuneObject, SynthOptions, AnimationOptions } from 'abcjs';
import { NoteTimeline } from '../types/music';
import {
  buildTimingDerivedData,
  TimingEvent,
  VisualObjWithTimings,
  DEFAULT_SECONDS_PER_SUBDIVISION,
  DEFAULT_SECONDS_PER_BEAT,
  TimingDerivedData,
} from '../utils/abcTiming';

/**
 * Result of the useOtamatoneRollNotes hook.
 * Contains the subdivision-based timeline (invariant) plus tempo info for playback.
 */
export type OtamatoneRollNotesResult = NoteTimeline & {
  /** Baseline tempo from the ABC notation (seconds per subdivision) */
  secondsPerSubdivision: number;
  /**
   * @deprecated Use secondsPerSubdivision instead
   */
  secondsPerBeat: number;
};

// Re-export for backward compatibility
export { DEFAULT_SECONDS_PER_SUBDIVISION, DEFAULT_SECONDS_PER_BEAT };

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
  totalSubdivisions: 0,
  subdivisionsPerMeasure: 4,
  subdivisionUnit: 4,
  subdivisionsPerBeat: 1,
  measureBoundaries: [],
});

const createEmptyResult = (): OtamatoneRollNotesResult => ({
  ...createEmptyTimeline(),
  secondsPerSubdivision: DEFAULT_SECONDS_PER_SUBDIVISION,
  secondsPerBeat: DEFAULT_SECONDS_PER_BEAT, // deprecated alias
});

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
      secondsPerSubdivision: DEFAULT_SECONDS_PER_SUBDIVISION,
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
      secondsPerSubdivision: DEFAULT_SECONDS_PER_SUBDIVISION,
      secondsPerBeat: DEFAULT_SECONDS_PER_BEAT,
    };
  }
  // NOTE: We intentionally don't pass secondsPerSubdivision here.
  // buildTimingDerivedData will use millisecondsPerMeasure() which is precise.
  // Do NOT use callbacks.qpm - it may be derived from abcjs's rounded currentTempo.
  return buildTimingDerivedData(visualObj, timings);
};

/**
 * Builds a subdivision-based timeline directly from ABC notation string.
 * This is a standalone function (not a hook) for use outside React components.
 *
 * Creates a hidden DOM container, renders the ABC notation with abcjs,
 * extracts timing data, and cleans up. The resulting timeline is
 * invariant to tempo changes.
 *
 * @param notation - ABC notation string
 * @returns Subdivision-based timeline with notes, totalSubdivisions, and secondsPerSubdivision
 *
 * @example
 * const timeline = buildTimelineFromNotation('X:1\nK:C\nCDEF|');
 * console.log(timeline.notes.length); // 4
 * console.log(timeline.totalSubdivisions); // 4
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
      secondsPerSubdivision: derived.secondsPerSubdivision,
      secondsPerBeat: derived.secondsPerBeat, // deprecated alias
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
 * Hook to get the subdivision-based note timeline from ABC notation.
 * The timeline is computed once and is invariant to tempo/warp changes.
 *
 * @param notation - The ABC notation string
 * @returns The subdivision-based timeline plus tempo info
 */
export const useOtamatoneRollNotes = (
  notation: string
): OtamatoneRollNotesResult => {
  return useMemo(() => {
    return buildTimelineFromNotation(notation);
  }, [notation]);
};
