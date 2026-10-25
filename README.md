# CompaeAudioAnalyzer

Librería standalone de análisis de audio en tiempo real para la web, construida sobre la **Web Audio API**. Sin dependencias externas, sin build step: un único archivo `.js` que expone niveles normalizados de graves, medios y agudos, más detección de golpe de bombo (kick), listos para conectar a cualquier visual, animación o lógica de una app web.

Pensada para reutilizarse tal cual en cualquier proyecto: sketches p5.js, three.js, Canvas 2D, React/Vue, o vanilla JS puro.

---

## Contenido del repositorio

```text
CompaeAudioAnalyzer.js       — la librería (única dependencia real)
CompaeAudioAnalyzer.esm.js   — wrapper para import ESM en bundlers
demo.html                    — ejemplo mínimo funcionando (barras de nivel)
README.md                    — este archivo
```

---

## Instalación

No hay `npm install`: es un archivo que se copia al proyecto.

### Opción A — `<script>` clásico (recomendado para prototipos y sketches)

```html
<script src="CompaeAudioAnalyzer.js"></script>
<script>
  // CompaeAudioAnalyzer ya está disponible como global (window.CompaeAudioAnalyzer)
</script>
```

### Opción B — ESM / bundler (Vite, webpack, Rollup…)

```js
import CompaeAudioAnalyzer from './CompaeAudioAnalyzer.esm.js';
```

### Opción C — CommonJS

```js
const CompaeAudioAnalyzer = require('./CompaeAudioAnalyzer.js');
```

---

## Requisitos

