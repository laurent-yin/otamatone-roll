import { useEffect, useRef, useState } from 'react';
import { createRoot } from 'react-dom/client';
import {
  DockviewApi,
  DockviewComponent,
  IDockviewPanelProps,
} from 'dockview-core';
import 'dockview-core/dist/styles/dockview.css';
import { AbcEditor } from './AbcEditor';
import { AbcNotationViewer } from './AbcNotationViewer';

interface DockviewLayoutProps {
  notation: string;
  onNotationChange: (notation: string) => void;
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

const PreviewPanel = (props: IDockviewPanelProps<{ notation: string }>) => {
  const notation = props.params?.notation || '';
  const containerId = props.api?.id
    ? `abc-preview-${props.api.id}`
    : 'abc-preview-default';

  return (
    <div className="preview-panel">
      <div className="preview-panel-header">
        <h3>Preview</h3>
      </div>
      <AbcNotationViewer notation={notation} containerId={containerId} />
    </div>
  );
};

export const DockviewLayout = ({
  notation,
  onNotationChange,
}: DockviewLayoutProps) => {
  const containerRef = useRef<HTMLDivElement>(null);
  const [dockview, setDockview] = useState<DockviewApi | null>(null);

  useEffect(() => {
    if (!containerRef.current) return;

    const components = {
      editor: EditorPanel,
      preview: PreviewPanel,
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
      className: 'dockview-theme-abyss',
    });

    setDockview(dockviewInstance.api);

    // Create editor panel
    dockviewInstance.addPanel({
      id: 'editor-panel',
      component: 'editor',
      title: 'Editor',
      params: {
        notation,
        onChange: onNotationChange,
      },
    });

    // Create preview panel
    dockviewInstance.addPanel({
      id: 'preview-panel',
      component: 'preview',
      title: 'Preview',
      position: { referencePanel: 'editor-panel', direction: 'right' },
      params: {
        notation,
      },
    });

    return () => {
      dockviewInstance.dispose();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []); // Only run once on mount

  // Update panel params when notation changes
  useEffect(() => {
    if (!dockview) return;

    const editorPanel = dockview.getPanel('editor-panel');
    const previewPanel = dockview.getPanel('preview-panel');

    if (editorPanel) {
      editorPanel.api.updateParameters({
        notation,
        onChange: onNotationChange,
      });
    }

    if (previewPanel) {
      previewPanel.api.updateParameters({
        notation,
      });
    }
  }, [dockview, notation, onNotationChange]);

  return <div ref={containerRef} className="dockview-container" />;
};
