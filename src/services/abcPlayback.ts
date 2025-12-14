import abcjs from 'abcjs';
import type { TuneObject, SynthOptions, CursorControl } from 'abcjs';
import {
  NoteCharTimeMap,
  NotePlaybackEvent,
  NoteTimeline,
} from '../types/music';
import {
  buildTimingDerivedData,
  DEFAULT_SECONDS_PER_SUBDIVISION,
  TimingEvent,
  VisualObjWithTimings,
} from '../utils/abcTiming';

/**
 * ============================================================================
 * ABCJS TIMING BEHAVIOR NOTES
 * ============================================================================
 *
 * abcjs has several timing-related values that behave differently:
 *
 * 1. **visualObj.millisecondsPerMeasure()** - Returns the ORIGINAL tempo from
 *    the ABC notation, unaffected by warp/speed changes. This is useful for
 *    building the invariant timeline but NOT for real-time playback sync.
 *
 * 2. **TimingCallbacks event.milliseconds** - Reports REAL elapsed time during
 *    playback, AFFECTED by warp. At 50% warp, the same musical position takes
 *    twice as long in real time. Use this with the current (warped) tempo to
 *    convert back to musical position (subdivisions).
 *
 * 3. **synthControl.currentTempo** - The current tempo in QPM, **ROUNDED** to
 *    an integer by abcjs. DO NOT USE for timing calculations! For example,
 *    65 BPM at 50% warp gives precise 32.5 QPM, but currentTempo shows 33.
 *    This causes sync drift when resuming or seeking.
 *
 * 4. **TimingCallbacks.noteTimings** - Contains timing data at the ORIGINAL
 *    tempo. The `milliseconds` values here are pre-computed at original tempo,
 *    not warped. But the `pitchInfo.start` and `pitchInfo.duration` values are
 *    in whole notes (invariant).
 *
 * 5. **synthControl.warp** - The warp percentage (100 = normal, 50 = half).
 *    Use this with millisecondsPerMeasure() to calculate the PRECISE tempo:
 *    preciseQpm = originalQpm * (warp / 100)
 *
 * KEY INSIGHT: The timeline (notes with startSubdivision/durationSubdivisions)
 * should be built once and is invariant. Only the tempo conversion factor
 * (secondsPerSubdivision) needs to change when warp changes.
 *
 * SYNC FIX: When updating timingCallbacks.qpm, use calculatePreciseQpm()
 * instead of currentTempo to avoid sync drift at non-integer tempos.
 * ============================================================================
 */

const isBrowser = () => typeof document !== 'undefined';
const logPrefix = '[AbcPlayback]';

export interface AbcPlaybackCallbacks {
  onCurrentTimeChange?: (currentTime: number) => void;
  onPlayingChange?: (isPlaying: boolean) => void;
  onNoteEvent?: (event: NotePlaybackEvent) => void;
  onCharTimeMapChange?: (map: NoteCharTimeMap) => void;
  onNoteTimelineChange?: (timeline: NoteTimeline | null) => void;
  /** Called when tempo changes (e.g., due to warp/speed control) */
  onSecondsPerBeatChange?: (secondsPerBeat: number) => void;
}

export interface AbcPlaybackConfig {
  notation: string;
  containerId: string;
  audioContainerId?: string;
  callbacks?: AbcPlaybackCallbacks;
}

/**
 * Extended TuneObject that may have setUpAudio available.
 * The setUpAudio method prepares timing data for playback.
 */
type VisualObjWithAudioSupport = TuneObject & {
  setUpAudio?: (options?: SynthOptions) => unknown;
};

/**
 * Internal interface for the SynthController with properties
 * that exist at runtime but may not be in official types.
 */
type SynthControllerLike = {
  load: (
    container: HTMLElement,
    cursorControl?: CursorControl | null,
    options?: Record<string, unknown>
  ) => void;
  destroy?: () => void;
  setTune: (
    visualObj: TuneObject,
    userAction: boolean,
    options?: SynthOptions & { timingCallbacks?: TimingCallbacksInternal }
  ) => unknown;
  _play?: () => Promise<unknown>;
  pause?: () => void;
  finished?: () => void | string;
  restart?: () => void;
  seek?: (percent: number, units?: number | string) => void;
  setWarp?: (warp: number) => Promise<unknown>;
  // NOTE: currentTempo exists on abcjs runtime but is intentionally NOT included here.
  // It is ROUNDED to an integer and causes sync drift. Use calculatePreciseQpm() instead.
  /** Warp percentage (100 = normal, 50 = half speed). Used for precise tempo calculation */
  warp?: number;
  percent?: number;
  isStarted?: boolean;
};

