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
import { OtamatoneRoll } from './OtamatoneRoll';
import {
  NoteCharTimeMap,
  NotePlaybackEvent,
  NoteTimeline,
} from '../types/music';

interface DockviewLayoutProps {
  notation: string;
  onNotationChange: (notation: string) => void;
  currentTime: number;
  isPlaying: boolean;
  audioContainerId?: string;
  onCurrentTimeChange: (time: number) => void;
  onPlayingChange: (playing: boolean) => void;
  onNoteEvent?: (event: NotePlaybackEvent) => void;
  activeNoteEvent?: NotePlaybackEvent | null;
  noteCharTimes?: NoteCharTimeMap;
  onCharTimeMapChange?: (map: NoteCharTimeMap) => void;
  noteTimeline?: NoteTimeline | null;
  onNoteTimelineChange?: (timeline: NoteTimeline | null) => void;
  lowestNoteHz?: number;
  highestNoteHz?: number;
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
    audioContainerId?: string;
    onCurrentTimeChange: (time: number) => void;
    onPlayingChange: (playing: boolean) => void;
    onNoteEvent?: (event: NotePlaybackEvent) => void;
    onCharTimeMapChange?: (map: NoteCharTimeMap) => void;
    onNoteTimelineChange?: (timeline: NoteTimeline | null) => void;
  }>
) => {
  const notation = props.params?.notation || '';
  const onCurrentTimeChange = props.params?.onCurrentTimeChange;
  const onPlayingChange = props.params?.onPlayingChange;
  const onNoteEvent = props.params?.onNoteEvent;
  const onCharTimeMapChange = props.params?.onCharTimeMapChange;
  const onNoteTimelineChange = props.params?.onNoteTimelineChange;
  const audioContainerId = props.params?.audioContainerId;
  const containerId = props.api?.id
    ? `abc-preview-${props.api.id}`
    : 'abc-preview-default';

  return (
    <div className="preview-panel">
      <AbcNotationViewer
        notation={notation}
        containerId={containerId}
        audioContainerId={audioContainerId}
        onCurrentTimeChange={onCurrentTimeChange}
        onPlayingChange={onPlayingChange}
        onNoteEvent={onNoteEvent}
        onCharTimeMapChange={onCharTimeMapChange}
        onNoteTimelineChange={onNoteTimelineChange}
      />
    </div>
  );
};

const OtamatoneRollPanel = (
  props: IDockviewPanelProps<{
    notation: string;
    currentTime: number;
    isPlaying: boolean;
    activeNoteEvent?: NotePlaybackEvent | null;
    noteCharTimes?: NoteCharTimeMap;
    noteTimeline?: NoteTimeline | null;
    lowestNoteHz?: number;
    highestNoteHz?: number;
  }>
) => {
  const notation = props.params?.notation || '';
  const currentTime = props.params?.currentTime || 0;
  const isPlaying = props.params?.isPlaying || false;
  const activeNoteEvent = props.params?.activeNoteEvent;
  const noteCharTimes = props.params?.noteCharTimes;
  const noteTimeline = props.params?.noteTimeline;
  const lowestNoteHz = props.params?.lowestNoteHz;
  const highestNoteHz = props.params?.highestNoteHz;

  return (
    <div className="otamatone-roll-panel">
      <OtamatoneRoll
        notation={notation}
        currentTime={currentTime}
        isPlaying={isPlaying}
        activeNoteEvent={activeNoteEvent}
        noteCharTimes={noteCharTimes}
        noteTimeline={noteTimeline}
        lowestNoteHz={lowestNoteHz}
        highestNoteHz={highestNoteHz}
      />
    </div>
  );
};

export const DockviewLayout = ({
  notation,
  onNotationChange,
  currentTime,
  isPlaying,
  audioContainerId,
  onCurrentTimeChange,
  onPlayingChange,
  onNoteEvent,
  activeNoteEvent,
  noteCharTimes,
  onCharTimeMapChange,
  noteTimeline,
  onNoteTimelineChange,
  lowestNoteHz,
  highestNoteHz,
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
      Math.min(
        TARGET_WIDTH,
        availableForEditor > 0 ? availableForEditor : TARGET_WIDTH
      )
    );

    editorPanelRef.current.group.api.setSize({ width });
  };

  useEffect(() => {
    if (!containerRef.current) return;

    const components = {
      editor: EditorPanel,
      preview: PreviewPanel,
      otamatoneRoll: OtamatoneRollPanel,
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
        onNoteEvent,
        onCharTimeMapChange,
        onNoteTimelineChange,
        audioContainerId,
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

    // Create otamatone roll panel
    dockviewInstance.addPanel({
      id: 'otamatone-roll-panel',
      component: 'otamatoneRoll',
      title: 'Otamatone Roll',
      position: { referencePanel: 'preview-panel', direction: 'below' },
      params: {
        notation,
        currentTime,
        isPlaying,
        activeNoteEvent,
        noteCharTimes,
        noteTimeline,
        lowestNoteHz,
        highestNoteHz,
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
    const otamatoneRollPanel = dockview.getPanel('otamatone-roll-panel');

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
        onNoteEvent,
        onCharTimeMapChange,
        onNoteTimelineChange,
        audioContainerId,
      });
    }

    if (otamatoneRollPanel) {
      otamatoneRollPanel.api.updateParameters({
        notation,
        currentTime,
        isPlaying,
        activeNoteEvent,
        noteCharTimes,
        noteTimeline,
        lowestNoteHz,
        highestNoteHz,
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
    onNoteEvent,
    activeNoteEvent,
    noteCharTimes,
    onCharTimeMapChange,
    noteTimeline,
    onNoteTimelineChange,
    audioContainerId,
    lowestNoteHz,
    highestNoteHz,
  ]);

  return <div ref={containerRef} className="dockview-container" />;
};
