import { JSDOM } from 'jsdom';
import abcjs from 'abcjs';

const dom = new JSDOM('<!DOCTYPE html><div id="abc"></div>');
globalThis.window = dom.window;
globalThis.document = dom.window.document;
globalThis.navigator = dom.window.navigator;

const notation = `X:1\nT:Pickup Test\nM:4/4\nL:1/4\nQ:1/4=120\nK:C\nabcd || e4- eedf- | f4`;

const visualObjs = abcjs.renderAbc('abc', notation, { responsive: 'resize' });
const visualObj = visualObjs[0];
const timingCallbacks = new abcjs.TimingCallbacks(visualObj, {});
console.log(
  'Timing events:',
  (timingCallbacks.noteTimings ?? []).map((event) => ({
    type: event?.type,
    milliseconds: event?.milliseconds,
    barNumber: event?.barNumber,
    startChar: event?.startChar,
  }))
);
