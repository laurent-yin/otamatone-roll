import { AbcNotationViewer } from './components/AbcNotationViewer';
import { DEFAULT_ABC_NOTATION } from './constants/abc-notation';

const App = () => {
  return (
    <div className="app">
      <header className="app-header">
        <h1>Otamatone Roll</h1>
        <p>ABC Notation Renderer</p>
      </header>
      <main className="app-main">
        <AbcNotationViewer notation={DEFAULT_ABC_NOTATION} />
      </main>
    </div>
  );
};

export default App;
