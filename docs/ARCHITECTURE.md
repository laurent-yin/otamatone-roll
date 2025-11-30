# Architecture

This document describes the high-level architecture of Otamatone Roll, a web application that visualizes musical tunes using ABC notation with an "Otamatone-style" piano roll display.

## Overview

Otamatone Roll is a React + TypeScript single-page application that:

1. Accepts ABC notation input from the user
2. Renders traditional sheet music using abcjs
3. Displays a synchronized piano roll visualization
4. Provides audio playback with real-time cursor tracking

## Tech Stack

| Category         | Technology                  |
| ---------------- | --------------------------- |
| Framework        | React 18                    |
| Language         | TypeScript                  |
| Build Tool       | Vite                        |
| State Management | Zustand                     |
| Music Parsing    | abcjs                       |
| Layout           | Dockview (resizable panels) |
| Testing          | Vitest (jsdom + browser)    |
| Deployment       | Azure Static Web Apps       |

## Project Structure

```
src/
├── components/       # React UI components
├── constants/        # Static configuration values
├── hooks/            # Custom React hooks
├── services/         # Business logic (playback controller)
├── store/            # Zustand global state
├── types/            # TypeScript interfaces
└── utils/            # Pure utility functions
```

## Key Concepts

### ABC Notation

ABC notation is a text-based music notation format. Example:

```
X:1
T:Simple Scale
M:4/4
K:C
C D E F | G A B c |
```

### Beat-Based Timeline

All timing is stored in **beats** (not seconds), making the timeline invariant to tempo changes. This is a core architectural decision:

- `NoteTimeline.notes[].startBeat` - when the note starts (in beats)
- `NoteTimeline.notes[].durationBeats` - how long it lasts (in beats)
- `secondsPerBeat` is computed separately and applied at render/playback time

### Frequency Range

The Otamatone Roll displays notes within a configurable frequency range (Hz), allowing users to focus on the pitch range relevant to their instrument.

## Data Flow

```
┌─────────────┐     ┌──────────────┐     ┌─────────────────┐
│  AbcEditor  │────▶│   appStore   │────▶│ AbcNotationViewer│
│  (input)    │     │  (Zustand)   │     │ (sheet music)    │
└─────────────┘     └──────┬───────┘     └─────────────────┘
                           │
                           ▼
                    ┌──────────────┐
                    │ OtamatoneRoll│
                    │ (piano roll) │
                    └──────────────┘
```

1. **User Input**: User edits ABC notation in `AbcEditor`
2. **State Update**: `appStore.setNotation()` updates global state
3. **Parsing**: `AbcNotationViewer` uses abcjs to render sheet music
4. **Timing Extraction**: `AbcPlaybackController` extracts timing data via abcjs
5. **Timeline Creation**: `abcTiming.ts` converts timing events to beat-based `NoteTimeline`
6. **Visualization**: `OtamatoneRoll` renders the piano roll from `noteTimeline`
7. **Playback Sync**: During playback, `currentTime` updates drive cursor/highlight sync

## Key Files

### State (`store/appStore.ts`)

Zustand store containing:

- `notation` - Current ABC notation string
- `noteTimeline` - Parsed beat-based timeline (derived from ABC)
- `currentTime` - Playback position in seconds
- `isPlaying` - Playback state
- `lowestNoteHz` / `highestNoteHz` - Display range for piano roll

Persisted to localStorage: `notation`, frequency range settings.

### Services (`services/abcPlayback.ts`)

`AbcPlaybackController` class that:

- Initializes abcjs rendering and audio synthesis
- Manages playback controls (play, pause, seek, warp)
- Emits timing events and syncs `TimingCallbacks` with the synth
- Handles tempo changes and re-derives timing data

### Utilities (`utils/abcTiming.ts`)

`buildTimingDerivedData()` - Core function that transforms abcjs timing events into:

- `NoteTimeline` - Beat-based note data (invariant to tempo)
- `NoteCharTimeMap` - Maps character positions to time (for cursor sync)
- `secondsPerBeat` - Current tempo for playback conversion

### Types (`types/music.ts`)

Core domain types:

- `Note` - Single note with pitch (MIDI), startBeat, durationBeats, velocity
- `NoteTimeline` - Collection of notes with total duration and measure info
- `NotePlaybackEvent` - Real-time event emitted during playback

### Components

| Component               | Purpose                                                         |
| ----------------------- | --------------------------------------------------------------- |
| `App.tsx`               | Root component, header with frequency controls, audio container |
| `DockviewLayout.tsx`    | Resizable panel layout (Editor, Preview, Roll)                  |
| `AbcEditor.tsx`         | Textarea for ABC notation input                                 |
| `AbcNotationViewer.tsx` | Sheet music renderer using abcjs                                |
| `OtamatoneRoll.tsx`     | Canvas-based piano roll visualization                           |

## Testing Strategy

- **Unit tests** (`*.test.ts`): Pure functions in `utils/` and `hooks/`
- **Integration tests** (`tests/browser/`): Browser-based tests that run real abcjs parsing with actual `.abc` fixture files

Run tests:

```bash
npm run test           # jsdom unit tests
npm run test:browser   # Chromium integration tests
```

## Design Decisions

### Why beats instead of seconds?

Storing timing in beats decouples the musical structure from tempo. When the user changes playback speed (warp), only `secondsPerBeat` needs to update—the `NoteTimeline` remains unchanged.

### Why Zustand?

Lightweight state management that works well with React. The store is the single source of truth, avoiding prop drilling between Editor, Viewer, and Roll components.

### Why Dockview?

Provides a VS Code-like panel layout where users can resize, rearrange, or hide panels. Layout is persisted to localStorage.

## Extension Points

To add new features:

- **New panel**: Add component in `components/`, register in `DockviewLayout.tsx`
- **New store state**: Add to `AppState` interface in `appStore.ts`
- **New ABC processing**: Extend `buildTimingDerivedData()` in `abcTiming.ts`
- **New visualization**: Read from `noteTimeline` in store, convert beats to pixels
