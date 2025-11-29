import { useCallback, useEffect, useRef, useState } from 'react';
import {
  DockviewApi,
  DockviewReact,
  DockviewReadyEvent,
  DockviewDefaultTab,
  IDockviewPanelProps,
  IDockviewPanelHeaderProps,
  SerializedDockview,
} from 'dockview';
import 'dockview/dist/styles/dockview.css';
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
  /** Current playback tempo - may change with warp/speed controls */
  currentSecondsPerBeat?: number;
  onSecondsPerBeatChange?: (secondsPerBeat: number) => void;
  lowestNoteHz?: number;
  highestNoteHz?: number;
}

const DOCKVIEW_LAYOUT_STORAGE_KEY = 'or-dockview-layout';
const PANEL_VISIBILITY_STORAGE_KEY = 'or-panel-visibility';
const isBrowser = () => typeof window !== 'undefined' && !!window.localStorage;

interface PanelVisibility {
  editor: boolean;
  preview: boolean;
  otamatoneRoll: boolean;
}

const DEFAULT_PANEL_VISIBILITY: PanelVisibility = {
  editor: true,
  preview: true,
  otamatoneRoll: true,
};

const readStoredPanelVisibility = (): PanelVisibility => {
  if (!isBrowser()) {
    return DEFAULT_PANEL_VISIBILITY;
  }
  try {
    const raw = window.localStorage.getItem(PANEL_VISIBILITY_STORAGE_KEY);
    if (!raw) {
      return DEFAULT_PANEL_VISIBILITY;
    }
    return { ...DEFAULT_PANEL_VISIBILITY, ...JSON.parse(raw) };
  } catch (error) {
    console.warn('Unable to read panel visibility from localStorage', error);
    return DEFAULT_PANEL_VISIBILITY;
  }
};

const persistPanelVisibility = (visibility: PanelVisibility) => {
  if (!isBrowser()) {
    return;
  }
  try {
    window.localStorage.setItem(
      PANEL_VISIBILITY_STORAGE_KEY,
      JSON.stringify(visibility)
    );
  } catch (error) {
    console.warn('Unable to persist panel visibility', error);
  }
};

interface ViewMenuProps {
  visibility: PanelVisibility;
  onToggle: (panel: keyof PanelVisibility) => void;
}

const ViewMenu = ({ visibility, onToggle }: ViewMenuProps) => {
  const [isOpen, setIsOpen] = useState(false);
  const menuRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(event.target as Node)) {
        setIsOpen(false);
      }
    };

    if (isOpen) {
      document.addEventListener('mousedown', handleClickOutside);
    }

    return () => {
      document.removeEventListener('mousedown', handleClickOutside);
    };
  }, [isOpen]);

  return (
    <div className="view-menu" ref={menuRef}>
      <button
        className="view-menu-trigger"
        onClick={() => setIsOpen(!isOpen)}
        aria-label="View settings"
        aria-expanded={isOpen}
        aria-haspopup="menu"
      >
        <svg
          width="20"
          height="20"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="2"
          strokeLinecap="round"
          strokeLinejoin="round"
        >
          <circle cx="12" cy="12" r="3" />
          <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1 0 2.83 2 2 0 0 1-2.83 0l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-2 2 2 2 0 0 1-2-2v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83 0 2 2 0 0 1 0-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1-2-2 2 2 0 0 1 2-2h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 0-2.83 2 2 0 0 1 2.83 0l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 2-2 2 2 0 0 1 2 2v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 0 2 2 0 0 1 0 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 2 2 2 2 0 0 1-2 2h-.09a1.65 1.65 0 0 0-1.51 1z" />
        </svg>
      </button>
      {isOpen && (
        <div className="view-menu-dropdown" role="menu">
          <div className="view-menu-header">View</div>
          <button
            className="view-menu-item"
            role="menuitemcheckbox"
            aria-checked={visibility.editor}
            onClick={() => onToggle('editor')}
          >
            <span className="view-menu-checkbox">
              {visibility.editor && (
                <svg
                  width="14"
                  height="14"
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="3"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                >
                  <polyline points="20 6 9 17 4 12" />
                </svg>
              )}
            </span>
            <span>Editor</span>
          </button>
          <button
            className="view-menu-item"
            role="menuitemcheckbox"
            aria-checked={visibility.preview}
            onClick={() => onToggle('preview')}
          >
            <span className="view-menu-checkbox">
              {visibility.preview && (
                <svg
                  width="14"
                  height="14"
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="3"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                >
                  <polyline points="20 6 9 17 4 12" />
                </svg>
              )}
            </span>
            <span>Preview</span>
          </button>
          <button
            className="view-menu-item"
            role="menuitemcheckbox"
            aria-checked={visibility.otamatoneRoll}
            onClick={() => onToggle('otamatoneRoll')}
          >
            <span className="view-menu-checkbox">
              {visibility.otamatoneRoll && (
                <svg
                  width="14"
                  height="14"
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="3"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                >
                  <polyline points="20 6 9 17 4 12" />
                </svg>
              )}
            </span>
            <span>Otamatone Roll</span>
          </button>
        </div>
      )}
    </div>
  );
};