/**
 * Internal interface for TimingCallbacks instance with properties
 * used for playback synchronization.
 *
 * WARNING: The qpm property should only be set using precise calculations,
 * never from synthControl.currentTempo (which is rounded).
 */
type TimingCallbacksInternal = {
  noteTimings?: TimingEvent[];
  replaceTarget?: (target: VisualObjWithTimings) => void;
  /**
   * Quarter notes per minute for timing calculations.
   * WARNING: Only set this using calculatePreciseQpm(), never from currentTempo!
   */
  qpm?: number;
  setProgress?: (percent: number, units?: number | string) => void;
  start?: (offsetPercent?: number) => void;
  stop?: () => void;
  pause?: () => void;
};

/**
 * Normalizes MIDI pitch data from various abcjs event formats into a clean array.
 * Handles both direct number arrays and object arrays with pitch/midi properties.
 *
 * @param input - Raw pitch data from abcjs timing event (may be array of numbers or objects)
 * @returns Array of valid MIDI note numbers (0-127)
 *
 * @example
 * normalizeMidiPitches([60, 64, 67]) // [60, 64, 67]
 * normalizeMidiPitches([{ pitch: 60 }, { midi: 64 }]) // [60, 64]
 */
export const normalizeMidiPitches = (input: unknown): number[] => {
  if (!Array.isArray(input)) {
    return [];
  }

  return input
    .map((pitch) => {
      if (typeof pitch === 'number' && Number.isFinite(pitch)) {
        return pitch;
      }
      if (pitch && typeof pitch === 'object') {
        const candidate =
          (pitch as { pitch?: number }).pitch ??
          (pitch as { midi?: number }).midi;
        if (typeof candidate === 'number' && Number.isFinite(candidate)) {
          return candidate;
        }
      }
      return undefined;
    })
    .filter((value): value is number => value !== undefined);
};

/**
 * Controller class that manages ABC notation rendering and audio playback.
 * Integrates with abcjs to provide synchronized playback with timing callbacks.
 *
 * @example
 * const controller = new AbcPlaybackController({
 *   notation: 'X:1\nT:Test\nK:C\nCDEF|',
 *   containerId: 'notation-container',
 *   audioContainerId: 'audio-controls',
 *   callbacks: {
 *     onCurrentTimeChange: (time) => console.log('Time:', time),
 *     onNoteTimelineChange: (timeline) => console.log('Notes:', timeline),
 *   },
 * });
 *
 * // When done:
 * controller.dispose();
 */
export class AbcPlaybackController {
  private readonly notation: string;
  private readonly containerId: string;
  private readonly audioContainerId?: string;
  private readonly callbacks: AbcPlaybackCallbacks;

  private synthControl: SynthControllerLike | null = null;
  private timingCallbacks: TimingCallbacksInternal | null = null;
  private visualObj: VisualObjWithAudioSupport | null = null;
  private eventSequence = 0;
  private resetButtonCleanup: (() => void) | null = null;
  private audioDataPrepared = false;

  // Cached subdivision info for tempo calculations (avoids rebuilding timeline on warp change)
  private cachedSubdivisionsPerMeasure: number = 4;
  private cachedBeatsPerMeasure: number = 4;

  constructor(config: AbcPlaybackConfig) {
    this.notation = config.notation;
    this.containerId = config.containerId;
    this.audioContainerId = config.audioContainerId;
    this.callbacks = config.callbacks ?? {};

    if (!isBrowser()) {
      console.warn(`${logPrefix} Browser APIs unavailable; skipping init.`);
      this.resetDerivedData();
      return;
    }

    console.log(`${logPrefix} Constructing controller`, {
      containerId: this.containerId,
      audioContainerId: this.audioContainerId,
      notationLength: this.notation.length,
    });
    this.initialize();
  }

  dispose() {
    if (this.resetButtonCleanup) {
      this.resetButtonCleanup();
      this.resetButtonCleanup = null;
    }

    if (this.timingCallbacks) {
      this.timingCallbacks.stop?.();
      this.timingCallbacks = null;
    }

    if (this.synthControl) {
      this.synthControl.destroy?.();
      console.log(`${logPrefix} Synth controller disposed.`);
      this.synthControl = null;
    }
  }

