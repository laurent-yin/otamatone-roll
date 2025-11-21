import { useAbcRenderer } from '../hooks/useAbcRenderer';
import { NotePlaybackEvent } from '../types/music';
import { NoteCharTimeMap } from '../types/music';

interface AbcNotationViewerProps {
  notation: string;
  containerId?: string;
  showAudioControls?: boolean;
  onCurrentTimeChange?: (time: number) => void;
  onPlayingChange?: (playing: boolean) => void;
  onNoteEvent?: (event: NotePlaybackEvent) => void;
  onCharTimeMapChange?: (map: NoteCharTimeMap) => void;
}

export const AbcNotationViewer = ({
  notation,
  containerId = 'abc-notation-container',
  showAudioControls = true,
  onCurrentTimeChange,
  onPlayingChange,
  onNoteEvent,
  onCharTimeMapChange,
}: AbcNotationViewerProps) => {
  const audioContainerId = showAudioControls
    ? `${containerId}-audio`
    : undefined;

  useAbcRenderer({
    notation,
    containerId,
    audioContainerId,
    onCurrentTimeChange,
    onPlayingChange,
    onNoteEvent,
    onCharTimeMapChange,
  });

  return (
    <div className="abc-notation-viewer">
      {showAudioControls && (
        <div
          id={audioContainerId}
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
