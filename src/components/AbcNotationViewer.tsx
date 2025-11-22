import { useAbcRenderer } from '../hooks/useAbcRenderer';
import {
  NoteCharTimeMap,
  NotePlaybackEvent,
  NoteTimeline,
} from '../types/music';

interface AbcNotationViewerProps {
  notation: string;
  containerId?: string;
  audioContainerId?: string;
  showAudioControls?: boolean;
  onCurrentTimeChange?: (time: number) => void;
  onPlayingChange?: (playing: boolean) => void;
  onNoteEvent?: (event: NotePlaybackEvent) => void;
  onCharTimeMapChange?: (map: NoteCharTimeMap) => void;
  onNoteTimelineChange?: (timeline: NoteTimeline | null) => void;
}

export const AbcNotationViewer = ({
  notation,
  containerId = 'abc-notation-container',
  audioContainerId,
  showAudioControls = true,
  onCurrentTimeChange,
  onPlayingChange,
  onNoteEvent,
  onCharTimeMapChange,
  onNoteTimelineChange,
}: AbcNotationViewerProps) => {
  const resolvedAudioContainerId =
    audioContainerId ||
    (showAudioControls ? `${containerId}-audio` : undefined);

  useAbcRenderer({
    notation,
    containerId,
    audioContainerId: resolvedAudioContainerId,
    onCurrentTimeChange,
    onPlayingChange,
    onNoteEvent,
    onCharTimeMapChange,
    onNoteTimelineChange,
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
