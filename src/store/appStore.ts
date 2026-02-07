import { create } from 'zustand';
import { devtools, persist } from 'zustand/middleware';
import {
  NoteCharTimeMap,
  NotePlaybackEvent,
  NoteTimeline,
  PitchDetectionResult,
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

  // Tempo (seconds per subdivision for playback conversion)
  currentSecondsPerSubdivision: number | undefined;
  setCurrentSecondsPerSubdivision: (
    secondsPerSubdivision: number | undefined
  ) => void;
  /**
   * @deprecated Use currentSecondsPerSubdivision instead
   */
  currentSecondsPerBeat: number | undefined;
  /**
   * @deprecated Use setCurrentSecondsPerSubdivision instead
   */
  setCurrentSecondsPerBeat: (secondsPerBeat: number | undefined) => void;

  // Frequency range settings
  lowestNoteHz: number;
  setLowestNoteHz: (hz: number) => void;
  highestNoteHz: number;
  setHighestNoteHz: (hz: number) => void;

  // Computed/sanitized frequency values
  getSanitizedLowestNoteHz: () => number;
  getSanitizedHighestNoteHz: () => number;

  // Pitch detection (microphone input)
  isMicrophoneActive: boolean;
  setIsMicrophoneActive: (active: boolean) => void;
  detectedPitch: PitchDetectionResult | null;
  setDetectedPitch: (pitch: PitchDetectionResult | null) => void;
}

// State that should be persisted to localStorage
interface PersistedState {
  notation: string;
  lowestNoteHz: number;
  highestNoteHz: number;
}

/**
 * Main Zustand store for application state.
 * Contains ABC notation, playback state, timing data, and display settings.
 *
 * State is divided into:
 * - **Notation**: Current ABC notation string
 * - **Playback**: currentTime, isPlaying, activeNoteEvent
 * - **Timing**: noteCharTimes, noteTimeline, currentSecondsPerBeat
 * - **Display**: lowestNoteHz, highestNoteHz (frequency range for piano roll)
 *
 * Persisted to localStorage: notation, lowestNoteHz, highestNoteHz
 *
 * @example
 * // In a component:
 * const notation = useAppStore((state) => state.notation);
 * const setNotation = useAppStore((state) => state.setNotation);
 *
 * // Outside React:
 * const { notation, setNotation } = useAppStore.getState();
 */
export const useAppStore = create<AppState>()(
  devtools(
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
        currentSecondsPerSubdivision: undefined,
        setCurrentSecondsPerSubdivision: (currentSecondsPerSubdivision) =>
          set({
            currentSecondsPerSubdivision,
            currentSecondsPerBeat: currentSecondsPerSubdivision,
          }),
        // Deprecated aliases
        currentSecondsPerBeat: undefined,
        setCurrentSecondsPerBeat: (currentSecondsPerBeat) =>
          set({
            currentSecondsPerBeat,
            currentSecondsPerSubdivision: currentSecondsPerBeat,
          }),

        // Frequency range
        lowestNoteHz: DEFAULT_LOWEST_FREQUENCY,
        setLowestNoteHz: (lowestNoteHz) => set({ lowestNoteHz }),

        highestNoteHz: DEFAULT_HIGHEST_FREQUENCY,
        setHighestNoteHz: (highestNoteHz) => set({ highestNoteHz }),

        // Pitch detection
        isMicrophoneActive: false,
        setIsMicrophoneActive: (isMicrophoneActive) =>
          set({ isMicrophoneActive }),
        detectedPitch: null,
        setDetectedPitch: (detectedPitch) => set({ detectedPitch }),

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
    ),
    { name: 'OtamatoneRoll' }
  )
);

// Expose store for debugging in dev mode
if (import.meta.env.DEV) {
  (window as unknown as { appStore: typeof useAppStore }).appStore =
    useAppStore;
}
