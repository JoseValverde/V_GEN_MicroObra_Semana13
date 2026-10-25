// CompaeAudioAnalyzer.js
// Librería standalone de análisis de audio en tiempo real (Web Audio API).
// Sin dependencias externas — funciona en cualquier página o app web (vanilla JS,
// p5.js, three.js, React, etc). Fuente: micrófono, entrada de línea o dispositivo
// virtual (BlackHole, VB-Cable, Loopback…).
//
// Ver README.md para la documentación completa de la API.
//
// — Uso básico —
//
//   await CompaeAudioAnalyzer.start();
//   await CompaeAudioAnalyzer.start({ deviceId, sensitivity: 0.5, cooldown: 15 });
//
//   // Para ver los dispositivos disponibles (útil en consola):
//   CompaeAudioAnalyzer.listDevices().then(console.table);
//
//   // En el loop de animación (requestAnimationFrame, draw(), etc.):
//   const { bass, mids, highs, kick } = CompaeAudioAnalyzer.get(smoothing);
//   // smoothing: 0.0 = señal cruda  |  1.0 = muy suavizada
//
//   // O acceso directo (requiere llamar update() o get() antes):
//   CompaeAudioAnalyzer.bass      // graves     0.0–1.0
//   CompaeAudioAnalyzer.mids      // medios     0.0–1.0
//   CompaeAudioAnalyzer.highs     // agudos     0.0–1.0
//   CompaeAudioAnalyzer.kick      // bombo      true solo el frame del golpe
//   CompaeAudioAnalyzer.kickLevel // nivel crudo de la banda del kick (sin smoothing)
//
//   // Al terminar (SPA, cambio de vista, etc.): libera micrófono y AudioContext
//   CompaeAudioAnalyzer.stop();
//
//   // Panel de debug: pulsar [A] — incluye controles de rango y sensibilidad

