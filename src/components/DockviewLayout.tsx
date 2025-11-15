import { useEffect, useRef, useState } from 'react';
import { createRoot } from 'react-dom/client';
import {
  DockviewApi,
  DockviewComponent,
  IDockviewPanel,
  IDockviewPanelProps,
} from 'dockview-core';
import 'dockview-core/dist/styles/dockview.css';
import { AbcEditor } from './AbcEditor';
import { AbcNotationViewer } from './AbcNotationViewer';
import { PianoRoll } from './PianoRoll';

interface DockviewLayoutProps {
  notation: string;
  onNotationChange: (notation: string) => void;
  currentTime: number;
  isPlaying: boolean;
  onCurrentTimeChange: (time: number) => void;
  onPlayingChange: (playing: boolean) => void;
}

const EditorPanel = (
  props: IDockviewPanelProps<{
    notation: string;
    onChange: (value: string) => void;
  }>
) => {
  return (
    <AbcEditor value={props.params.notation} onChange={props.params.onChange} />
  );
};

const PreviewPanel = (
  props: IDockviewPanelProps<{
    notation: string;
    onCurrentTimeChange: (time: number) => void;
    onPlayingChange: (playing: boolean) => void;
  }>
) => {
  const notation = props.params?.notation || '';
  const onCurrentTimeChange = props.params?.onCurrentTimeChange;
  const onPlayingChange = props.params?.onPlayingChange;
  const containerId = props.api?.id
    ? `abc-preview-${props.api.id}`
    : 'abc-preview-default';

  return (
    <div className="preview-panel">
      <AbcNotationViewer
        notation={notation}
        containerId={containerId}
        onCurrentTimeChange={onCurrentTimeChange}
        onPlayingChange={onPlayingChange}
      />
    </div>
  );
};

const PianoRollPanel = (
  props: IDockviewPanelProps<{
    notation: string;
    currentTime: number;
    isPlaying: boolean;
  }>
) => {
  const notation = props.params?.notation || '';
  const currentTime = props.params?.currentTime || 0;
  const isPlaying = props.params?.isPlaying || false;

  return (
    <div className="piano-roll-panel">
      <PianoRoll
        notation={notation}
        currentTime={currentTime}
        isPlaying={isPlaying}
      />
    </div>
  );
};

export const DockviewLayout = ({
  notation,
  onNotationChange,
  currentTime,
  isPlaying,
  onCurrentTimeChange,
  onPlayingChange,
}: DockviewLayoutProps) => {
  const containerRef = useRef<HTMLDivElement>(null);
  const [dockview, setDockview] = useState<DockviewApi | null>(null);
  const editorPanelRef = useRef<IDockviewPanel | null>(null);
  const resizeObserverRef = useRef<ResizeObserver | null>(null);

  const enforceEditorWidth = () => {
    if (!containerRef.current || !editorPanelRef.current) {
      return;
    }

    const containerWidth = containerRef.current.clientWidth;
    const TARGET_WIDTH = 260;
    const MIN_WIDTH = 180;
    const MIN_RIGHT_SPACE = 420;

    const availableForEditor = containerWidth - MIN_RIGHT_SPACE;
    const width = Math.max(
      MIN_WIDTH,
      Math.min(TARGET_WIDTH, availableForEditor > 0 ? availableForEditor : TARGET_WIDTH)
    );

    editorPanelRef.current.group.api.setSize({ width });
  };

  useEffect(() => {
    if (!containerRef.current) return;

    const components = {
      editor: EditorPanel,
      preview: PreviewPanel,
      pianoRoll: PianoRollPanel,
    };

    const dockviewInstance = new DockviewComponent(containerRef.current, {
      createComponent: (options) => {
        const element = document.createElement('div');
        element.style.height = '100%';
        element.style.overflow = 'hidden';

        const Component = components[options.name as keyof typeof components];
        if (!Component) {
          throw new Error(`Component ${options.name} not found`);
        }

        const root = createRoot(element);

        return {
          element,
          init: (parameters) => {
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            root.render(<Component {...(parameters as any)} />);
          },
          update: (parameters) => {
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            root.render(<Component {...(parameters as any)} />);
          },
          dispose: () => {
            root.unmount();
          },
        };
      },
      className: 'dockview-theme-replit',
    });

    setDockview(dockviewInstance.api);

    // Create preview panel (right side)
    dockviewInstance.addPanel({
      id: 'preview-panel',
      component: 'preview',
      title: 'Preview',
      params: {
        notation,
        onCurrentTimeChange,
        onPlayingChange,
      },
      initialWidth: 700,
    });

    // Create editor panel (left side) with explicit width
    const editorPanel = dockviewInstance.addPanel({
      id: 'editor-panel',
      component: 'editor',
      title: 'Editor',
      position: {
        referencePanel: 'preview-panel',
        direction: 'left',
      },
      params: {
        notation,
        onChange: onNotationChange,
      },
      initialWidth: 280,
    });
    editorPanelRef.current = editorPanel;

    // Create piano roll panel
    dockviewInstance.addPanel({
      id: 'piano-roll-panel',
      component: 'pianoRoll',
      title: 'Piano Roll',
      position: { referencePanel: 'preview-panel', direction: 'below' },
      params: {
        notation,
        currentTime,
        isPlaying,
      },
      initialWidth: 500,
    });

    requestAnimationFrame(enforceEditorWidth);

    const resizeObserver = new ResizeObserver(() => {
      enforceEditorWidth();
    });
    resizeObserver.observe(containerRef.current);
    resizeObserverRef.current = resizeObserver;

    return () => {
      resizeObserverRef.current?.disconnect();
      resizeObserverRef.current = null;
      dockviewInstance.dispose();
      editorPanelRef.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []); // Only run once on mount

  // Update panel params when notation changes
  useEffect(() => {
    if (!dockview) return;

    const editorPanel = dockview.getPanel('editor-panel');
    const previewPanel = dockview.getPanel('preview-panel');
    const pianoRollPanel = dockview.getPanel('piano-roll-panel');

    if (editorPanel) {
      editorPanel.api.updateParameters({
        notation,
        onChange: onNotationChange,
      });
    }

    if (previewPanel) {
      previewPanel.api.updateParameters({
        notation,
        onCurrentTimeChange,
        onPlayingChange,
      });
    }

    if (pianoRollPanel) {
      pianoRollPanel.api.updateParameters({
        notation,
        currentTime,
        isPlaying,
      });
    }
  }, [
    dockview,
    notation,
    onNotationChange,
    currentTime,
    isPlaying,
    onCurrentTimeChange,
    onPlayingChange,
  ]);

  return <div ref={containerRef} className="dockview-container" />;
};