  private initialize() {
    const container = document.getElementById(this.containerId);
    if (!container) {
      console.error(`Container with id "${this.containerId}" not found`);
      this.resetDerivedData();
      return;
    }

    console.log(`${logPrefix} Container located, rendering ABC.`);

    if (!this.notation || this.notation.trim() === '') {
      container.innerHTML = '';
      this.resetDerivedData();
      return;
    }

    try {
      const visualObjs = abcjs.renderAbc(this.containerId, this.notation, {
        responsive: 'resize',
      });

      if (!visualObjs || !visualObjs[0]) {
        this.resetDerivedData();
        return;
      }

      this.visualObj = visualObjs[0] as VisualObjWithAudioSupport;
      console.log(`${logPrefix} Visual object created.`);

      this.setupTimingCallbacks();

      if (this.audioContainerId) {
        this.setupAudioControls();
      }
    } catch (error) {
      console.error('Error rendering ABC notation:', error);
      this.resetDerivedData();
    }
  }

  private resetDerivedData() {
    console.log(`${logPrefix} Resetting derived data.`);
    this.callbacks.onCharTimeMapChange?.({});
    this.callbacks.onNoteTimelineChange?.(null);
    this.audioDataPrepared = false;
  }

  private handleTimingEvent = (event: unknown) => {
    if (!event || typeof event !== 'object') {
      return;
    }

    // Use event.milliseconds from the timing callback.
    // The audio and timing callbacks use precise tempo (not rounded currentTempo).
    const milliseconds = (event as { milliseconds?: number }).milliseconds;
    if (typeof milliseconds === 'number' && Number.isFinite(milliseconds)) {
      const currentTime = milliseconds / 1000;
      this.callbacks.onCurrentTimeChange?.(currentTime);

      const midiPitches = normalizeMidiPitches(
        (event as { midiPitches?: unknown }).midiPitches
      );

      if (midiPitches.length > 0 && this.callbacks.onNoteEvent) {
        this.eventSequence += 1;
        const duration = (event as { duration?: number }).duration;
        const startChar = (event as { startChar?: number }).startChar;
        const endChar = (event as { endChar?: number }).endChar;

        const normalizedEvent: NotePlaybackEvent = {
          sequenceId: this.eventSequence,
          timeSeconds: currentTime,
          durationSeconds:
            typeof duration === 'number' && Number.isFinite(duration)
              ? duration / 1000
              : undefined,
          midiPitches,
          startChar:
            typeof startChar === 'number' && Number.isFinite(startChar)
              ? startChar
              : undefined,
          endChar:
            typeof endChar === 'number' && Number.isFinite(endChar)
              ? endChar
              : undefined,
        };

        this.callbacks.onNoteEvent(normalizedEvent);
      }
    }
  };

  private setupTimingCallbacks() {
    if (!this.visualObj) {
      return;
    }

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const callbacks = new (abcjs.TimingCallbacks as any)(this.visualObj, {
      eventCallback: this.handleTimingEvent,
    }) as TimingCallbacksInternal;

    this.timingCallbacks = callbacks;
    console.log(`${logPrefix} TimingCallbacks ready.`);
    this.prepareTimingData();
  }

  private prepareTimingData() {
    if (!this.visualObj || !this.timingCallbacks || this.audioDataPrepared) {
      return;
    }

    try {
      if (typeof this.visualObj.setUpAudio === 'function') {
        this.visualObj.setUpAudio();
      }
      this.timingCallbacks.replaceTarget?.(this.visualObj);
      const hasTimings = Array.isArray(this.timingCallbacks.noteTimings)
        ? this.timingCallbacks.noteTimings.length > 0
        : false;
      this.audioDataPrepared = hasTimings;
      if (!hasTimings) {
        console.warn(
          `${logPrefix} Timing data still empty after preparation attempt.`
        );
      } else {
        console.log(`${logPrefix} Timing data prepared.`);
      }
      this.emitTimingDerivedData();
    } catch (error) {
      console.warn('Failed to prepare timing data before playback', error);
    }
  }

