import { ChangeEvent, useEffect, useMemo } from 'react';
import { DockviewLayout } from './components/DockviewLayout';
import { useAppStore } from './store/appStore';
import { buildTimelinePreviewImage } from './utils/timelinePreview';

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
  const lowestNoteHz = useAppStore((state) => state.lowestNoteHz);
  const highestNoteHz = useAppStore((state) => state.highestNoteHz);
  const setLowestNoteHz = useAppStore((state) => state.setLowestNoteHz);
  const setHighestNoteHz = useAppStore((state) => state.setHighestNoteHz);
  const getSanitizedLowestNoteHz = useAppStore((state) => state.getSanitizedLowestNoteHz);
  const getSanitizedHighestNoteHz = useAppStore((state) => state.getSanitizedHighestNoteHz);

  const sanitizedLowestNoteHz = getSanitizedLowestNoteHz();
  const sanitizedHighestNoteHz = getSanitizedHighestNoteHz();

  const progressPreviewHeight = useMemo(() => readProgressControlHeight(), []);

  const timelinePreviewImage = useMemo(() => {
    return buildTimelinePreviewImage(noteTimeline, {
      width: 1200,
      height: progressPreviewHeight,
      minFrequency: sanitizedLowestNoteHz,
      maxFrequency: sanitizedHighestNoteHz,
    });
  }, [
    noteTimeline,
    sanitizedLowestNoteHz,
    sanitizedHighestNoteHz,
    progressPreviewHeight,
  ]);

  const handleFrequencyChange = (
    event: ChangeEvent<HTMLInputElement>,
    setter: (value: number) => void
  ) => {
    const { value } = event.target;
    if (value === '') {
      setter(Number.NaN);
      return;
    }
    const parsed = Number(value);
    if (Number.isNaN(parsed)) {
      return;
    }
    setter(parsed);
  };

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
            className="frequency-form"
            role="group"
            aria-label="Otamatone range controls"
          >
            <div className="frequency-field">
              <label htmlFor="lowest-note-input">
                <span>Lowest note (Hz)</span>
                <div className="frequency-input">
                  <input
                    id="lowest-note-input"
                    type="number"
                    inputMode="decimal"
                    min={1}
                    step="0.1"
                    value={Number.isFinite(lowestNoteHz) ? lowestNoteHz : ''}
                    onChange={(event) =>
                      handleFrequencyChange(event, setLowestNoteHz)
                    }
                    aria-describedby="lowest-note-unit"
                  />
                  <span id="lowest-note-unit" className="frequency-unit">
                    Hz
                  </span>
                </div>
              </label>
            </div>
            <div className="frequency-field">
              <label htmlFor="highest-note-input">
                <span>Highest note (Hz)</span>
                <div className="frequency-input">
                  <input
                    id="highest-note-input"
                    type="number"
                    inputMode="decimal"
                    min={1}
                    step="0.1"
                    value={Number.isFinite(highestNoteHz) ? highestNoteHz : ''}
                    onChange={(event) =>
                      handleFrequencyChange(event, setHighestNoteHz)
                    }
                    aria-describedby="highest-note-unit"
                  />
                  <span id="highest-note-unit" className="frequency-unit">
                    Hz
                  </span>
                </div>
              </label>
            </div>
          </div>
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
