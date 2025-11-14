import { useEffect, useRef } from 'react';
import abcjs from 'abcjs';

interface UseAbcRendererProps {
  notation: string;
  containerId: string;
}

export const useAbcRenderer = ({
  notation,
  containerId,
}: UseAbcRendererProps) => {
  const previousNotation = useRef<string>('');

  useEffect(() => {
    console.log('useAbcRenderer:', { notation, containerId });
    
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
      abcjs.renderAbc(containerId, notation);
      previousNotation.current = notation;
      console.log('ABC rendered successfully');
    } catch (error) {
      console.error('Error rendering ABC notation:', error);
    }
  }, [notation, containerId]);
};
