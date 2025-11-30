import { useAbcRenderer } from '../hooks/useAbcRenderer';

interface AbcNotationViewerProps {
  containerId?: string;
  audioContainerId?: string;
  showAudioControls?: boolean;
}

/**
 * Sheet music renderer component using abcjs.
 * Reads ABC notation from the Zustand store and renders it as SVG.
 * Optionally displays audio playback controls.
 *
 * All playback state (currentTime, isPlaying, noteTimeline) is synced
 * back to the Zustand store via the useAbcRenderer hook.
 *
 * @param props - Component props
 * @param props.containerId - DOM element ID for the notation SVG (default: "abc-notation-container")
 * @param props.audioContainerId - External DOM element ID for audio controls (optional)
 * @param props.showAudioControls - Whether to render audio controls (default: true)
 *
 * @example
 * // With external audio controls:
 * <AbcNotationViewer containerId="sheet" audioContainerId="audio" />
 *
 * // With built-in audio controls:
 * <AbcNotationViewer containerId="sheet" showAudioControls />
 */
export const AbcNotationViewer = ({
  containerId = 'abc-notation-container',
  audioContainerId,
  showAudioControls = true,
}: AbcNotationViewerProps) => {
  const resolvedAudioContainerId =
    audioContainerId ||
    (showAudioControls ? `${containerId}-audio` : undefined);

  useAbcRenderer({
    containerId,
    audioContainerId: resolvedAudioContainerId,
  });

  return (
    <div className="abc-notation-viewer">
      {showAudioControls && !audioContainerId && (
        <div
          id={resolvedAudioContainerId}
          className="abc-audio-controls"
          aria-label="Audio playback controls"
        />
      )}
      <div
        id={containerId}
        role="img"
        aria-label="Musical notation rendered from ABC notation"
        className="abc-notation-display"
      />
    </div>
  );
};