const CompaeAudioAnalyzer = (() => {

  // — Configuración interna —
  const FFT_SIZE           = 2048;
  const ANALYSER_SMOOTHING = 0.85;

  // Bandas de frecuencia (Hz) — mutables desde el panel
  // floor/ceil: clip de la señal cruda → remapeado a 0–1
  let BANDS = {
    bass:  { lo: 20,   hi: 250,   floor: 0.0, ceil: 1.0 },
    mids:  { lo: 250,  hi: 4000,  floor: 0.0, ceil: 1.0 },
    highs: { lo: 4000, hi: 20000, floor: 0.0, ceil: 1.0 },
    kick:  { lo: 40,   hi: 120,   floor: 0.0, ceil: 1.0 },
  };

  // Estado interno
  let _ctx, _analyser, _data, _bufLen, _stream;
  let _kickThreshold = 0.5;
  let _kickCooldown  = 20;
  let _kickTimer     = 0;
  let _prevKickBand  = 0;
  let _ready         = false;

  // Panel
  let _panel     = null;
  let _showPanel = false;
  let _els       = {};   // referencias a elementos del panel

  // Valores de salida
  let bass      = 0;
  let mids      = 0;
  let highs     = 0;
  let kick      = false;
  let kickLevel = 0;

  // — Utilidades —

  function _lerp(a, b, t) { return a + (b - a) * t; }

  // Remap señal cruda [floor,ceil] → [0,1], con clip
  function _normalize(raw, floor, ceil) {
    if (ceil <= floor) return 0;
    return Math.min(1, Math.max(0, (raw - floor) / (ceil - floor)));
  }

  function _binForHz(hz) {
    return Math.round(hz * FFT_SIZE / _ctx.sampleRate);
  }

  function _bandEnergy(loHz, hiHz) {
    const lo = Math.max(0, _binForHz(loHz));
    const hi = Math.min(_bufLen - 1, _binForHz(hiHz));
    let sum = 0;
    for (let i = lo; i <= hi; i++) sum += _data[i];
    return sum / ((hi - lo + 1) * 255);
  }

  // — Panel de debug —

  function _css(el, styles) {
    Object.assign(el.style, styles);
  }

  function _createPanel() {
    const panel = document.createElement('div');
    _css(panel, {
      position: 'fixed', bottom: '24px', right: '24px',
      background: 'rgb(40,30,54)',            // opaco: el panel del generador no se transparenta
      border: '1px solid rgba(190,123,192,0.3)',
      borderRadius: '10px',
      padding: '18px 20px',
      fontFamily: 'monospace',
      fontSize: '11px',
      color: '#f0f6fd',
      width: '320px',
      zIndex: '100',
      display: 'none',
      userSelect: 'none',
    });

    // Título
    const title = document.createElement('div');
    title.textContent = 'COMPAE AUDIO ANALYZER';
    _css(title, { letterSpacing: '2px', fontSize: '10px', color: '#76eee9', marginBottom: '14px' });
    panel.appendChild(title);

    // — Filas de banda —
    const bandDefs = [
      { key: 'bass',  label: 'BASS',  color: '#855999', max: 1000  },
      { key: 'mids',  label: 'MIDS',  color: '#e1a4d3', max: 8000  },
      { key: 'highs', label: 'HIGHS', color: '#76eee9', max: 20000 },
    ];

    bandDefs.forEach(({ key, label, color, max }) => {
      const wrap = document.createElement('div');
      _css(wrap, { marginBottom: '12px' });

      // Fila superior: label + barra de nivel
      const row1 = document.createElement('div');
      _css(row1, { display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '4px' });

      const lbl = document.createElement('span');
      lbl.textContent = label;
      _css(lbl, { width: '34px', color, fontSize: '10px', letterSpacing: '1px' });

      const track = document.createElement('div');
      _css(track, { flex: '1', height: '7px', background: 'rgba(255,255,255,0.08)', borderRadius: '4px', overflow: 'hidden' });

      const bar = document.createElement('div');
      _css(bar, { height: '100%', width: '0%', background: color, borderRadius: '4px', transition: 'width 0.04s linear' });
      track.appendChild(bar);
      _els[key + '_bar'] = bar;

      row1.appendChild(lbl);
      row1.appendChild(track);
      wrap.appendChild(row1);

      // Fila 2: rango de frecuencia (Hz)
      const row2 = document.createElement('div');
      _css(row2, { display: 'flex', alignItems: 'center', gap: '6px', paddingLeft: '42px', marginBottom: '3px' });

      const loInput = _numInput(BANDS[key].lo, 20, max, v => { BANDS[key].lo = v; });
      const sep1    = document.createElement('span');
      sep1.textContent = '—';
      _css(sep1, { color: 'rgba(249,233,235,0.6)' });
      const hiInput = _numInput(BANDS[key].hi, 20, max, v => { BANDS[key].hi = v; });
      const unit    = document.createElement('span');
      unit.textContent = 'Hz';
      _css(unit, { color: 'rgba(249,233,235,0.6)', fontSize: '10px' });

      row2.appendChild(loInput);
      row2.appendChild(sep1);
      row2.appendChild(hiInput);
      row2.appendChild(unit);
      wrap.appendChild(row2);

      // Fila 3a: floor (mínimo de clip)
      const row3a = document.createElement('div');
      _css(row3a, { display: 'flex', alignItems: 'center', gap: '6px', paddingLeft: '42px', marginBottom: '2px' });
      const floorLbl = document.createElement('span');
      floorLbl.textContent = 'min';
      _css(floorLbl, { color: 'rgba(240,246,253,0.7)', fontSize: '10px', width: '24px' });
      const floorSlider = _rangeInput(BANDS[key].floor, 0, 1, 0.01, color, v => { BANDS[key].floor = v; });
      row3a.appendChild(floorLbl);
      row3a.appendChild(floorSlider.el);
      row3a.appendChild(floorSlider.val);
      wrap.appendChild(row3a);

      // Fila 3b: ceil (máximo de clip)
      const row3b = document.createElement('div');
      _css(row3b, { display: 'flex', alignItems: 'center', gap: '6px', paddingLeft: '42px' });
      const ceilLbl = document.createElement('span');
      ceilLbl.textContent = 'max';
      _css(ceilLbl, { color: 'rgba(240,246,253,0.7)', fontSize: '10px', width: '24px' });
      const ceilSlider = _rangeInput(BANDS[key].ceil, 0, 1, 0.01, color, v => { BANDS[key].ceil = v; });
      row3b.appendChild(ceilLbl);
      row3b.appendChild(ceilSlider.el);
      row3b.appendChild(ceilSlider.val);
      wrap.appendChild(row3b);

      panel.appendChild(wrap);
    });

    // Separador
    const hr = document.createElement('div');
    _css(hr, { height: '1px', background: 'rgba(167,193,229,0.15)', margin: '10px 0' });
    panel.appendChild(hr);

    // — Sección KICK —
    const kickTitle = document.createElement('div');
    kickTitle.textContent = 'KICK';
    _css(kickTitle, { color: '#be7bc0', fontSize: '10px', letterSpacing: '1px', marginBottom: '8px' });
    panel.appendChild(kickTitle);

    // Barra de nivel + umbral
    const kickTrack = document.createElement('div');
    _css(kickTrack, { position: 'relative', height: '7px', background: 'rgba(255,255,255,0.08)', borderRadius: '4px', marginBottom: '8px', overflow: 'visible' });

    const kickLevelBar = document.createElement('div');
    _css(kickLevelBar, { position: 'absolute', top: '0', left: '0', height: '100%', width: '0%', background: 'rgba(249,233,235,0.35)', borderRadius: '4px' });

    const kickFlash = document.createElement('div');
    _css(kickFlash, { position: 'absolute', top: '0', left: '0', height: '100%', width: '0%', background: '#be7bc0', borderRadius: '4px' });

    const kickThreshLine = document.createElement('div');
    _css(kickThreshLine, { position: 'absolute', top: '-4px', width: '2px', height: '15px', background: '#855999', borderRadius: '1px', left: (_kickThreshold * 100) + '%' });

    kickTrack.appendChild(kickLevelBar);
    kickTrack.appendChild(kickFlash);
    kickTrack.appendChild(kickThreshLine);
    panel.appendChild(kickTrack);
    _els.kick_level = kickLevelBar;
    _els.kick_flash = kickFlash;
    _els.kick_thresh = kickThreshLine;

    // Controles de rango kick
    const kickRangeRow = document.createElement('div');
    _css(kickRangeRow, { display: 'flex', alignItems: 'center', gap: '6px', marginBottom: '8px' });
    const krLbl = document.createElement('span');
    krLbl.textContent = 'Rango';
    _css(krLbl, { color: 'rgba(249,233,235,0.8)', fontSize: '10px', width: '52px', flexShrink: '0' });
    const krSep = document.createElement('span');
    krSep.textContent = '—';
    _css(krSep, { color: 'rgba(249,233,235,0.6)' });
    const krUnit = document.createElement('span');
    krUnit.textContent = 'Hz';
    _css(krUnit, { color: 'rgba(249,233,235,0.6)', fontSize: '10px' });
    kickRangeRow.appendChild(krLbl);
    kickRangeRow.appendChild(_numInput(BANDS.kick.lo, 20,  500, v => { BANDS.kick.lo = v; }));
    kickRangeRow.appendChild(krSep);
    kickRangeRow.appendChild(_numInput(BANDS.kick.hi, 40, 1000, v => { BANDS.kick.hi = v; }));
    kickRangeRow.appendChild(krUnit);
    panel.appendChild(kickRangeRow);

    // Mín. y máx. del kick (clip de la señal antes de normalizar), como en las otras bandas
    [['min', 'floor'], ['max', 'ceil']].forEach(([txt, field]) => {
      const row = document.createElement('div');
      _css(row, { display: 'flex', alignItems: 'center', gap: '6px', marginBottom: '6px' });
      const lbl = document.createElement('span');
      lbl.textContent = txt;
      _css(lbl, { color: 'rgba(249,233,235,0.8)', fontSize: '10px', width: '52px', flexShrink: '0' });
      const sl = _rangeInput(BANDS.kick[field], 0, 1, 0.01, '#be7bc0', v => { BANDS.kick[field] = v; });
      row.appendChild(lbl); row.appendChild(sl.el); row.appendChild(sl.val);
      panel.appendChild(row);
    });

    // Slider de sensibilidad
    const sensRow = document.createElement('div');
    _css(sensRow, { display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '8px' });
    const sensLbl = document.createElement('span');
    sensLbl.textContent = 'Sensib.';
    _css(sensLbl, { color: 'rgba(249,233,235,0.8)', fontSize: '10px', width: '52px', flexShrink: '0' });
    const sensSlider = document.createElement('input');
    sensSlider.type = 'range'; sensSlider.min = '0'; sensSlider.max = '1'; sensSlider.step = '0.01';
    sensSlider.value = String(_kickThreshold);
    _css(sensSlider, { flex: '1', accentColor: '#855999', cursor: 'pointer' });
    const sensVal = document.createElement('span');
    sensVal.textContent = _kickThreshold.toFixed(2);
    _css(sensVal, { color: '#f0f6fd', width: '30px', textAlign: 'right', fontSize: '10px' });
    sensSlider.addEventListener('input', () => {
      _kickThreshold = parseFloat(sensSlider.value);
      sensVal.textContent = _kickThreshold.toFixed(2);
    });
    sensRow.appendChild(sensLbl);
    sensRow.appendChild(sensSlider);
    sensRow.appendChild(sensVal);
    panel.appendChild(sensRow);

    // Cooldown
    const coolRow = document.createElement('div');
    _css(coolRow, { display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '14px' });
    const coolLbl = document.createElement('span');
    coolLbl.textContent = 'Cooldown';
    _css(coolLbl, { color: 'rgba(249,233,235,0.8)', fontSize: '10px', width: '52px', flexShrink: '0' });
    const coolInput = _numInput(_kickCooldown, 1, 120, v => { _kickCooldown = v; }, 5);
    const coolUnit = document.createElement('span');
    coolUnit.textContent = 'frames';
    _css(coolUnit, { color: 'rgba(249,233,235,0.6)', fontSize: '10px' });
    coolRow.appendChild(coolLbl);
    coolRow.appendChild(coolInput);
    coolRow.appendChild(coolUnit);
    panel.appendChild(coolRow);

    // Hint
    const hint = document.createElement('div');
    hint.textContent = '[A] cerrar';
    _css(hint, { fontSize: '9px', color: 'rgba(249,233,235,0.25)', letterSpacing: '1px' });
    panel.appendChild(hint);

    document.body.appendChild(panel);
    return panel;
  }

  // Slider reutilizable — devuelve { el, val } (slider + etiqueta de valor)
  function _rangeInput(val, min, max, step, color, onChange) {
    const slider = document.createElement('input');
    slider.type = 'range'; slider.min = min; slider.max = max;
    slider.step = step; slider.value = val;
    _css(slider, { flex: '1', accentColor: color, cursor: 'pointer' });

    const label = document.createElement('span');
    label.textContent = val.toFixed(2);
    _css(label, { color: '#f0f6fd', fontSize: '10px', width: '30px', textAlign: 'right', flexShrink: '0' });

    slider.addEventListener('input', () => {
      const v = parseFloat(slider.value);
      label.textContent = v.toFixed(2);
      onChange(v);
    });
    return { el: slider, val: label };
  }

  // Input numérico reutilizable
  // estilo que no se puede poner en línea: sin flechas en las cajas de número (tapaban las cifras)
  function _injectStyle() {
    if (document.getElementById('compae-aa-style')) return;
    const st = document.createElement('style');
    st.id = 'compae-aa-style';
    st.textContent = '.compae-num::-webkit-inner-spin-button,.compae-num::-webkit-outer-spin-button{-webkit-appearance:none;margin:0}.compae-num{-moz-appearance:textfield;appearance:textfield}';
    document.head.appendChild(st);
  }

  function _numInput(val, min, max, onChange, width = 7) {
    _injectStyle();
    const input = document.createElement('input');
    input.type = 'number'; input.min = min; input.max = max; input.value = val;
    input.className = 'compae-num';
    _css(input, {
      width: width + 'ch', background: 'rgba(255,255,255,0.07)',
      border: '1px solid rgba(167,193,229,0.2)', borderRadius: '4px',
      color: '#f0f6fd', fontFamily: 'monospace', fontSize: '11px',
      padding: '1px 4px', textAlign: 'center', outline: 'none',
    });
    input.addEventListener('change', () => {
      const v = Math.min(max, Math.max(min, parseFloat(input.value) || 0));
      input.value = v;
      onChange(v);
    });
    return input;
  }

  function _updatePanel() {
    if (!_panel || !_showPanel) return;
    _els.bass_bar.style.width   = (bass  * 100).toFixed(1) + '%';
    _els.mids_bar.style.width   = (mids  * 100).toFixed(1) + '%';
    _els.highs_bar.style.width  = (highs * 100).toFixed(1) + '%';
    _els.kick_level.style.width = (kickLevel * 100).toFixed(1) + '%';
    _els.kick_thresh.style.left = (_kickThreshold * 100).toFixed(1) + '%';
    _els.kick_flash.style.width = kick ? '100%' : '0%';
  }

  function _togglePanel() {
    if (!_panel) _panel = _createPanel();
    _showPanel = !_showPanel;
    _panel.style.display = _showPanel ? 'block' : 'none';
  }

  window.addEventListener('keydown', e => {
    if (e.key === 'a' || e.key === 'A') _togglePanel();
  });

  // — API pública —

  async function listDevices() {
    const permStream = await navigator.mediaDevices.getUserMedia({ audio: true });
    const devices = await navigator.mediaDevices.enumerateDevices();
    permStream.getTracks().forEach(t => t.stop()); // liberar el micrófono, solo era para permisos
    return devices.filter(d => d.kind === 'audioinput');
  }

  // deviceId, sensitivity y cooldown → ver README.md
  // Devuelve true si pudo iniciar, false si falló (permiso denegado, sin dispositivo, etc.)
  async function start({ deviceId, sensitivity = 0.5, cooldown = 20 } = {}) {
    if (_ready) stop(); // permite re-iniciar (p.ej. cambiar de dispositivo) sin fugas

    _kickThreshold = sensitivity;
    _kickCooldown  = cooldown;

    const audioConstraints = {
      echoCancellation: false,
      noiseSuppression: false,
      autoGainControl:  false,
    };
    if (deviceId) audioConstraints.deviceId = { exact: deviceId };

    try {
      _stream   = await navigator.mediaDevices.getUserMedia({ audio: audioConstraints });
      _ctx      = new AudioContext();
      if (_ctx.state === 'suspended') await _ctx.resume(); // algunos navegadores lo crean suspendido
      _analyser = _ctx.createAnalyser();
      _analyser.fftSize = FFT_SIZE;
      _analyser.smoothingTimeConstant = ANALYSER_SMOOTHING;
      _bufLen   = _analyser.frequencyBinCount;
      _data     = new Uint8Array(_bufLen);
      _ctx.createMediaStreamSource(_stream).connect(_analyser);
      _ready = true;
      console.log('[CompaeAudioAnalyzer] Listo —', _stream.getAudioTracks()[0].label);
      return true;
    } catch (e) {
      console.warn('[CompaeAudioAnalyzer] No se pudo iniciar:', e.message);
      return false;
    }
  }

  // Libera el micrófono y cierra el AudioContext. Seguro de llamar aunque no esté iniciado.
  function stop() {
    if (_stream) _stream.getTracks().forEach(t => t.stop());
    if (_ctx && _ctx.state !== 'closed') _ctx.close();
    _ctx = _analyser = _data = _stream = undefined;
    _ready        = false;
    _kickTimer    = 0;
    _prevKickBand = 0;
    bass = mids = highs = kickLevel = 0;
    kick = false;
    _updatePanel();
  }

  function update(smoothing = 0.1) {
    if (!_ready) return;
    _analyser.getByteFrequencyData(_data);

    const rawBass  = _normalize(_bandEnergy(BANDS.bass.lo,  BANDS.bass.hi),  BANDS.bass.floor,  BANDS.bass.ceil);
    const rawMids  = _normalize(_bandEnergy(BANDS.mids.lo,  BANDS.mids.hi),  BANDS.mids.floor,  BANDS.mids.ceil);
    const rawHighs = _normalize(_bandEnergy(BANDS.highs.lo, BANDS.highs.hi), BANDS.highs.floor, BANDS.highs.ceil);
    bass  = _lerp(bass,  rawBass,  smoothing);
    mids  = _lerp(mids,  rawMids,  smoothing);
    highs = _lerp(highs, rawHighs, smoothing);

    // el kick también pasa por su mín./máx. (con 0 y 1, igual que antes)
    kickLevel    = _normalize(_bandEnergy(BANDS.kick.lo, BANDS.kick.hi), BANDS.kick.floor, BANDS.kick.ceil);
    _kickTimer   = Math.max(0, _kickTimer - 1);
    kick = kickLevel > _kickThreshold && _prevKickBand <= _kickThreshold && _kickTimer === 0;
    if (kick) _kickTimer = _kickCooldown;
    _prevKickBand = kickLevel;

    _updatePanel();
  }

  function get(smoothing = 0.1) {
    update(smoothing);
    return { bass, mids, highs, kick };
  }

  // Copia de las bandas actuales (Hz + floor/ceil de clip) — lectura segura,
  // no expone la referencia interna.
  function getBands() {
    return JSON.parse(JSON.stringify(BANDS));
  }

  // Actualiza uno o más campos (lo/hi/floor/ceil) de una banda en caliente,
  // sin reiniciar el AudioContext. band: 'bass'|'mids'|'highs'|'kick'.
  function setBandRange(band, cfg = {}) {
    if (!BANDS[band]) return;
    if (cfg.lo    !== undefined) BANDS[band].lo    = cfg.lo;
    if (cfg.hi    !== undefined) BANDS[band].hi    = cfg.hi;
    if (cfg.floor !== undefined) BANDS[band].floor = cfg.floor;
    if (cfg.ceil  !== undefined) BANDS[band].ceil  = cfg.ceil;
  }

  return {
    start,
    stop,
    update,
    get,
    listDevices,
    getBands,
    setBandRange,
    get bass()      { return bass;      },
    get mids()      { return mids;      },
    get highs()     { return highs;     },
    get kick()      { return kick;      },
    get kickLevel() { return kickLevel; },
    get ready()     { return _ready;    },
  };

})();

// — Exportación universal —
// <script src="CompaeAudioAnalyzer.js"> clásico  → usar el global `CompaeAudioAnalyzer`
// CommonJS (Node, bundlers)                      → const CompaeAudioAnalyzer = require('./CompaeAudioAnalyzer.js')
// ESM (bundlers)                                  → ver CompaeAudioAnalyzer.esm.js
if (typeof module !== 'undefined' && module.exports) {
  module.exports = CompaeAudioAnalyzer;
}
if (typeof window !== 'undefined') {
  window.CompaeAudioAnalyzer = CompaeAudioAnalyzer;
}
