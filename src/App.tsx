import React, { useEffect } from 'react';
import abcjs from 'abcjs';

const abc: string = `X:1
T:Notes / pitches
M:C
L:1/4
K:C treble
C, D, E, F, | G, A, B, C | D E F G | A B c d | e f g a | b c' d' e' | f' g' a' b' |]`;

const App: React.FC = () => {
  useEffect(() => {
    abcjs.renderAbc('abcjs-container', abc);
  }, []);

  return (
    <div>
      <h1>Otamatone Roll</h1>
      <div id="abcjs-container"></div>
    </div>
  );
};

export default App;
