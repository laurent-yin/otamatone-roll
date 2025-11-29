import { useAbcRenderer } from '../hooks/useAbcRenderer';

interface AbcNotationViewerProps {
  containerId?: string;
  audioContainerId?: string;
  showAudioControls?: boolean;
}

/**
 * Renders ABC notation from the store and manages playback.
 * All state is read/written through the Zustand store - no callback props needed.
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
