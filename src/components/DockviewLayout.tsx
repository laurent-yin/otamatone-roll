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

interface DockviewLayoutProps {
  audioContainerId?: string;
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

/**
 * Editor panel - uses AbcEditor which reads/writes from store
 */
const EditorPanel = () => {
  return <AbcEditor />;
};

/**
 * Preview panel - uses AbcNotationViewer which reads from store
 */
const PreviewPanel = (
  props: IDockviewPanelProps<{
    audioContainerId?: string;
  }>
) => {
  const audioContainerId = props.params?.audioContainerId;
  const containerId = props.api?.id
    ? `abc-preview-${props.api.id}`
    : 'abc-preview-default';

  return (
    <div className="preview-panel">
      <AbcNotationViewer
        containerId={containerId}
        audioContainerId={audioContainerId}
      />
    </div>
  );
};

/**
 * Otamatone Roll panel - uses OtamatoneRoll which reads from store
 */
const OtamatoneRollPanel = () => {
  return (
    <div className="otamatone-roll-panel">
      <OtamatoneRoll />
    </div>
  );
};

export const DockviewLayout = ({ audioContainerId }: DockviewLayoutProps) => {
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

  // Panel configurations - much simpler now since components read from store
  const panelConfigs: Record<
    keyof PanelVisibility,
    {
      id: string;
      component: string;
      title: string;
      params: Record<string, unknown>;
      initialWidth: number;
    }
  > = {
    editor: {
      id: 'editor-panel',
      component: 'editor',
      title: 'Editor',
      params: {}, // AbcEditor reads from store
      initialWidth: 280,
    },
    preview: {
      id: 'preview-panel',
      component: 'preview',
      title: 'Preview',
      params: { audioContainerId }, // Only need to pass containerId
      initialWidth: 520,
    },
    otamatoneRoll: {
      id: 'otamatone-roll-panel',
      component: 'otamatoneRoll',
      title: 'Otamatone Roll',
      params: {}, // OtamatoneRoll reads from store
      initialWidth: 520,
    },
  };

  // Sync panel visibility with dockview using group.api.setVisible()
  useEffect(() => {
    if (!dockview) return;

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
          params: config.params,
          initialWidth: config.initialWidth,
          ...(positionConfig && { position: positionConfig }),
        });
      }
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [dockview, panelVisibility, audioContainerId]);

  const onReady = useCallback(
    (event: DockviewReadyEvent) => {
      setDockview(event.api);

      // Try to restore layout from localStorage
      const storedLayout = readStoredLayout();
      if (storedLayout) {
        try {
          event.api.fromJSON(storedLayout);
          // After restoring, update the preview panel's audioContainerId
          const previewPanel = event.api.getPanel('preview-panel');
          if (previewPanel) {
            previewPanel.api.updateParameters({ audioContainerId });
          }
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
          params: {},
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
          params: { audioContainerId },
          initialWidth: 520,
        });

        api.addPanel({
          id: 'otamatone-roll-panel',
          component: 'otamatoneRoll',
          title: 'Otamatone Roll',
          position: { referencePanel: 'preview-panel', direction: 'right' },
          params: {},
          initialWidth: 520,
        });
      }
    },
    [audioContainerId]
  );

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
