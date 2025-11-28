import { ChangeEvent, useEffect, useMemo, useState } from 'react';
import { DockviewLayout } from './components/DockviewLayout';
import { DEFAULT_ABC_NOTATION } from './constants/abc-notation';
import {
  NoteCharTimeMap,
  NotePlaybackEvent,
  NoteTimeline,
} from './types/music';
import {
  DEFAULT_HIGHEST_FREQUENCY,
  DEFAULT_LOWEST_FREQUENCY,
} from './utils/frequency';
import { getCookie, setCookie } from './utils/cookies';
import { buildTimelinePreviewImage } from './utils/timelinePreview';

const AUDIO_CONTROLS_ID = 'abc-global-audio-controls';
const LOWEST_NOTE_COOKIE = 'or-lowest-note-hz';
const HIGHEST_NOTE_COOKIE = 'or-highest-note-hz';
const COOKIE_MAX_AGE_SECONDS = 60 * 60 * 24 * 365; // one year
const NOTATION_STORAGE_KEY = 'or-abc-notation';
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

const readFrequencyCookie = (cookieName: string, fallback: number) => {
  const raw = getCookie(cookieName);
  if (raw === undefined) {
    return fallback;
  }

  const parsed = Number(raw);
  if (!Number.isFinite(parsed) || parsed <= 0) {
    return fallback;
  }

  return parsed;
};

const readStoredNotation = () => {
  if (!isBrowser()) {
    return DEFAULT_ABC_NOTATION;
  }
  try {
    const stored = window.localStorage.getItem(NOTATION_STORAGE_KEY);
    if (stored !== null && stored.trim().length > 0) {
      return stored;
    }
  } catch (error) {
    console.warn('Unable to read notation from localStorage', error);
  }
  return DEFAULT_ABC_NOTATION;
};

const App = () => {
  const [notation, setNotation] = useState<string>(() => readStoredNotation());
  const [currentTime, setCurrentTime] = useState(0);
  const [isPlaying, setIsPlaying] = useState(false);
  const [activeNoteEvent, setActiveNoteEvent] =
    useState<NotePlaybackEvent | null>(null);
  const [noteCharTimes, setNoteCharTimes] = useState<NoteCharTimeMap>({});
  const [noteTimeline, setNoteTimeline] = useState<NoteTimeline | null>(null);
  const [lowestNoteHz, setLowestNoteHz] = useState<number>(() =>
    readFrequencyCookie(LOWEST_NOTE_COOKIE, DEFAULT_LOWEST_FREQUENCY)
  );
  const [highestNoteHz, setHighestNoteHz] = useState<number>(() =>
    readFrequencyCookie(HIGHEST_NOTE_COOKIE, DEFAULT_HIGHEST_FREQUENCY)
  );
  const progressPreviewHeight = useMemo(() => readProgressControlHeight(), []);

  const sanitizedLowestNoteHz = useMemo(() => {
    if (!Number.isFinite(lowestNoteHz) || lowestNoteHz <= 0) {
      return DEFAULT_LOWEST_FREQUENCY;
    }
    return lowestNoteHz;
  }, [lowestNoteHz]);

  const sanitizedHighestNoteHz = useMemo(() => {
    const fallback = Math.max(
      DEFAULT_HIGHEST_FREQUENCY,
      sanitizedLowestNoteHz + 1
    );

    if (!Number.isFinite(highestNoteHz) || highestNoteHz <= 0) {
      return fallback;
    }

    return Math.max(highestNoteHz, sanitizedLowestNoteHz + 1);
  }, [highestNoteHz, sanitizedLowestNoteHz]);

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

  useEffect(() => {
    setCookie(LOWEST_NOTE_COOKIE, String(sanitizedLowestNoteHz), {
      maxAgeSeconds: COOKIE_MAX_AGE_SECONDS,
    });
  }, [sanitizedLowestNoteHz]);

  useEffect(() => {
    setCookie(HIGHEST_NOTE_COOKIE, String(sanitizedHighestNoteHz), {
      maxAgeSeconds: COOKIE_MAX_AGE_SECONDS,
    });
  }, [sanitizedHighestNoteHz]);

  useEffect(() => {
    if (!isBrowser()) {
      return;
    }
    try {
      window.localStorage.setItem(NOTATION_STORAGE_KEY, notation);
    } catch (error) {
      console.warn('Unable to persist notation to localStorage', error);
    }
  }, [notation]);

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
        <DockviewLayout
          notation={notation}
          onNotationChange={setNotation}
          audioContainerId={AUDIO_CONTROLS_ID}
          currentTime={currentTime}
          isPlaying={isPlaying}
          onCurrentTimeChange={setCurrentTime}
          onPlayingChange={setIsPlaying}
          onNoteEvent={setActiveNoteEvent}
          activeNoteEvent={activeNoteEvent}
          noteCharTimes={noteCharTimes}
          onCharTimeMapChange={setNoteCharTimes}
          noteTimeline={noteTimeline}
          onNoteTimelineChange={setNoteTimeline}
          lowestNoteHz={sanitizedLowestNoteHz}
          highestNoteHz={sanitizedHighestNoteHz}
        />
      </main>
    </div>
  );
};

export default App;
