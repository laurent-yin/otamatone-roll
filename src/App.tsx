import { useState } from 'react';
import { DockviewLayout } from './components/DockviewLayout';
import { DEFAULT_ABC_NOTATION } from './constants/abc-notation';
import {
  NoteCharTimeMap,
  NotePlaybackEvent,
  NoteTimeline,
} from './types/music';

const AUDIO_CONTROLS_ID = 'abc-global-audio-controls';

const App = () => {
  const [notation, setNotation] = useState(DEFAULT_ABC_NOTATION);
  const [currentTime, setCurrentTime] = useState(0);
  const [isPlaying, setIsPlaying] = useState(false);
  const [activeNoteEvent, setActiveNoteEvent] =
    useState<NotePlaybackEvent | null>(null);
  const [noteCharTimes, setNoteCharTimes] = useState<NoteCharTimeMap>({});
  const [noteTimeline, setNoteTimeline] = useState<NoteTimeline | null>(null);

  return (
    <div className="app">
      <header className="app-header">
        <div className="app-header-title">
          <h1>Otamatone Roll</h1>
          <p>ABC Notation Editor & Renderer</p>
        </div>
        <div
          id={AUDIO_CONTROLS_ID}
          className="abc-audio-controls app-header-audio-controls"
          aria-label="Audio playback controls"
        />
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
        />
      </main>
    </div>
  );
};

export default App;
