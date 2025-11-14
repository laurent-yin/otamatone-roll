import { useState } from 'react';
import { DockviewLayout } from './components/DockviewLayout';
import { DEFAULT_ABC_NOTATION } from './constants/abc-notation';

const App = () => {
  const [notation, setNotation] = useState(DEFAULT_ABC_NOTATION);

  return (
    <div className="app">
      <header className="app-header">
        <h1>Otamatone Roll</h1>
        <p>ABC Notation Editor & Renderer</p>
      </header>
      <main className="app-main">
        <DockviewLayout notation={notation} onNotationChange={setNotation} />
      </main>
    </div>
  );
};

export default App;