  /**
   * Emits timing data to callbacks.
   *
   * IMPORTANT: This function handles the split between:
   * 1. The INVARIANT timeline (notes with startSubdivision/durationSubdivisions)
   *    - Built from the ABC notation, never changes with tempo/warp
   * 2. The CURRENT tempo (effectiveSecondsPerSubdivision)
   *    - Changes when warp/speed is adjusted
   *    - Used to convert real-time playback position to subdivisions
   *
   * The timeline from buildTimingDerivedData uses the ORIGINAL tempo (from
   * visualObj.millisecondsPerMeasure), but we override the tempo with the
   * CURRENT tempo from synthControl.currentTempo (which includes warp).
   */
  private emitTimingDerivedData() {
    if (!this.visualObj || !this.timingCallbacks) {
      this.resetDerivedData();
      return;
    }

    const timings = this.timingCallbacks.noteTimings;
    if (!Array.isArray(timings) || timings.length === 0) {
      this.resetDerivedData();
      return;
    }

    // buildTimingDerivedData returns the ORIGINAL tempo (unaffected by warp)
    const derived = buildTimingDerivedData(
      this.visualObj,
      timings as TimingEvent[]
    );

    // Cache subdivision info for tempo calculations (avoids rebuilding timeline on warp change)
    this.cachedSubdivisionsPerMeasure =
      derived.timeline.subdivisionsPerMeasure || 4;
    // Beats per measure = subdivisionsPerMeasure / subdivisionsPerBeat
    const subdivisionsPerBeat = derived.timeline.subdivisionsPerBeat || 1;
    this.cachedBeatsPerMeasure =
      this.cachedSubdivisionsPerMeasure / subdivisionsPerBeat;

    // Calculate effective seconds per subdivision based on current tempo (which includes warp)
    const effectiveSecondsPerSubdivision =
      this.calculateEffectiveSecondsPerSubdivision(
        derived.secondsPerSubdivision
      );

    console.log(`${logPrefix} Derived timeline`, {
      notes: derived.timeline.notes.length,
      totalSubdivisions: derived.timeline.totalSubdivisions,
      secondsPerSubdivision: effectiveSecondsPerSubdivision,
      originalSecondsPerSubdivision: derived.secondsPerSubdivision,
      warp: this.synthControl?.warp,
    });

    // Emit the current tempo (warped)
    this.callbacks.onSecondsPerBeatChange?.(effectiveSecondsPerSubdivision);

    this.callbacks.onCharTimeMapChange?.(derived.charMap);

    if (derived.timeline.notes.length === 0) {
      console.warn(
        `${logPrefix} Derived timeline contained no notes; keeping fallback timeline.`
      );
      this.callbacks.onNoteTimelineChange?.(null);
    } else {
      console.log(`${logPrefix} Calling onNoteTimelineChange with timeline`, {
        hasCallback: !!this.callbacks.onNoteTimelineChange,
        notesCount: derived.timeline.notes.length,
      });
      this.callbacks.onNoteTimelineChange?.(derived.timeline);
    }
  }

  /**
   * Get the current warp value, defaulting to 100% if unavailable.
   */
  private getCurrentWarp(): number {
    return this.synthControl &&
      typeof this.synthControl.warp === 'number' &&
      this.synthControl.warp > 0
      ? this.synthControl.warp
      : 100;
  }

  /**
   * Get the original millisecondsPerMeasure from visualObj.
   * Returns undefined if not available.
   */
  private getOriginalMsPerMeasure(): number | undefined {
    const msPerMeasure =
      typeof this.visualObj?.millisecondsPerMeasure === 'function'
        ? this.visualObj.millisecondsPerMeasure()
        : undefined;

    if (
      typeof msPerMeasure === 'number' &&
      Number.isFinite(msPerMeasure) &&
      msPerMeasure > 0
    ) {
      return msPerMeasure;
    }
    return undefined;
  }

  /**
   * Calculate effective seconds per subdivision based on current tempo.
   *
   * Uses precise calculation from visualObj.millisecondsPerMeasure() and warp.
   * The audio playback uses this same precise timing internally.
   * Note: currentTempo is only used for display (rounded to integer) and should
   * NOT be used for timing calculations.
   *
   * @param fallback - Fallback value if tempo cannot be calculated
   */
  private calculateEffectiveSecondsPerSubdivision(fallback: number): number {
    const warp = this.getCurrentWarp();
    const originalMsPerMeasure = this.getOriginalMsPerMeasure();

    if (originalMsPerMeasure === undefined) {
      return fallback;
    }

    // Calculate effective ms per measure with warp applied
    // Audio uses: effectiveMsPerMeasure = originalMsPerMeasure * 100 / warp
    const effectiveMsPerMeasure = (originalMsPerMeasure * 100) / warp;

    // Convert to seconds per subdivision
    const subdivisionsPerMeasure = this.cachedSubdivisionsPerMeasure || 4;
    const secondsPerSubdivision =
      effectiveMsPerMeasure / 1000 / subdivisionsPerMeasure;

    return secondsPerSubdivision;
  }