- **HTTPS o `localhost`**: `getUserMedia` (acceso al micrófono) no funciona en `http://` servido desde una IP/dominio remoto por política del navegador. Abrir el archivo directamente desde disco (`file://`) también funciona en la mayoría de navegadores.
- **Permiso de micrófono**: el navegador pedirá permiso la primera vez que se llame a `start()`. Debe concederse para que la librería funcione.
- **Gesto del usuario recomendado**: algunos navegadores (Safari sobre todo) exigen que `start()` se llame dentro de un handler de click/tap para poder arrancar el `AudioContext`. Ver [demo.html](demo.html) para el patrón recomendado (botón "Activar micrófono").
- **Sin micrófono físico**: para capturar el audio que reproduce el propio ordenador (p.ej. música de Spotify, un DAW, etc.) hace falta un dispositivo virtual configurado como entrada por defecto del sistema:
  - macOS: [BlackHole](https://github.com/ExistentialAudio/BlackHole) o Loopback
  - Windows: [VB-Cable](https://vb-audio.com/Cable/)

---

## Quick start

```html
<script src="CompaeAudioAnalyzer.js"></script>
<script>
  document.getElementById('startBtn').addEventListener('click', async () => {
    const ok = await CompaeAudioAnalyzer.start({ sensitivity: 0.5, cooldown: 20 });
    if (!ok) return console.warn('No se pudo acceder al micrófono');
    requestAnimationFrame(loop);
  });

  function loop() {
    const { bass, mids, highs, kick } = CompaeAudioAnalyzer.get(0.1);
    // bass, mids, highs → 0.0–1.0 (suavizados)
    // kick              → true solo en el frame exacto del golpe
    requestAnimationFrame(loop);
  }
</script>
```

Ver [demo.html](demo.html) para un ejemplo completo y funcional (barras de nivel en vivo, sin dependencias de canvas ni frameworks).

---

## Referencia de la API

### `CompaeAudioAnalyzer.start(opciones?)`

Pide permiso de micrófono, crea el `AudioContext` y arranca el análisis. Devuelve una `Promise<boolean>`: `true` si pudo iniciar, `false` si falló (permiso denegado, dispositivo no encontrado, etc. — el error concreto se loguea en consola con `console.warn`).

Es seguro llamarla más de una vez (por ejemplo para cambiar de dispositivo en caliente): internamente libera el stream y el contexto anteriores antes de reiniciar.

```js
await CompaeAudioAnalyzer.start({
  deviceId:    undefined, // string — ver listDevices() más abajo
  sensitivity: 0.5,       // 0.0–1.0 — umbral de detección del kick
  cooldown:    20,        // frames mínimos entre kicks consecutivos
});
```

| Opción | Tipo | Default | Descripción |
| --- | --- | --- | --- |
| `deviceId` | `string` | `undefined` | ID del dispositivo de entrada de audio. Si se omite, usa el dispositivo por defecto del sistema. |
| `sensitivity` | `number` | `0.5` | Umbral (0–1) que debe superar la banda del kick para disparar una detección. Más bajo = más sensible. |
| `cooldown` | `number` | `20` | Frames mínimos de espera entre dos detecciones de kick consecutivas (evita múltiples disparos por un mismo golpe). |

### `CompaeAudioAnalyzer.stop()`

Libera el micrófono (detiene los tracks del `MediaStream`) y cierra el `AudioContext`. Resetea todos los valores a 0/`false`. Es seguro llamarla incluso si no se había iniciado.

Imprescindible en apps de una sola página (SPA) donde el componente que usa el analizador puede desmontarse — sin esto el navegador sigue mostrando el indicador de "usando el micrófono" indefinidamente.

```js
CompaeAudioAnalyzer.stop();
```

### `CompaeAudioAnalyzer.get(smoothing?)`

Actualiza el análisis y devuelve los valores en un solo objeto. Es la forma recomendada de leer datos en cada frame.

```js
const { bass, mids, highs, kick } = CompaeAudioAnalyzer.get(0.1);
```

| Parámetro | Tipo | Default | Descripción |
| --- | --- | --- | --- |
| `smoothing` | `number` | `0.1` | Coeficiente de interpolación (lerp) frame a frame para `bass`/`mids`/`highs`. `0.0` = señal cruda y nerviosa. `~0.1` = suavizado ligero, recomendado para animación. `0.5` = muy suavizado, reacciona lento. `1.0` = valor congelado, no usar. |

### `CompaeAudioAnalyzer.update(smoothing?)`

Igual que `get()` pero sin devolver nada — usar junto a las propiedades directas de abajo cuando conviene separar "actualizar" de "leer" (p.ej. actualizar una vez por frame y leer en varios sitios distintos del código).

```js
CompaeAudioAnalyzer.update(0.1);
// ...en cualquier otro punto del mismo frame:
const v = CompaeAudioAnalyzer.bass;
```

### `CompaeAudioAnalyzer.listDevices()`

Pide permiso de micrófono (si aún no se concedió) y devuelve la lista de dispositivos de entrada de audio disponibles. Útil en consola para obtener el `deviceId` a pasar en `start()`.

```js
CompaeAudioAnalyzer.listDevices().then(console.table);
// → luego:
CompaeAudioAnalyzer.start({ deviceId: '<id copiado de la tabla>' });
```

### `CompaeAudioAnalyzer.getBands()`

Devuelve una copia de solo lectura de las bandas actuales: rango en Hz (`lo`/`hi`) y clip (`floor`/`ceil`, 0–1) de `bass`, `mids`, `highs` y `kick`. Sirve para guardar la calibración dentro de un preset.

```js
const bands = CompaeAudioAnalyzer.getBands();
// → { bass: {lo, hi, floor, ceil}, mids: {...}, highs: {...}, kick: {...} }
```

### `CompaeAudioAnalyzer.setBandRange(banda, cfg)`

Cambia en caliente uno o más campos (`lo`, `hi`, `floor`, `ceil`) de una banda, sin reiniciar el `AudioContext` ni volver a pedir el micrófono. `banda` es `'bass'`, `'mids'`, `'highs'` o `'kick'`. Sirve para aplicar la calibración guardada en un preset.

```js
CompaeAudioAnalyzer.setBandRange('kick', { lo: 45, hi: 110, floor: 0.2 });
```

> En los generadores LA_VIN_K se llama a `start()` una sola vez (botón «activar micrófono») y la calibración de cada preset se aplica con `setBandRange()`. Volver a llamar a `start()` cierra el micrófono y, abierto desde `file://`, Chrome vuelve a pedir permiso.

### Propiedades de solo lectura

Reflejan el último valor calculado por `update()`/`get()`. Útiles para leer el estado desde múltiples lugares del código sin volver a llamar a `get()`.

| Propiedad | Tipo | Descripción |
| --- | --- | --- |
| `CompaeAudioAnalyzer.bass` | `number` | Graves, suavizados, `0.0–1.0` |
| `CompaeAudioAnalyzer.mids` | `number` | Medios, suavizados, `0.0–1.0` |
| `CompaeAudioAnalyzer.highs` | `number` | Agudos, suavizados, `0.0–1.0` |
| `CompaeAudioAnalyzer.kick` | `boolean` | `true` únicamente en el frame exacto en que se detecta un golpe |
| `CompaeAudioAnalyzer.kickLevel` | `number` | Nivel de la banda del kick, sin smoothing, remapeado con su `floor`/`ceil` a 0–1 (como las otras bandas). La detección compara este nivel con `sensitivity` |
| `CompaeAudioAnalyzer.ready` | `boolean` | `true` una vez `start()` completó con éxito |

---

## Bandas de frecuencia

Por defecto:

| Señal | Rango | Descripción |
| --- | --- | --- |
| `bass` | 20–250 Hz | Graves |
| `mids` | 250–4000 Hz | Medios |
| `highs` | 4000–20000 Hz | Agudos |
| `kick` | 40–120 Hz | Sub-banda de graves usada para detectar golpes de bombo |

Estos rangos, junto con el `floor`/`ceil` de clip de cada banda (remapeo de la señal cruda a 0–1), son ajustables **en vivo desde el panel de monitorización** (ver abajo) — no hace falta tocar código para afinarlos a una fuente de audio concreta.

---

## Panel de monitorización

Pulsar **`[A]`** en cualquier momento muestra/oculta un panel flotante con:

- Barras de nivel en tiempo real de `bass`, `mids`, `highs`
- Controles de rango (Hz) por banda
- Controles de `min`/`max` (floor/ceil) de clip por banda, **también en el kick**
- Nivel, umbral y flash de detección del `kick`
- Sensibilidad y cooldown del kick, ajustables con sliders

Los números (Hz, mín. y máx.) van en cajas anchas sin flechas y en un color claro legible; el color de cada banda queda en su barra y su slider. El panel es opaco.

Todos los cambios se aplican instantáneamente, sin recargar la página. Útil para calibrar la librería contra una fuente de audio real durante el desarrollo.

> El listener de teclado (`keydown`) está activo globalmente en cuanto se carga el script, sin importar si `start()` ya se llamó. Si la app anfitriona usa la tecla `A` para otra cosa, hay conflicto — en ese caso, editar el atajo en la última sección de `CompaeAudioAnalyzer.js` (`window.addEventListener('keydown', ...)`).

---

## Detección de kick — cómo funciona

1. Se calcula la energía normalizada (0–1) de la banda `kick` (40–120 Hz por defecto) en cada frame.
2. Se detecta un **flanco ascendente**: el nivel anterior estaba por debajo del umbral (`sensitivity`) y el actual lo supera.
3. Tras disparar, un contador de `cooldown` frames bloquea nuevas detecciones, evitando que un mismo golpe (que dura varios frames por encima del umbral) dispare varias veces.

Para una fuente con bombo muy marcado, `sensitivity` entre `0.4`–`0.6` y `cooldown` entre `10`–`20` frames suele funcionar bien como punto de partida — ajustar con el panel `[A]` contra el material real.

---

## Ejemplo de integración

### Vanilla JS + Canvas

```html
<canvas id="c"></canvas>
<script src="CompaeAudioAnalyzer.js"></script>
<script>
  const canvas = document.getElementById('c');
  const ctx = canvas.getContext('2d');
  canvas.width = innerWidth; canvas.height = innerHeight;

  document.body.addEventListener('click', () => CompaeAudioAnalyzer.start(), { once: true });

  function loop() {
    const { bass, highs } = CompaeAudioAnalyzer.get(0.15);
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    ctx.beginPath();
    ctx.arc(canvas.width / 2, canvas.height / 2, 50 + bass * 200, 0, Math.PI * 2);
    ctx.lineWidth = 2 + highs * 10;
    ctx.strokeStyle = '#76eee9';
    ctx.stroke();
    requestAnimationFrame(loop);
  }
  loop();
</script>
```

### p5.js

```js
function setup() {
  createCanvas(windowWidth, windowHeight);
  CompaeAudioAnalyzer.start({ sensitivity: 0.55, cooldown: 15 });
}

function draw() {
  const { bass, mids, highs, kick } = CompaeAudioAnalyzer.get(0.1);
  background(13, 10, 22, kick ? 80 : 10);
  // ... usar bass/mids/highs/kick para modular el sketch
}
```

---

## Solución de problemas

| Síntoma | Causa probable | Solución |
| --- | --- | --- |
| `start()` devuelve `false` | Permiso de micrófono denegado, o no hay dispositivo de entrada | Revisar permisos del navegador/sistema operativo para el sitio; probar `listDevices()` en consola |
| No pasa nada al pulsar `[A]` | El foco está en un `<input>` u otro elemento que captura la tecla | Hacer click fuera de cualquier campo de texto antes de pulsar `A` |
| Todos los valores quedan en 0 | `start()` nunca se llamó, o falló silenciosamente | Comprobar el valor devuelto por `start()` y la consola (`console.warn`) |
| Funciona en Chrome pero no en Safari | Safari es más estricto con el gesto de usuario requerido para iniciar audio | Llamar a `start()` dentro de un handler de `click`/`touchstart`, nunca en `setup()`/`onload` automático |
| El indicador de "usando el micrófono" del navegador no desaparece | No se llamó a `stop()` al salir/desmontar la vista | Llamar a `CompaeAudioAnalyzer.stop()` en el cleanup de la app (unmount de componente, cambio de ruta, etc.) |
| Los valores de `kick` nunca son `true` | `sensitivity` demasiado alta para la fuente de audio | Bajar `sensitivity` o ajustar en vivo con el panel `[A]` |

---

## Notas técnicas

- FFT de tamaño `2048`, `smoothingTimeConstant` interno del `AnalyserNode` en `0.85` (suavizado propio del analizador, independiente del parámetro `smoothing` de `get()`/`update()`).
- La energía de cada banda se calcula promediando los bins del espectro (`getByteFrequencyData`, 0–255) correspondientes al rango Hz de la banda, normalizado a 0–1.
- El remapeo `floor`/`ceil` por banda (ajustable en el panel) permite hacer clip de la señal cruda a un sub-rango antes de normalizar — útil cuando una fuente nunca alcanza el máximo teórico o satura fácilmente.
- El objeto expuesto es un **singleton**: solo puede haber una sesión de análisis activa a la vez por página. Para multi-fuente simultánea haría falta instanciar la lógica interna como clase — no es el caso de uso actual de esta librería.

---

## Licencia

Uso libre dentro de los proyectos del autor. Sin dependencias, sin tracking, sin llamadas de red.
