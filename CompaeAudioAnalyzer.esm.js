// CompaeAudioAnalyzer.esm.js
// Wrapper ESM para bundlers (Vite, webpack, Rollup, etc.) que permite:
//   import CompaeAudioAnalyzer from './CompaeAudioAnalyzer.esm.js';
//
// Internamente carga CompaeAudioAnalyzer.js (que se apoya en window/module.exports)
// y reexporta el mismo objeto singleton — no hay lógica duplicada.

import './CompaeAudioAnalyzer.js';

export default window.CompaeAudioAnalyzer;