  /**
   * Calculate the precise QPM (quarters per minute) based on current warp.
   *
   * IMPORTANT: This returns the PRECISE tempo, not the rounded value from
   * synthControl.currentTempo. The audio playback uses precise tempo internally,
   * so we must match that for proper synchronization.
   *
   * For example, at 65 BPM with 50% warp:
   * - Precise QPM: 32.5
   * - currentTempo (rounded): 33 or 32
   *
   * Using the rounded value causes sync drift when resuming or seeking.
   *
   * @returns Precise QPM value, or undefined if cannot be calculated
   */
  private calculatePreciseQpm(): number | undefined {
    const warp = this.getCurrentWarp();
    const originalMsPerMeasure = this.getOriginalMsPerMeasure();

    if (originalMsPerMeasure === undefined) {
      return undefined;
    }

    // Calculate original QPM from millisecondsPerMeasure
    // QPM = 60 / secondsPerBeat = 60 / (msPerMeasure / 1000 / beatsPerMeasure)
    //     = 60 * 1000 * beatsPerMeasure / msPerMeasure
    const beatsPerMeasure = this.cachedBeatsPerMeasure || 4;
    const originalQpm = (60 * 1000 * beatsPerMeasure) / originalMsPerMeasure;

    // Apply warp to get effective QPM
    // warp=100 means normal speed, warp=50 means half speed (lower QPM)
    const preciseQpm = (originalQpm * warp) / 100;

    return preciseQpm;
  }

  /**
   * Emit only the tempo change, without rebuilding the invariant timeline.
   * Called when warp/speed changes.
   */
  private emitTempoChange() {
    const effectiveSecondsPerSubdivision =
      this.calculateEffectiveSecondsPerSubdivision(
        DEFAULT_SECONDS_PER_SUBDIVISION
      );

    console.log(`${logPrefix} Tempo changed (timeline unchanged)`, {
      secondsPerSubdivision: effectiveSecondsPerSubdivision,
      warp: this.synthControl?.warp,
      subdivisionsPerMeasure: this.cachedSubdivisionsPerMeasure,
    });

    this.callbacks.onSecondsPerBeatChange?.(effectiveSecondsPerSubdivision);
  }

  private setupAudioControls() {
    if (!this.visualObj || !this.audioContainerId) {
      return;
    }

    this.prepareTimingData();

    const audioContainer = document.getElementById(this.audioContainerId);
    if (!audioContainer) {
      console.warn(
        `Audio container with id "${this.audioContainerId}" not found`
      );
      return;
    }

    const synthControl = new abcjs.synth.SynthController();
    synthControl.load(audioContainer, null, {
      displayLoop: true,
      displayRestart: true,
      displayPlay: true,
      displayProgress: true,
      displayWarp: true,
    });

    const controller = synthControl as unknown as SynthControllerLike;
    this.synthControl = controller;
    console.log(`${logPrefix} Synth controller loaded.`);
    this.attachAudioSyncHandlers();
    this.attachResetButton(audioContainer);

    const maybePromise = controller.setTune(this.visualObj, false, {
      timingCallbacks: this.timingCallbacks ?? undefined,
    });
    console.log(`${logPrefix} setTune invoked.`);

    if (
      typeof maybePromise === 'object' &&
      maybePromise !== null &&
      typeof (maybePromise as PromiseLike<unknown>).then === 'function'
    ) {
      (maybePromise as Promise<unknown>)
        .then(() => {
          console.log(`${logPrefix} setTune resolved.`);
          this.emitTimingDerivedData();
        })
        .catch((error) => {
          console.warn(`${logPrefix} setTune rejected`, error);
        });
    } else {
      // If setTune is synchronous, emit immediately.
      this.emitTimingDerivedData();
    }
  }

  private attachResetButton(audioContainer: HTMLElement) {
    const resetButton = audioContainer.querySelector(
      '.abcjs-midi-reset'
    ) as HTMLElement | null;

    if (!resetButton) {
      return;
    }

    const handler = () => {
      this.timingCallbacks?.stop?.();
      this.timingCallbacks?.setProgress?.(0);
      this.callbacks.onCurrentTimeChange?.(0);
      this.callbacks.onPlayingChange?.(false);
      console.log(`${logPrefix} Reset button clicked.`);
    };

    resetButton.addEventListener('click', handler);
    this.resetButtonCleanup = () => {
      resetButton.removeEventListener('click', handler);
    };
  }