const readStoredLayout = (): SerializedDockview | undefined => {
  if (!isBrowser()) {
    return undefined;
  }
  try {
    const raw = window.localStorage.getItem(DOCKVIEW_LAYOUT_STORAGE_KEY);
    if (!raw) {
      return undefined;
    }
    return JSON.parse(raw) as SerializedDockview;
  } catch (error) {
    console.warn('Unable to read dockview layout from localStorage', error);
    return undefined;
  }
};

const persistLayout = (api: DockviewApi) => {
  if (!isBrowser()) {
    return;
  }
  try {
    const serialized = api.toJSON();
    window.localStorage.setItem(
      DOCKVIEW_LAYOUT_STORAGE_KEY,
      JSON.stringify(serialized)
    );
  } catch (error) {
    console.warn('Unable to persist dockview layout', error);
  }
};

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
    onSecondsPerBeatChange?: (secondsPerBeat: number) => void;
  }>
) => {
  const notation = props.params?.notation || '';
  const onCurrentTimeChange = props.params?.onCurrentTimeChange;
  const onPlayingChange = props.params?.onPlayingChange;
  const onNoteEvent = props.params?.onNoteEvent;
  const onCharTimeMapChange = props.params?.onCharTimeMapChange;
  const onNoteTimelineChange = props.params?.onNoteTimelineChange;
  const onSecondsPerBeatChange = props.params?.onSecondsPerBeatChange;
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
        onSecondsPerBeatChange={onSecondsPerBeatChange}
      />
    </div>
  );
};

