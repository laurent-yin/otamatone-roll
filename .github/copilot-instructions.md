# Copilot Instructions for Otamatone Roll

## Overview

Otamatone Roll is a web app that visualizes ABC notation music with an otamatone-style piano roll. See `docs/ARCHITECTURE.md` for detailed system design.

## Tech Stack

- React 18 + TypeScript + Vite
- Zustand for state management
- abcjs for ABC notation parsing and audio synthesis
- Dockview for resizable panel layout
- Vitest for testing (jsdom + browser)

## Key Architectural Principles

### Beat-Based Timing (Critical!)

All timing is stored in **beats**, not seconds. This makes the timeline invariant to tempo changes.

- `NoteTimeline.notes[].startBeat` / `durationBeats` - beat-based
- `secondsPerBeat` is computed separately for playback conversion
- When tempo/warp changes, only `secondsPerBeat` updates—timeline stays the same

### State Management

- All shared state lives in Zustand store (`src/store/appStore.ts`)
- Components read from store; avoid prop drilling
- Services (like `AbcPlaybackController`) write to store via callbacks

### Data Flow

```
AbcEditor → appStore.notation → AbcNotationViewer → abcjs rendering
                                      ↓
                              AbcPlaybackController
                                      ↓
                              noteTimeline → OtamatoneRoll
```

## Conventions

- Functional components with hooks
- Named exports (not default)
- Co-locate tests: `foo.ts` → `foo.test.ts`
- JSDoc on all exported functions
- TypeScript strict mode

## Key Files

| Purpose      | File                               |
| ------------ | ---------------------------------- |
| Global state | `src/store/appStore.ts`            |
| Core types   | `src/types/music.ts`               |
| ABC → beats  | `src/utils/abcTiming.ts`           |
| Playback     | `src/services/abcPlayback.ts`      |
| Piano roll   | `src/components/OtamatoneRoll.tsx` |

## Testing

```bash
npm run test           # Unit tests (jsdom)
npm run test:browser   # Integration tests (Chromium)
```

## Common Tasks

### Adding a new utility function

1. Add to appropriate file in `src/utils/`
2. Add JSDoc with @param, @returns, @example
3. Add unit test in `*.test.ts`

### Adding store state

1. Add to `AppState` interface in `appStore.ts`
2. Add setter function
3. Update `partialize` if it should persist to localStorage

### Modifying piano roll visualization

1. Edit `src/components/OtamatoneRoll.tsx`
2. All timing uses beats—convert with `secondsToBeats()` if needed
3. Frequency range comes from `lowestNoteHz`/`highestNoteHz` in store
