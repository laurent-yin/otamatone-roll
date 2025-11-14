import { useAbcRenderer } from '../hooks/useAbcRenderer';

interface AbcNotationViewerProps {
  notation: string;
  containerId?: string;
}

export const AbcNotationViewer = ({
  notation,
  containerId = 'abc-notation-container',
}: AbcNotationViewerProps) => {
  useAbcRenderer({ notation, containerId });

  return (
    <div
      id={containerId}
      role="img"
      aria-label="Musical notation rendered from ABC notation"
      className="abc-notation-viewer"
    />
  );
};
