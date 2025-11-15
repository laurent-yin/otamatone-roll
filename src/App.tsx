import { useState } from 'react';
import { DockviewLayout } from './components/DockviewLayout';
import { DEFAULT_ABC_NOTATION } from './constants/abc-notation';

const App = () => {
  const [notation, setNotation] = useState(DEFAULT_ABC_NOTATION);
  const [currentTime, setCurrentTime] = useState(0);
  const [isPlaying, setIsPlaying] = useState(false);

  return (
    <div className="app">
      <header className="app-header">
        <h1>Otamatone Roll</h1>
        <p>ABC Notation Editor & Renderer</p>
      </header>
      <main className="app-main">
        <DockviewLayout
          notation={notation}
          onNotationChange={setNotation}
          currentTime={currentTime}
          isPlaying={isPlaying}
          onCurrentTimeChange={setCurrentTime}
          onPlayingChange={setIsPlaying}
        />
      </main>
    </div>
  );
};

export default App;
