import { useEffect, useRef } from 'react';
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

interface UseAbcRendererProps {
  notation: string;
  containerId: string;
  audioContainerId?: string;
  onCurrentTimeChange?: (currentTime: number) => void;
  onPlayingChange?: (isPlaying: boolean) => void;
  onNoteEvent?: (event: NotePlaybackEvent) => void;
  onCharTimeMapChange?: (map: NoteCharTimeMap) => void;
  onNoteTimelineChange?: (timeline: NoteTimeline | null) => void;
}

type TimingCallbacksWithEvents = {
  noteTimings?: TimingEvent[];
};

type VisualObjWithAudioSupport = {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  setUpAudio?: (options?: Record<string, any>) => unknown;
};

export const useAbcRenderer = ({
  notation,
  containerId,
  audioContainerId,
  onCurrentTimeChange,
  onPlayingChange,
  onNoteEvent,
  onCharTimeMapChange,
  onNoteTimelineChange,
}: UseAbcRendererProps) => {
  const previousNotation = useRef<string>('');
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const synthControlRef = useRef<any>(null);
  const eventSequenceRef = useRef(0);

  useEffect(() => {
    console.log('useAbcRenderer:', { notation, containerId, audioContainerId });

    // Only re-render if notation actually changed
    if (previousNotation.current === notation && notation !== '') return;

    eventSequenceRef.current = 0;

    const resetDerivedData = () => {
      onCharTimeMapChange?.({});
      onNoteTimelineChange?.(null);
    };

    const container = document.getElementById(containerId);
    if (!container) {
      console.error(`Container with id "${containerId}" not found`);
      resetDerivedData();
      return;
    }

    if (!notation || notation.trim() === '') {
      console.warn('Empty notation provided');
      resetDerivedData();
      return;
    }

    resetDerivedData();

    try {
      const visualObj = abcjs.renderAbc(containerId, notation, {
        responsive: 'resize',
      });
      previousNotation.current = notation;
      console.log('ABC rendered successfully');

      // Set up audio playback if audioContainerId is provided
      if (audioContainerId && visualObj && visualObj[0]) {
        const visualObjWithAudio = visualObj[0] as VisualObjWithAudioSupport;
        if (typeof visualObjWithAudio.setUpAudio === 'function') {
          try {
            visualObjWithAudio.setUpAudio();
          } catch (audioPrepError) {
            console.warn(
              'abcjs setUpAudio failed; timing data may be incomplete',
              audioPrepError
            );
          }
        }

        const audioContainer = document.getElementById(audioContainerId);
        if (audioContainer) {
          // Clean up previous synth controller
          if (synthControlRef.current) {
            synthControlRef.current.destroy();
          }

          // Create new synth controller
          const synthControl = new abcjs.synth.SynthController();
          synthControl.load(audioContainer, null, {
            displayLoop: true,
            displayRestart: true,
            displayPlay: true,
            displayProgress: true,
            displayWarp: true,
          });

          // Create TimingCallbacks for accurate playback synchronization
          console.log('Creating TimingCallbacks');
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          const timingCallbacks = new (abcjs.TimingCallbacks as any)(
            visualObj[0],
            {
              // eslint-disable-next-line @typescript-eslint/no-explicit-any
              eventCallback: (event: any) => {
                console.log('abcjs timing event', {
                  ms: event?.milliseconds,
                  startChar: event?.startChar,
                  startCharArray: event?.startCharArray,
                  midiPitches: event?.midiPitches,
                  duration: event?.duration,
                });
                if (event && typeof event.milliseconds === 'number') {
                  const currentTime = event.milliseconds / 1000;
                  console.log('Setting currentTime to:', currentTime);
                  onCurrentTimeChange?.(currentTime);

                  if (onNoteEvent && Array.isArray(event.midiPitches)) {
                    const midiPitches = event.midiPitches
                      .map((pitch: unknown) => {
                        if (typeof pitch === 'number') {
                          return pitch;
                        }
                        if (
                          pitch &&
                          typeof pitch === 'object' &&
                          typeof (pitch as { pitch?: number }).pitch ===
                            'number'
                        ) {
                          return (pitch as { pitch: number }).pitch;
                        }
                        if (
                          pitch &&
                          typeof pitch === 'object' &&
                          typeof (pitch as { midi?: number }).midi === 'number'
                        ) {
                          return (pitch as { midi: number }).midi;
                        }
                        return undefined;
                      })
                      .filter(
                        (value: number | undefined): value is number =>
                          typeof value === 'number'
                      );

                    if (midiPitches.length > 0) {
                      eventSequenceRef.current += 1;
                      const normalizedEvent: NotePlaybackEvent = {
                        sequenceId: eventSequenceRef.current,
                        timeSeconds: currentTime,
                        durationSeconds:
                          typeof event.duration === 'number'
                            ? event.duration / 1000
                            : undefined,
                        midiPitches,
                        startChar:
                          typeof event.startChar === 'number'
                            ? event.startChar
                            : undefined,
                        endChar:
                          typeof event.endChar === 'number'
                            ? event.endChar
                            : undefined,
                      };
                      onNoteEvent(normalizedEvent);
                    }
                  }
                }
              },
            }
          );

          const syncTimingWithSeek = () => {
            const controller = synthControl as unknown as {
              seek?: (percent: number, units?: number | string) => void;
              restart?: () => void;
            };

            const originalSeek =
              typeof controller.seek === 'function'
                ? controller.seek.bind(synthControl)
                : null;
            if (originalSeek) {
              controller.seek = (percent: number, units?: number | string) => {
                console.log('[TimingState] syncing seek', { percent, units });
                timingCallbacks.setProgress(percent, units);
                return originalSeek(percent, units);
              };
            }

            const originalRestart =
              typeof controller.restart === 'function'
                ? controller.restart.bind(synthControl)
                : null;
            if (originalRestart) {
              controller.restart = () => {
                console.log('[TimingState] syncing restart');
                timingCallbacks.setProgress(0);
                return originalRestart();
              };
            }
          };

          const syncTimingWithPlayback = () => {
            const controller = synthControl as unknown as {
              _play?: () => Promise<unknown>;
              pause?: () => void;
              finished?: () => void | string;
              isStarted?: boolean;
              percent?: number;
            };

            const originalPlay =
              typeof controller._play === 'function'
                ? controller._play.bind(synthControl)
                : null;
            if (originalPlay) {
              controller._play = () =>
                originalPlay().then((result) => {
                  const isPlaying = Boolean(controller.isStarted);
                  console.log('[TimingState] _play resolved', { isPlaying });
                  if (isPlaying) {
                    const offset =
                      typeof controller.percent === 'number'
                        ? controller.percent
                        : undefined;
                    timingCallbacks.start(offset);
                  } else {
                    timingCallbacks.pause();
                  }
                  onPlayingChange?.(isPlaying);
                  return result;
                });
            }

            const originalPause =
              typeof controller.pause === 'function'
                ? controller.pause.bind(synthControl)
                : null;
            if (originalPause) {
              controller.pause = () => {
                console.log('[TimingState] pause intercepted');
                timingCallbacks.pause();
                onPlayingChange?.(false);
                return originalPause();
              };
            }

            const originalFinished =
              typeof controller.finished === 'function'
                ? controller.finished.bind(synthControl)
                : null;
            if (originalFinished) {
              controller.finished = () => {
                console.log('[TimingState] finished intercepted');
                const result = originalFinished();
                if (result === 'continue') {
                  timingCallbacks.setProgress(0);
                  timingCallbacks.start(0);
                  onPlayingChange?.(true);
                } else {
                  timingCallbacks.stop();
                  onPlayingChange?.(false);
                  onCurrentTimeChange?.(0);
                }
                return result;
              };
            }
          };

          syncTimingWithSeek();
          syncTimingWithPlayback();

          const emitTimingDerivedData = () => {
            const tuneWithTimings = visualObj[0] as VisualObjWithTimings;
            const callbacksWithEvents =
              timingCallbacks as TimingCallbacksWithEvents;
            const timings = callbacksWithEvents.noteTimings;
            if (!Array.isArray(timings) || timings.length === 0) {
              resetDerivedData();
              return;
            }

            const derived = buildTimingDerivedData(
              tuneWithTimings,
              timings as TimingEvent[]
            );
            console.log('[TimingDerived] timeline stats', {
              events: timings.length,
              notes: derived.timeline.notes.length,
              totalDuration: derived.timeline.totalDuration,
            });
            onCharTimeMapChange?.(derived.charMap);
            onNoteTimelineChange?.(derived.timeline);
          };

          emitTimingDerivedData();

          // Set the tune with timing callbacks
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          synthControl.setTune(visualObj[0], false, { timingCallbacks } as any);

          const resetButton = audioContainer.querySelector(
            '.abcjs-midi-reset'
          ) as HTMLElement;
          if (resetButton) {
            resetButton.addEventListener('click', () => {
              console.log('Reset button clicked, stopping timingCallbacks');
              timingCallbacks.stop();
              timingCallbacks.setProgress(0);
              onCurrentTimeChange?.(0);
              onPlayingChange?.(false);
            });
          }

          synthControlRef.current = synthControl;
          synthControlRef.current._timingCallbacks = timingCallbacks;

          console.log('Audio controls loaded successfully');
        }
      }
    } catch (error) {
      console.error('Error rendering ABC notation:', error);
      onCharTimeMapChange?.({});
    }

    return () => {
      // Clean up synth controller on unmount
      if (synthControlRef.current) {
        if (synthControlRef.current._timingCallbacks) {
          synthControlRef.current._timingCallbacks.stop();
        }
        synthControlRef.current.destroy();
        synthControlRef.current = null;
      }
    };
  }, [
    notation,
    containerId,
    audioContainerId,
    onCurrentTimeChange,
    onPlayingChange,
    onNoteEvent,
    onCharTimeMapChange,
    onNoteTimelineChange,
  ]);
};