  private attachAudioSyncHandlers() {
    if (!this.synthControl || !this.timingCallbacks) {
      return;
    }

    const controller = this.synthControl;

    const originalPlay = controller._play?.bind(controller);
    if (originalPlay) {
      controller._play = () =>
        originalPlay().then((result) => {
          const isPlaying = Boolean(controller.isStarted);
          if (isPlaying) {
            const offset =
              typeof controller.percent === 'number'
                ? controller.percent
                : undefined;
            this.timingCallbacks?.start?.(offset);
          } else {
            this.timingCallbacks?.pause?.();
            if (typeof controller.percent === 'number') {
              this.timingCallbacks?.setProgress?.(controller.percent);
            }
          }
          this.callbacks.onPlayingChange?.(isPlaying);
          console.log(`${logPrefix} _play resolved`, { isPlaying });
          return result;
        });
    }

    const originalPause = controller.pause?.bind(controller);
    if (originalPause) {
      controller.pause = () => {
        this.timingCallbacks?.pause?.();
        if (typeof controller.percent === 'number') {
          this.timingCallbacks?.setProgress?.(controller.percent);
        }
        this.callbacks.onPlayingChange?.(false);
        console.log(`${logPrefix} pause intercepted.`);
        return originalPause();
      };
    }

    const originalFinished = controller.finished?.bind(controller);
    if (originalFinished) {
      controller.finished = () => {
        const result = originalFinished();
        if (result === 'continue') {
          this.timingCallbacks?.setProgress?.(0);
          this.timingCallbacks?.start?.(0);
          this.callbacks.onPlayingChange?.(true);
          console.log(`${logPrefix} playback continued after finish.`);
        } else {
          this.timingCallbacks?.stop?.();
          this.callbacks.onPlayingChange?.(false);
          this.callbacks.onCurrentTimeChange?.(0);
          console.log(`${logPrefix} playback stopped after finish.`);
        }
        return result;
      };
    }

    const originalSeek = controller.seek?.bind(controller);
    if (originalSeek) {
      controller.seek = (percent: number, units?: number | string) => {
        this.timingCallbacks?.setProgress?.(percent, units);
        console.log(`${logPrefix} seek`, { percent, units });
        return originalSeek(percent, units);
      };
    }

    const originalRestart = controller.restart?.bind(controller);
    if (originalRestart) {
      controller.restart = () => {
        this.timingCallbacks?.setProgress?.(0);
        console.log(`${logPrefix} restart.`);
        return originalRestart();
      };
    }

    const originalSetWarp = controller.setWarp?.bind(controller);
    if (originalSetWarp) {
      controller.setWarp = (warp: number) =>
        originalSetWarp(warp).then((result) => {
          this.refreshTimingAfterTempoChange();
          console.log(`${logPrefix} warp set`, { warp });
          return result;
        });
    }
  }

  /**
   * Called when warp/speed changes.
   * Only updates the tempo conversion factor - the timeline is invariant and doesn't change.
   */
  private refreshTimingAfterTempoChange() {
    if (!this.visualObj || !this.synthControl || !this.timingCallbacks) {
      return;
    }

    try {
      // Update the timing callbacks with the PRECISE tempo (not rounded currentTempo).
      // The audio playback uses precise tempo internally, so we must match that
      // for proper synchronization when resuming or seeking.
      const preciseQpm = this.calculatePreciseQpm();
      if (preciseQpm !== undefined) {
        this.timingCallbacks.qpm = preciseQpm;
        console.log(`${logPrefix} Updated timingCallbacks.qpm`, {
          preciseQpm,
        });
      } else {
        // Do NOT fall back to rounded currentTempo - it causes sync drift.
        // If we can't calculate precise QPM, leave the existing qpm unchanged.
        console.warn(
          `${logPrefix} Could not calculate precise QPM; leaving timingCallbacks.qpm unchanged`
        );
      }

      // Re-sync the timing callbacks with current playback position
      this.timingCallbacks.replaceTarget?.(this.visualObj);

      if (typeof this.synthControl.percent === 'number') {
        const wasRunning = Boolean(this.synthControl.isStarted);
        const currentPercent = this.synthControl.percent;
        this.timingCallbacks.stop?.();
        this.timingCallbacks.setProgress?.(currentPercent);
        if (wasRunning) {
          this.timingCallbacks.start?.(currentPercent);
        }
      } else {
        this.timingCallbacks.stop?.();
      }

      // Only emit tempo change - timeline is invariant and doesn't need to be rebuilt
      this.emitTempoChange();
    } catch (error) {
      console.warn('Unable to refresh timing after tempo change', error);
    }
  }
}
