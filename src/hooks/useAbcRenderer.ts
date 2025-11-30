import { useEffect, useRef } from 'react';
import { useAppStore } from '../store/appStore';
import {
  AbcPlaybackController,
  AbcPlaybackCallbacks,
} from '../services/abcPlayback';

interface UseAbcRendererProps {
  containerId: string;
  audioContainerId?: string;
}

/**
 * Hook that renders ABC notation and manages audio playback.
 * Reads notation from the Zustand store and writes playback state back.
 *
 * This hook:
 * - Creates an AbcPlaybackController when notation changes
 * - Renders sheet music to the specified container
 * - Sets up audio controls if audioContainerId is provided
 * - Syncs timing events (currentTime, isPlaying, noteTimeline) to the store
 *
 * @param props - Hook configuration
 * @param props.containerId - DOM element ID where notation will be rendered
 * @param props.audioContainerId - DOM element ID for audio controls (optional)
 *
 * @example
 * const MyComponent = () => {
 *   useAbcRenderer({
 *     containerId: 'sheet-music',
 *     audioContainerId: 'audio-controls',
 *   });
 *   return <div id="sheet-music" />;
 * };
 */
export const useAbcRenderer = ({
  containerId,
  audioContainerId,
}: UseAbcRendererProps) => {
  const previousRenderKey = useRef<string>('');
  const controllerRef = useRef<AbcPlaybackController | null>(null);
  const pendingFrameRef = useRef<number | null>(null);

  // Get state and setters from store
  const notation = useAppStore((state) => state.notation);
  const setCurrentTime = useAppStore((state) => state.setCurrentTime);
  const setIsPlaying = useAppStore((state) => state.setIsPlaying);
  const setActiveNoteEvent = useAppStore((state) => state.setActiveNoteEvent);
  const setNoteCharTimes = useAppStore((state) => state.setNoteCharTimes);
  const setNoteTimeline = useAppStore((state) => state.setNoteTimeline);
  const setCurrentSecondsPerBeat = useAppStore(
    (state) => state.setCurrentSecondsPerBeat
  );

  // Create stable callbacks object using refs to avoid re-creating controller
  const callbacksRef = useRef<AbcPlaybackCallbacks>({});

  // Keep callbacks up to date
  useEffect(() => {
    callbacksRef.current = {
      onCurrentTimeChange: setCurrentTime,
      onPlayingChange: setIsPlaying,
      onNoteEvent: setActiveNoteEvent,
      onCharTimeMapChange: setNoteCharTimes,
      onNoteTimelineChange: setNoteTimeline,
      onSecondsPerBeatChange: setCurrentSecondsPerBeat,
    };
  }, [
    setCurrentTime,
    setIsPlaying,
    setActiveNoteEvent,
    setNoteCharTimes,
    setNoteTimeline,
    setCurrentSecondsPerBeat,
  ]);

  // Create a proxy that always calls the latest callbacks
  const callbackProxy: AbcPlaybackCallbacks = {
    onCurrentTimeChange: (value) =>
      callbacksRef.current.onCurrentTimeChange?.(value),
    onPlayingChange: (value) => callbacksRef.current.onPlayingChange?.(value),
    onNoteEvent: (event) => callbacksRef.current.onNoteEvent?.(event),
    onCharTimeMapChange: (map) =>
      callbacksRef.current.onCharTimeMapChange?.(map),
    onNoteTimelineChange: (timeline) =>
      callbacksRef.current.onNoteTimelineChange?.(timeline),
    onSecondsPerBeatChange: (secondsPerBeat) =>
      callbacksRef.current.onSecondsPerBeatChange?.(secondsPerBeat),
  };

  useEffect(() => {
    const renderKey = `${containerId}::${audioContainerId ?? ''}::${notation}`;

    if (
      controllerRef.current &&
      previousRenderKey.current === renderKey &&
      notation !== ''
    ) {
      return;
    }

    previousRenderKey.current = renderKey;

    controllerRef.current?.dispose();
    controllerRef.current = null;

    const resetDerivedData = () => {
      setNoteCharTimes({});
      setNoteTimeline(null);
    };

    if (!notation || notation.trim() === '') {
      console.warn('[useAbcRenderer] Empty notation; clearing state');
      resetDerivedData();
      return;
    }

    resetDerivedData();

    let cancelled = false;

    if (typeof document === 'undefined') {
      console.warn('[useAbcRenderer] document is undefined; skipping render');
      return () => {
        cancelled = true;
      };
    }

    const scheduleRetry = (callback: () => void) => {
      if (typeof window !== 'undefined' && window.requestAnimationFrame) {
        pendingFrameRef.current = window.requestAnimationFrame(callback);
      } else {
        pendingFrameRef.current = window.setTimeout(callback, 16);
      }
    };

    const attemptInitialization = () => {
      if (cancelled) {
        return;
      }
      if (!controllerRef.current) {
        const container = document.getElementById(containerId);
        if (!container) {
          scheduleRetry(attemptInitialization);
          return;
        }
        try {
          controllerRef.current = new AbcPlaybackController({
            notation,
            containerId,
            audioContainerId,
            callbacks: callbackProxy,
          });
          console.log('[useAbcRenderer] Controller created.');
        } catch (error) {
          console.error('Failed to initialize ABC playback controller', error);
          resetDerivedData();
        }
      }
    };

    attemptInitialization();

    return () => {
      cancelled = true;
      if (pendingFrameRef.current !== null) {
        cancelAnimationFrame(pendingFrameRef.current);
        pendingFrameRef.current = null;
      }
      if (pendingFrameRef.current !== null) {
        if (typeof window !== 'undefined' && window.cancelAnimationFrame) {
          window.cancelAnimationFrame(pendingFrameRef.current);
        } else {
          clearTimeout(pendingFrameRef.current);
        }
        pendingFrameRef.current = null;
      }
      controllerRef.current?.dispose();
      controllerRef.current = null;
    };
    // Note: callbackProxy is stable (uses refs internally), so we don't need it in deps
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [
    notation,
    containerId,
    audioContainerId,
    setNoteCharTimes,
    setNoteTimeline,
  ]);
};
