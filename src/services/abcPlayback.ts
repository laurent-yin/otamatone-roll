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
 * 3. **synthControl.currentTempo** - The ACTUAL current tempo in QPM (quarter
 *    notes per minute), INCLUDING warp adjustments. Use this to calculate the
 *    effective seconds-per-subdivision for playback synchronization.
 *
 * 4. **TimingCallbacks.noteTimings** - Contains timing data at the ORIGINAL
 *    tempo. The `milliseconds` values here are pre-computed at original tempo,
 *    not warped. But the `pitchInfo.start` and `pitchInfo.duration` values are
 *    in whole notes (invariant).
 *
 * KEY INSIGHT: The timeline (notes with startSubdivision/durationSubdivisions)
 * should be built once and is invariant. Only the tempo conversion factor
 * (secondsPerSubdivision) needs to change when warp changes.
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
  currentTempo?: number;
  percent?: number;
  isStarted?: boolean;
};

/**
 * Internal interface for TimingCallbacks instance with properties
 * used for playback synchronization.
 */
type TimingCallbacksInternal = {
  noteTimings?: TimingEvent[];
  replaceTarget?: (target: VisualObjWithTimings) => void;
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

  // Cached subdivision unit for tempo calculations (avoids rebuilding timeline on warp change)
  private cachedSubdivisionUnit: number = 4;

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

    // NOTE: event.milliseconds is the REAL elapsed time, AFFECTED by warp.
    // At 50% warp, a note at subdivision 2 will fire at ~2x the original milliseconds.
    // To convert back to subdivisions, divide by the CURRENT (warped) secondsPerSubdivision.
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

    // Cache the subdivision unit for tempo calculations (avoids rebuilding timeline on warp change)
    this.cachedSubdivisionUnit = derived.timeline.subdivisionUnit || 4;

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
      currentTempo: this.synthControl?.currentTempo,
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
   * Calculate effective seconds per subdivision based on current tempo.
   * Uses synthControl.currentTempo which includes warp adjustments.
   *
   * @param fallback - Fallback value if currentTempo is not available
   */
  private calculateEffectiveSecondsPerSubdivision(fallback: number): number {
    if (
      !this.synthControl ||
      typeof this.synthControl.currentTempo !== 'number' ||
      this.synthControl.currentTempo <= 0
    ) {
      return fallback;
    }

    // currentTempo is QPM - convert to seconds per quarter note, then to seconds per subdivision
    const secondsPerQuarterNote = 60 / this.synthControl.currentTempo;
    // subdivisionUnit is the meter denominator (4 for quarter notes, 8 for eighth notes)
    // For a quarter note (unit=4): secondsPerSubdivision = secondsPerQuarterNote
    // For an eighth note (unit=8): secondsPerSubdivision = secondsPerQuarterNote / 2
    return secondsPerQuarterNote * (4 / this.cachedSubdivisionUnit);
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
      currentTempo: this.synthControl?.currentTempo,
      subdivisionUnit: this.cachedSubdivisionUnit,
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
      // Update the timing callbacks with the new tempo
      if (typeof this.synthControl.currentTempo === 'number') {
        this.timingCallbacks.qpm = this.synthControl.currentTempo;
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
