import { useEffect, useRef } from 'react';
import abcjs from 'abcjs';

interface UseAbcRendererProps {
  notation: string;
  containerId: string;
  audioContainerId?: string;
  onCurrentTimeChange?: (currentTime: number) => void;
  onPlayingChange?: (isPlaying: boolean) => void;
}

export const useAbcRenderer = ({
  notation,
  containerId,
  audioContainerId,
  onCurrentTimeChange,
  onPlayingChange,
}: UseAbcRendererProps) => {
  const previousNotation = useRef<string>('');
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const synthControlRef = useRef<any>(null);

  useEffect(() => {
    console.log('useAbcRenderer:', { notation, containerId, audioContainerId });

    // Only re-render if notation actually changed
    if (previousNotation.current === notation && notation !== '') return;

    const container = document.getElementById(containerId);
    if (!container) {
      console.error(`Container with id "${containerId}" not found`);
      return;
    }

    if (!notation || notation.trim() === '') {
      console.warn('Empty notation provided');
      return;
    }

    try {
      const visualObj = abcjs.renderAbc(containerId, notation, {
        responsive: 'resize',
      });
      previousNotation.current = notation;
      console.log('ABC rendered successfully');

      // Set up audio playback if audioContainerId is provided
      if (audioContainerId && visualObj && visualObj[0]) {
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
                console.log('eventCallback called:', event);
                if (event && typeof event.milliseconds === 'number') {
                  const currentTime = event.milliseconds / 1000;
                  console.log('Setting currentTime to:', currentTime);
                  onCurrentTimeChange?.(currentTime);
                }
              },
            }
          );

          // Set the tune with timing callbacks
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          synthControl.setTune(visualObj[0], false, { timingCallbacks } as any);

          // Start the timing callbacks when play button is clicked
          const playButton = audioContainer.querySelector(
            '.abcjs-midi-start'
          ) as HTMLElement;
          if (playButton) {
            playButton.addEventListener('click', () => {
              console.log('Play button clicked, starting timingCallbacks');
              timingCallbacks.start();
            });
          }

          const resetButton = audioContainer.querySelector(
            '.abcjs-midi-reset'
          ) as HTMLElement;
          if (resetButton) {
            resetButton.addEventListener('click', () => {
              console.log('Reset button clicked, stopping timingCallbacks');
              timingCallbacks.stop();
              onCurrentTimeChange?.(0);
            });
          }

          // Track playing state by checking the play button class
          if (onPlayingChange) {
            const checkPlayingState = setInterval(() => {
              const isPlaying =
                playButton?.classList.contains('abcjs-midi-playing') || false;
              onPlayingChange(isPlaying);
            }, 50);

            synthControlRef.current._stateInterval = checkPlayingState;
          }

          synthControlRef.current = synthControl;
          synthControlRef.current._timingCallbacks = timingCallbacks;

          console.log('Audio controls loaded successfully');
        }
      }
    } catch (error) {
      console.error('Error rendering ABC notation:', error);
    }

    return () => {
      // Clean up synth controller on unmount
      if (synthControlRef.current) {
        if (synthControlRef.current._stateInterval) {
          clearInterval(synthControlRef.current._stateInterval);
        }
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
  ]);
};
