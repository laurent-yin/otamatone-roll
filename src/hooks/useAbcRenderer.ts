import { useEffect, useRef } from 'react';
import abcjs from 'abcjs';

interface UseAbcRendererProps {
  notation: string;
  containerId: string;
  audioContainerId?: string;
}

export const useAbcRenderer = ({
  notation,
  containerId,
  audioContainerId,
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
          synthControl.setTune(visualObj[0], false);
          synthControlRef.current = synthControl;
          console.log('Audio controls loaded successfully');
        }
      }
    } catch (error) {
      console.error('Error rendering ABC notation:', error);
    }

    return () => {
      // Clean up synth controller on unmount
      if (synthControlRef.current) {
        synthControlRef.current.destroy();
        synthControlRef.current = null;
      }
    };
  }, [notation, containerId, audioContainerId]);
};