const OtamatoneRollPanel = (
  props: IDockviewPanelProps<{
    currentTime: number;
    isPlaying: boolean;
    activeNoteEvent?: NotePlaybackEvent | null;
    noteCharTimes?: NoteCharTimeMap;
    currentSecondsPerBeat?: number;
    noteTimeline?: NoteTimeline | null;
    baselineSecondsPerBeat?: number;
    lowestNoteHz?: number;
    highestNoteHz?: number;
  }>
) => {
  const currentTime = props.params?.currentTime || 0;
  const isPlaying = props.params?.isPlaying || false;
  const activeNoteEvent = props.params?.activeNoteEvent;
  const noteCharTimes = props.params?.noteCharTimes;
  const currentSecondsPerBeat = props.params?.currentSecondsPerBeat;
  const noteTimeline = props.params?.noteTimeline;
  const baselineSecondsPerBeat = props.params?.baselineSecondsPerBeat;
  const lowestNoteHz = props.params?.lowestNoteHz;
  const highestNoteHz = props.params?.highestNoteHz;

  return (
    <div className="otamatone-roll-panel">
      <OtamatoneRoll
        currentTime={currentTime}
        isPlaying={isPlaying}
        activeNoteEvent={activeNoteEvent}
        noteCharTimes={noteCharTimes}
        currentSecondsPerBeat={currentSecondsPerBeat}
        noteTimeline={noteTimeline}
        baselineSecondsPerBeat={baselineSecondsPerBeat}
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
  currentSecondsPerBeat,
  onSecondsPerBeatChange,
  lowestNoteHz,
  highestNoteHz,
}: DockviewLayoutProps) => {
  const [dockview, setDockview] = useState<DockviewApi | null>(null);
  const [panelVisibility, setPanelVisibility] = useState<PanelVisibility>(
    readStoredPanelVisibility
  );
  // Use a ref to store the close handler so the tab component always has the latest version
  const closePanelRef = useRef<(panelId: string) => void>(() => {});

  const togglePanelVisibility = useCallback((panel: keyof PanelVisibility) => {
    setPanelVisibility((prev) => {
      const newVisibility = { ...prev, [panel]: !prev[panel] };
      persistPanelVisibility(newVisibility);
      return newVisibility;
    });
  }, []);

  // Handle close button click - hide panel instead of removing it
  const handleClosePanel = useCallback(
    (panelId: string) => {
      const panelIdMap: Record<string, keyof PanelVisibility> = {
        'editor-panel': 'editor',
        'preview-panel': 'preview',
        'otamatone-roll-panel': 'otamatoneRoll',
      };
      const panelKey = panelIdMap[panelId];
      if (panelKey && dockview) {
        const panel = dockview.getPanel(panelId);
        if (panel) {
          // Hide the panel's group instead of removing it
          panel.group.api.setVisible(false);
          // Update visibility state
          setPanelVisibility((prev) => {
            const newVisibility = { ...prev, [panelKey]: false };
            persistPanelVisibility(newVisibility);
            return newVisibility;
          });
        }
      }
    },
    [dockview]
  );

  // Keep the ref updated with the latest handler
  useEffect(() => {
    closePanelRef.current = handleClosePanel;
  }, [handleClosePanel]);

  // Custom tab component that overrides close action to hide instead of remove
  // Using a stable reference that calls through the ref
  const CustomTab = useCallback(
    (props: IDockviewPanelHeaderProps) => {
      return (
        <DockviewDefaultTab
          {...props}
          closeActionOverride={() => closePanelRef.current(props.api.id)}
        />
      );
    },
    [] // No dependencies - uses ref internally
  );

  // Sync panel visibility with dockview using group.api.setVisible()
  useEffect(() => {
    if (!dockview) return;

    const panelConfigs: Record<
      keyof PanelVisibility,
      {
        id: string;
        component: string;
        title: string;
        getParams: () => Record<string, unknown>;
        initialWidth: number;
      }
    > = {
      editor: {
        id: 'editor-panel',
        component: 'editor',
        title: 'Editor',
        getParams: () => ({
          notation,
          onChange: onNotationChange,
        }),
        initialWidth: 280,
      },
      preview: {
        id: 'preview-panel',
        component: 'preview',
        title: 'Preview',
        getParams: () => ({
          notation,
          onCurrentTimeChange,
          onPlayingChange,
          onNoteEvent,
          onCharTimeMapChange,
          onNoteTimelineChange,
          onSecondsPerBeatChange,
          audioContainerId,
        }),
        initialWidth: 520,
      },
      otamatoneRoll: {
        id: 'otamatone-roll-panel',
        component: 'otamatoneRoll',
        title: 'Otamatone Roll',
        getParams: () => ({
          currentTime,
          isPlaying,
          activeNoteEvent,
          noteCharTimes,
          currentSecondsPerBeat,
          noteTimeline,
          baselineSecondsPerBeat: currentSecondsPerBeat,
          lowestNoteHz,
          highestNoteHz,
        }),
        initialWidth: 520,
      },
    };

    const panelOrder: Array<keyof PanelVisibility> = [
      'editor',
      'preview',
      'otamatoneRoll',
    ];

    panelOrder.forEach((key) => {
      const config = panelConfigs[key];
      const panel = dockview.getPanel(config.id);
      const isVisible = panelVisibility[key];

      if (panel) {
        // Panel exists - use setVisible to show/hide
        panel.group.api.setVisible(isVisible);
      } else if (isVisible) {
        // Panel doesn't exist but should be visible - create it
        const currentIndex = panelOrder.indexOf(key);
        let positionConfig:
          | { referencePanel: string; direction: 'left' | 'right' }
          | undefined;

        // Look for a visible panel after this one (to place to its left)
        for (let i = currentIndex + 1; i < panelOrder.length; i++) {
          const nextKey = panelOrder[i];
          if (nextKey) {
            const nextConfig = panelConfigs[nextKey];
            const nextPanel = dockview.getPanel(nextConfig.id);
            if (nextPanel && nextPanel.group.api.isVisible) {
              positionConfig = {
                referencePanel: nextPanel.id,
                direction: 'left',
              };
              break;
            }
          }
        }

        // If no panel after, look for one before (to place to its right)
        if (!positionConfig) {
          for (let i = currentIndex - 1; i >= 0; i--) {
            const prevKey = panelOrder[i];
            if (prevKey) {
              const prevConfig = panelConfigs[prevKey];
              const prevPanel = dockview.getPanel(prevConfig.id);
              if (prevPanel && prevPanel.group.api.isVisible) {
                positionConfig = {
                  referencePanel: prevPanel.id,
                  direction: 'right',
                };
                break;
              }
            }
          }
        }

        dockview.addPanel({
          id: config.id,
          component: config.component,
          title: config.title,
          params: config.getParams(),
          initialWidth: config.initialWidth,
          ...(positionConfig && { position: positionConfig }),
        });
      }
    });
  }, [
    dockview,
    panelVisibility,
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
    currentSecondsPerBeat,
    onSecondsPerBeatChange,
    audioContainerId,
    lowestNoteHz,
    highestNoteHz,
  ]);

  const onReady = useCallback(
    (event: DockviewReadyEvent) => {
      setDockview(event.api);

      // Try to restore layout from localStorage
      const storedLayout = readStoredLayout();
      if (storedLayout) {
        try {
          event.api.fromJSON(storedLayout);
        } catch (error) {
          console.warn(
            'Failed to restore dockview layout, falling back to default',
            error
          );
          initializeDefaultLayout(event.api);
        }
      } else {
        initializeDefaultLayout(event.api);
      }

      // Persist layout on changes
      event.api.onDidLayoutChange(() => {
        persistLayout(event.api);
      });

      function initializeDefaultLayout(api: DockviewApi) {
        api.addPanel({
          id: 'editor-panel',
          component: 'editor',
          title: 'Editor',
          params: {
            notation,
            onChange: onNotationChange,
          },
          initialWidth: 280,
        });

        api.addPanel({
          id: 'preview-panel',
          component: 'preview',
          title: 'Preview',
          position: {
            referencePanel: 'editor-panel',
            direction: 'right',
          },
          params: {
            notation,
            onCurrentTimeChange,
            onPlayingChange,
            onNoteEvent,
            onCharTimeMapChange,
            onNoteTimelineChange,
            onSecondsPerBeatChange,
            audioContainerId,
          },
          initialWidth: 520,
        });

        api.addPanel({
          id: 'otamatone-roll-panel',
          component: 'otamatoneRoll',
          title: 'Otamatone Roll',
          position: { referencePanel: 'preview-panel', direction: 'right' },
          params: {
            currentTime,
            isPlaying,
            activeNoteEvent,
            noteCharTimes,
            currentSecondsPerBeat,
            noteTimeline,
            baselineSecondsPerBeat: currentSecondsPerBeat,
            lowestNoteHz,
            highestNoteHz,
          },
          initialWidth: 520,
        });
      }
    },
    [
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
      currentSecondsPerBeat,
      onSecondsPerBeatChange,
      audioContainerId,
      lowestNoteHz,
      highestNoteHz,
    ]
  );

  // Update panel params when props change
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
        onSecondsPerBeatChange,
        audioContainerId,
      });
    }

    if (otamatoneRollPanel) {
      otamatoneRollPanel.api.updateParameters({
        currentTime,
        isPlaying,
        activeNoteEvent,
        noteCharTimes,
        currentSecondsPerBeat,
        noteTimeline,
        baselineSecondsPerBeat: currentSecondsPerBeat,
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
    currentSecondsPerBeat,
    onSecondsPerBeatChange,
    audioContainerId,
    lowestNoteHz,
    highestNoteHz,
  ]);

  const components = {
    editor: EditorPanel,
    preview: PreviewPanel,
    otamatoneRoll: OtamatoneRollPanel,
  };

  return (
    <div className="dockview-wrapper">
      <ViewMenu visibility={panelVisibility} onToggle={togglePanelVisibility} />
      <div className="dockview-container">
        <DockviewReact
          components={components}
          defaultTabComponent={CustomTab}
          onReady={onReady}
          className="dockview-theme-replit"
        />
      </div>
    </div>
  );
};
