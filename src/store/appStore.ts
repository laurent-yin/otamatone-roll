import { create } from 'zustand';
import { persist } from 'zustand/middleware';
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

// State that should be persisted to localStorage
interface PersistedState {
  notation: string;
  lowestNoteHz: number;
  highestNoteHz: number;
}

export const useAppStore = create<AppState>()(
  persist(
    (set, get) => ({
      // ABC notation
      notation: DEFAULT_ABC_NOTATION,
      setNotation: (notation) => set({ notation }),

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
      lowestNoteHz: DEFAULT_LOWEST_FREQUENCY,
      setLowestNoteHz: (lowestNoteHz) => set({ lowestNoteHz }),

      highestNoteHz: DEFAULT_HIGHEST_FREQUENCY,
      setHighestNoteHz: (highestNoteHz) => set({ highestNoteHz }),

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
        const fallback = Math.max(
          DEFAULT_HIGHEST_FREQUENCY,
          sanitizedLowest + 1
        );

        if (!Number.isFinite(highestNoteHz) || highestNoteHz <= 0) {
          return fallback;
        }
        return Math.max(highestNoteHz, sanitizedLowest + 1);
      },
    }),
    {
      name: 'otamatone-roll-storage',
      // Only persist the minimal state needed to restore the app
      partialize: (state): PersistedState => ({
        notation: state.notation,
        lowestNoteHz: state.lowestNoteHz,
        highestNoteHz: state.highestNoteHz,
      }),
    }
  )
);
