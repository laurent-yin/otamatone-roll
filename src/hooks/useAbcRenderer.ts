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
  const hasRendered = useRef(false);

  useEffect(() => {
    if (hasRendered.current) return;

    const container = document.getElementById(containerId);
    if (!container) {
      console.error(`Container with id "${containerId}" not found`);
      return;
    }

    try {
      abcjs.renderAbc(containerId, notation);
      hasRendered.current = true;
    } catch (error) {
      console.error('Error rendering ABC notation:', error);
    }
  }, [notation, containerId]);
};
