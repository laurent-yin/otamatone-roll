import { create } from 'zustand';
import {
  NoteCharTimeMap,
  NotePlaybackEvent,
  NoteTimeline,
} from '../types/music';
import { DEFAULT_ABC_NOTATION } from '../constants/abc-notation';
import {
  DEFAULT_HIGHEST_FREQUENCY,
  DEFAULT_LOWEST_FREQUENCY,
} from '../utils/frequency';
import { getCookie, setCookie } from '../utils/cookies';

const NOTATION_STORAGE_KEY = 'or-abc-notation';
const LOWEST_NOTE_COOKIE = 'or-lowest-note-hz';
const HIGHEST_NOTE_COOKIE = 'or-highest-note-hz';
const COOKIE_MAX_AGE_SECONDS = 60 * 60 * 24 * 365; // one year

const isBrowser = () => typeof window !== 'undefined';

const readFrequencyCookie = (cookieName: string, fallback: number): number => {
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

const readStoredNotation = (): string => {
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

const persistNotation = (notation: string) => {
  if (!isBrowser()) {
    return;
  }
  try {
    window.localStorage.setItem(NOTATION_STORAGE_KEY, notation);
  } catch (error) {
    console.warn('Unable to persist notation to localStorage', error);
  }
};

export interface AppState {
  // ABC notation
  notation: string;
  setNotation: (notation: string) => void;

  // Playback state
  currentTime: number;
  setCurrentTime: (time: number) => void;
  isPlaying: boolean;
  setIsPlaying: (playing: boolean) => void;

  // Active note event (for highlighting)
  activeNoteEvent: NotePlaybackEvent | null;
  setActiveNoteEvent: (event: NotePlaybackEvent | null) => void;

  // Note timing data (derived from ABC)
  noteCharTimes: NoteCharTimeMap;
  setNoteCharTimes: (map: NoteCharTimeMap) => void;
  noteTimeline: NoteTimeline | null;
  setNoteTimeline: (timeline: NoteTimeline | null) => void;

  // Tempo
  currentSecondsPerBeat: number | undefined;
  setCurrentSecondsPerBeat: (secondsPerBeat: number | undefined) => void;

  // Frequency range settings
  lowestNoteHz: number;
  setLowestNoteHz: (hz: number) => void;
  highestNoteHz: number;
  setHighestNoteHz: (hz: number) => void;

  // Computed/sanitized frequency values
  getSanitizedLowestNoteHz: () => number;
  getSanitizedHighestNoteHz: () => number;
}

export const useAppStore = create<AppState>((set, get) => ({
  // ABC notation
  notation: readStoredNotation(),
  setNotation: (notation) => {
    set({ notation });
    persistNotation(notation);
  },

  // Playback state
  currentTime: 0,
  setCurrentTime: (currentTime) => set({ currentTime }),
  isPlaying: false,
  setIsPlaying: (isPlaying) => set({ isPlaying }),

  // Active note event
  activeNoteEvent: null,
  setActiveNoteEvent: (activeNoteEvent) => set({ activeNoteEvent }),

  // Note timing data
  noteCharTimes: {},
  setNoteCharTimes: (noteCharTimes) => set({ noteCharTimes }),
  noteTimeline: null,
  setNoteTimeline: (noteTimeline) => set({ noteTimeline }),

  // Tempo
  currentSecondsPerBeat: undefined,
  setCurrentSecondsPerBeat: (currentSecondsPerBeat) =>
    set({ currentSecondsPerBeat }),

  // Frequency range
  lowestNoteHz: readFrequencyCookie(
    LOWEST_NOTE_COOKIE,
    DEFAULT_LOWEST_FREQUENCY
  ),
  setLowestNoteHz: (lowestNoteHz) => {
    set({ lowestNoteHz });
    if (Number.isFinite(lowestNoteHz) && lowestNoteHz > 0) {
      setCookie(LOWEST_NOTE_COOKIE, String(lowestNoteHz), {
        maxAgeSeconds: COOKIE_MAX_AGE_SECONDS,
      });
    }
  },

  highestNoteHz: readFrequencyCookie(
    HIGHEST_NOTE_COOKIE,
    DEFAULT_HIGHEST_FREQUENCY
  ),
  setHighestNoteHz: (highestNoteHz) => {
    set({ highestNoteHz });
    if (Number.isFinite(highestNoteHz) && highestNoteHz > 0) {
      setCookie(HIGHEST_NOTE_COOKIE, String(highestNoteHz), {
        maxAgeSeconds: COOKIE_MAX_AGE_SECONDS,
      });
    }
  },

  // Computed values
  getSanitizedLowestNoteHz: () => {
    const { lowestNoteHz } = get();
    if (!Number.isFinite(lowestNoteHz) || lowestNoteHz <= 0) {
      return DEFAULT_LOWEST_FREQUENCY;
    }
    return lowestNoteHz;
  },

  getSanitizedHighestNoteHz: () => {
    const { highestNoteHz } = get();
    const sanitizedLowest = get().getSanitizedLowestNoteHz();
    const fallback = Math.max(DEFAULT_HIGHEST_FREQUENCY, sanitizedLowest + 1);

    if (!Number.isFinite(highestNoteHz) || highestNoteHz <= 0) {
      return fallback;
    }
    return Math.max(highestNoteHz, sanitizedLowest + 1);
  },
}));
