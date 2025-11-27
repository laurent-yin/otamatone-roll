import abcjs from 'abcjs';
import {
  NoteCharTimeMap,
  NotePlaybackEvent,
  NoteTimeline,
} from '../types/music';
import {
  buildTimingDerivedData,
  TimingEvent,
  VisualObjWithTimings,
} from '../utils/abcTiming';

const isBrowser = () => typeof document !== 'undefined';
const logPrefix = '[AbcPlayback]';

export interface AbcPlaybackCallbacks {
  onCurrentTimeChange?: (currentTime: number) => void;
  onPlayingChange?: (isPlaying: boolean) => void;
  onNoteEvent?: (event: NotePlaybackEvent) => void;
  onCharTimeMapChange?: (map: NoteCharTimeMap) => void;
  onNoteTimelineChange?: (timeline: NoteTimeline | null) => void;
}

export interface AbcPlaybackConfig {
  notation: string;
  containerId: string;
  audioContainerId?: string;
  callbacks?: AbcPlaybackCallbacks;
}

type VisualObjWithAudioSupport = VisualObjWithTimings & {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  setUpAudio?: (options?: Record<string, any>) => unknown;
};

type SynthControllerLike = {
  load: (
    container: HTMLElement,
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    cursorControl?: any,
    options?: Record<string, unknown>
  ) => void;
  destroy?: () => void;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  setTune: (visualObj: any, userAction: boolean, options?: any) => void;
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

type TimingCallbacksWithEvents = {
  noteTimings?: TimingEvent[];
};

type TimingCallbacksInternal = TimingCallbacksWithEvents & {
  replaceTarget?: (target: VisualObjWithTimings) => void;
  qpm?: number;
  setProgress?: (percent: number, units?: number | string) => void;
  start?: (offsetPercent?: number) => void;
  stop?: () => void;
  pause?: () => void;
};

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

    const derived = buildTimingDerivedData(
      this.visualObj,
      timings as TimingEvent[],
      {
        secondsPerBeat: this.getSecondsPerBeat(),
      }
    );

    console.log(`${logPrefix} Derived timeline`, {
      notes: derived.timeline.notes.length,
      totalDuration: derived.timeline.totalDuration,
    });

    this.callbacks.onCharTimeMapChange?.(derived.charMap);

    if (derived.timeline.notes.length === 0) {
      console.warn(
        `${logPrefix} Derived timeline contained no notes; keeping fallback timeline.`
      );
      this.callbacks.onNoteTimelineChange?.(null);
    } else {
      this.callbacks.onNoteTimelineChange?.(derived.timeline);
    }
  }

  private getSecondsPerBeat(): number | undefined {
    if (!this.timingCallbacks) {
      return undefined;
    }

    const qpm = this.timingCallbacks.qpm;
    if (typeof qpm === 'number' && qpm > 0) {
      return 60 / qpm;
    }
    return undefined;
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

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const maybePromise = controller.setTune(
      this.visualObj as unknown as Record<string, any>,
      false,
      {
        timingCallbacks: this.timingCallbacks as unknown as Record<string, any>,
      }
    );
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

  private refreshTimingAfterTempoChange() {
    if (!this.visualObj || !this.synthControl || !this.timingCallbacks) {
      return;
    }

    try {
      if (typeof this.synthControl.currentTempo === 'number') {
        this.timingCallbacks.qpm = this.synthControl.currentTempo;
      }

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

      this.emitTimingDerivedData();
      console.log(`${logPrefix} Timing refreshed after tempo change.`);
    } catch (error) {
      console.warn('Unable to refresh timing after tempo change', error);
    }
  }
}
