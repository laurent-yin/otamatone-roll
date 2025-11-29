import { useEffect, useMemo, useRef } from 'react';
import {
  NoteCharTimeMap,
  NotePlaybackEvent,
  NoteTimeline,
} from '../types/music';
import {
  AbcPlaybackController,
  AbcPlaybackCallbacks,
} from '../services/abcPlayback';

interface UseAbcRendererProps {
  notation: string;
  containerId: string;
  audioContainerId?: string;
  onCurrentTimeChange?: (currentTime: number) => void;
  onPlayingChange?: (isPlaying: boolean) => void;
  onNoteEvent?: (event: NotePlaybackEvent) => void;
  onCharTimeMapChange?: (map: NoteCharTimeMap) => void;
  onNoteTimelineChange?: (timeline: NoteTimeline | null) => void;
  onSecondsPerBeatChange?: (secondsPerBeat: number) => void;
}

export const useAbcRenderer = ({
  notation,
  containerId,
  audioContainerId,
  onCurrentTimeChange,
  onPlayingChange,
  onNoteEvent,
  onCharTimeMapChange,
  onNoteTimelineChange,
  onSecondsPerBeatChange,
}: UseAbcRendererProps) => {
  const previousRenderKey = useRef<string>('');
  const controllerRef = useRef<AbcPlaybackController | null>(null);
  const latestCallbacksRef = useRef<AbcPlaybackCallbacks>({});
  const pendingFrameRef = useRef<number | null>(null);

  useEffect(() => {
    latestCallbacksRef.current = {
      onCurrentTimeChange,
      onPlayingChange,
      onNoteEvent,
      onCharTimeMapChange,
      onNoteTimelineChange,
      onSecondsPerBeatChange,
    };
  }, [
    onCurrentTimeChange,
    onPlayingChange,
    onNoteEvent,
    onCharTimeMapChange,
    onNoteTimelineChange,
    onSecondsPerBeatChange,
  ]);

  const callbackProxy = useMemo<AbcPlaybackCallbacks>(() => {
    return {
      onCurrentTimeChange: (value) =>
        latestCallbacksRef.current.onCurrentTimeChange?.(value),
      onPlayingChange: (value) =>
        latestCallbacksRef.current.onPlayingChange?.(value),
      onNoteEvent: (event) => latestCallbacksRef.current.onNoteEvent?.(event),
      onCharTimeMapChange: (map) =>
        latestCallbacksRef.current.onCharTimeMapChange?.(map),
      onNoteTimelineChange: (timeline) =>
        latestCallbacksRef.current.onNoteTimelineChange?.(timeline),
      onSecondsPerBeatChange: (secondsPerBeat) =>
        latestCallbacksRef.current.onSecondsPerBeatChange?.(secondsPerBeat),
    };
  }, []);

  useEffect(() => {
    const renderKey = `${containerId}::${audioContainerId ?? ''}::${notation}`;

    // Don't initialize until we have at least the timeline callback
    // This handles the case where dockview restores a panel before updateParameters is called
    if (!onNoteTimelineChange) {
      return;
    }

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
      latestCallbacksRef.current.onCharTimeMapChange?.({});
      latestCallbacksRef.current.onNoteTimelineChange?.(null);
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
  }, [
    notation,
    containerId,
    audioContainerId,
    callbackProxy,
    onNoteTimelineChange,
  ]);
};
