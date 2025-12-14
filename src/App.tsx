import { useEffect, useMemo } from 'react';
import { DockviewLayout } from './components/DockviewLayout';
import { useAppStore } from './store/appStore';
import { buildTimelinePreviewImage } from './utils/timelinePreview';
import {
  DEFAULT_HIGHEST_FREQUENCY,
  DEFAULT_LOWEST_FREQUENCY,
} from './utils/frequency';

const AUDIO_CONTROLS_ID = 'abc-global-audio-controls';
const FALLBACK_PROGRESS_HEIGHT_PX = 28;

const isBrowser = () => typeof window !== 'undefined';

const readProgressControlHeight = () => {
  if (!isBrowser()) {
    return FALLBACK_PROGRESS_HEIGHT_PX;
  }
  const root = document.documentElement;
  if (!root) {
    return FALLBACK_PROGRESS_HEIGHT_PX;
  }
  const computed = window.getComputedStyle(root);
  const raw = computed.getPropertyValue('--or-progress-control-height');
  const parsed = Number.parseFloat(raw);
  if (!Number.isFinite(parsed) || parsed <= 0) {
    return FALLBACK_PROGRESS_HEIGHT_PX;
  }
  return parsed;
};

const App = () => {
  // Read state from store
  const noteTimeline = useAppStore((state) => state.noteTimeline);
  // Subscribe to frequency values to trigger re-render when they change
  const lowestNoteHz = useAppStore((state) => state.lowestNoteHz);
  const highestNoteHz = useAppStore((state) => state.highestNoteHz);

  const progressPreviewHeight = useMemo(() => readProgressControlHeight(), []);

  const timelinePreviewImage = useMemo(() => {
    // Sanitize values inline to satisfy React Compiler
    const sanitizedLowest =
      Number.isFinite(lowestNoteHz) && lowestNoteHz > 0
        ? lowestNoteHz
        : DEFAULT_LOWEST_FREQUENCY;
    const sanitizedHighest =
      Number.isFinite(highestNoteHz) && highestNoteHz > 0
        ? highestNoteHz
        : Math.max(DEFAULT_HIGHEST_FREQUENCY, sanitizedLowest + 1);

    return buildTimelinePreviewImage(noteTimeline, {
      width: 1200,
      height: progressPreviewHeight,
      minFrequency: sanitizedLowest,
      maxFrequency: sanitizedHighest,
    });
  }, [noteTimeline, lowestNoteHz, highestNoteHz, progressPreviewHeight]);

  useEffect(() => {
    if (!isBrowser()) {
      return;
    }
    const container = document.getElementById(AUDIO_CONTROLS_ID);
    if (!container) {
      return;
    }

    let progressEl: HTMLElement | null = null;
    let observer: MutationObserver | null = null;

    const clearPreview = () => {
      if (progressEl) {
        progressEl.style.removeProperty('--or-progress-preview-image');
        progressEl.classList.remove('has-progress-preview');
      }
    };

    const applyPreview = () => {
      const candidate = container.querySelector<HTMLElement>(
        '.abcjs-midi-progress-background'
      );
      if (progressEl !== candidate) {
        clearPreview();
        progressEl = candidate;
      }
      if (!progressEl) {
        return;
      }
      if (timelinePreviewImage) {
        progressEl.style.setProperty(
          '--or-progress-preview-image',
          `url(${timelinePreviewImage})`
        );
        progressEl.classList.add('has-progress-preview');
      } else {
        clearPreview();
      }
    };

    applyPreview();

    if (typeof MutationObserver !== 'undefined') {
      observer = new MutationObserver(() => {
        applyPreview();
      });
      observer.observe(container, { childList: true, subtree: true });
    }

    return () => {
      observer?.disconnect();
      clearPreview();
      progressEl = null;
    };
  }, [timelinePreviewImage]);

  return (
    <div className="app">
      <header className="app-header">
        <div className="app-header-title">
          <h1>
            <span className="app-header-title-main">Otama-Karaoke!</span>
            <span className="app-header-kaomoji">ヾ(´〇`)ﾉ♬♪</span>
          </h1>
        </div>
        <div className="app-header-controls">
          <div
            id={AUDIO_CONTROLS_ID}
            className="abc-audio-controls app-header-audio-controls"
            aria-label="Audio playback controls"
          />
        </div>
      </header>
      <main className="app-main">
        <DockviewLayout audioContainerId={AUDIO_CONTROLS_ID} />
      </main>
    </div>
  );
};

export default App;
