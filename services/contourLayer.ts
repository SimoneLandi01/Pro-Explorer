// --- [MODULAR FEATURE 7] CURVE DI LIVELLO (ISOIPSE) SOVRAPPOSTE A OSM STANDARD ---
// Layer trasparente Leaflet che disegna le curve di livello direttamente nel browser a partire
// dal modello digitale del terreno open-data "Terrarium" (AWS Open Data / Mapzen, gratuito, CORS abilitato).
// - Non modifica in alcun modo la mappa base OSM Standard: si sovrappone come strato separato.
// - Equidistanza automatica in base allo zoom (200 / 100 / 50 / 20 / 10 m) con curve direttrici più marcate.
// - Funziona anche offline: i tasselli DEM passano dal Service Worker (cache-first) e vengono
//   inclusi nei pacchetti "OSM Standard" del Centro Mappe Offline (vedi offlineMapService.getTileUrlsForCoord).

import L from 'leaflet';

export const TERRARIUM_HOST = 'elevation-tiles-prod';
export const buildTerrariumUrl = (z: number, x: number, y: number) =>
  `https://s3.amazonaws.com/elevation-tiles-prod/terrarium/${z}/${x}/${y}.png`;

const TILE = 256;
const MIN_CONTOUR_ZOOM = 11;
const MAX_SOURCE_ZOOM = 14;
const MIN_SOURCE_ZOOM = 9;

// Cache in memoria (LRU semplice) dei tasselli DEM decodificati in metri
const demCache = new Map<string, Promise<Float32Array | null>>();
const DEM_CACHE_MAX = 160;

const decodeTerrarium = async (blob: Blob): Promise<Float32Array | null> => {
  const bmp = await createImageBitmap(blob);
  const canvas = document.createElement('canvas');
  canvas.width = TILE;
  canvas.height = TILE;
  const ctx = canvas.getContext('2d', { willReadFrequently: true });
  if (!ctx) return null;
  ctx.drawImage(bmp, 0, 0);
  const px = ctx.getImageData(0, 0, TILE, TILE).data;
  const out = new Float32Array(TILE * TILE);
  for (let i = 0, j = 0; i < out.length; i++, j += 4) {
    out[i] = px[j] * 256 + px[j + 1] + px[j + 2] / 256 - 32768;
  }
  return out;
};

const loadDemTile = (z: number, x: number, y: number): Promise<Float32Array | null> => {
  const key = `${z}/${x}/${y}`;
  const hit = demCache.get(key);
  if (hit) return hit;
  const p = (async () => {
    try {
      const res = await fetch(buildTerrariumUrl(z, x, y), { mode: 'cors' });
      if (!res.ok) return null;
      const type = res.headers.get('content-type') || '';
      if (type && !type.includes('png')) return null; // es. tassello SVG di fallback offline del Service Worker
      return await decodeTerrarium(await res.blob());
    } catch {
      return null;
    }
  })();
  demCache.set(key, p);
  if (demCache.size > DEM_CACHE_MAX) {
    const firstKey = demCache.keys().next().value;
    if (firstKey) demCache.delete(firstKey);
  }
  p.then(v => {
    if (!v) demCache.delete(key); // riprova al prossimo passaggio se la rete torna disponibile
  });
  return p;
};

// Equidistanza e curve direttrici in stile cartografia CAI / IGM
const getIntervals = (z: number): { step: number; index: number } | null => {
  if (z < MIN_CONTOUR_ZOOM) return null;
  if (z === 11) return { step: 200, index: 1000 };
  if (z === 12) return { step: 100, index: 500 };
  if (z === 13) return { step: 50, index: 250 };
  if (z === 14) return { step: 20, index: 100 };
  return { step: 10, index: 50 };
};

// Ricava una griglia di quote (n+1 x n+1) per il tassello richiesto, anche oltre lo zoom nativo del DEM
const buildElevationGrid = async (
  z: number,
  x: number,
  y: number,
  n: number
): Promise<Float32Array | null> => {
  for (let sz = Math.min(z, MAX_SOURCE_ZOOM); sz >= MIN_SOURCE_ZOOM; sz--) {
    const d = z - sz;
    const sx = x >> d;
    const sy = y >> d;
    const dem = await loadDemTile(sz, sx, sy);
    if (!dem) continue;

    const scale = 1 << d; // quante volte il tassello sorgente è ingrandito
    const span = TILE / scale; // pixel sorgente coperti dal tassello richiesto
    const ox = (x - (sx << d)) * span;
    const oy = (y - (sy << d)) * span;
    const grid = new Float32Array((n + 1) * (n + 1));

    for (let j = 0; j <= n; j++) {
      const syf = Math.min(TILE - 1, Math.max(0, oy + (j / n) * span - 0.5));
      const y0 = Math.floor(syf);
      const y1 = Math.min(TILE - 1, y0 + 1);
      const fy = syf - y0;
      for (let i = 0; i <= n; i++) {
        const sxf = Math.min(TILE - 1, Math.max(0, ox + (i / n) * span - 0.5));
        const x0 = Math.floor(sxf);
        const x1 = Math.min(TILE - 1, x0 + 1);
        const fx = sxf - x0;
        const a = dem[y0 * TILE + x0];
        const b = dem[y0 * TILE + x1];
        const c = dem[y1 * TILE + x0];
        const e = dem[y1 * TILE + x1];
        grid[j * (n + 1) + i] = (a * (1 - fx) + b * fx) * (1 - fy) + (c * (1 - fx) + e * fx) * fy;
      }
    }
    return grid;
  }
  return null;
};

// Marching Squares: traccia i segmenti di ogni isoipsa sul canvas
const drawContours = (
  ctx: CanvasRenderingContext2D,
  grid: Float32Array,
  n: number,
  step: number,
  index: number,
  theme: 'dark' | 'winter' = 'dark'
) => {
  const cell = TILE / n;
  const w = n + 1;
  const minorPath = new Path2D();
  const indexPath = new Path2D();
  const labelCandidates: { x: number; y: number; level: number }[] = [];

  for (let j = 0; j < n; j++) {
    for (let i = 0; i < n; i++) {
      const tl = grid[j * w + i];
      const tr = grid[j * w + i + 1];
      const br = grid[(j + 1) * w + i + 1];
      const bl = grid[(j + 1) * w + i];
      const lo = Math.min(tl, tr, br, bl);
      const hi = Math.max(tl, tr, br, bl);
      if (hi - lo < 0.01 || hi < -50) continue;

      for (let level = Math.ceil(lo / step) * step; level <= hi; level += step) {
        if (level <= 0) continue;
        let code = 0;
        if (tl >= level) code |= 8;
        if (tr >= level) code |= 4;
        if (br >= level) code |= 2;
        if (bl >= level) code |= 1;
        if (code === 0 || code === 15) continue;

        const x0 = i * cell;
        const y0 = j * cell;
        const lerp = (a: number, b: number) => (a === b ? 0.5 : (level - a) / (b - a));
        const top = (): [number, number] => [x0 + lerp(tl, tr) * cell, y0];
        const right = (): [number, number] => [x0 + cell, y0 + lerp(tr, br) * cell];
        const bottom = (): [number, number] => [x0 + lerp(bl, br) * cell, y0 + cell];
        const left = (): [number, number] => [x0, y0 + lerp(tl, bl) * cell];

        const segs: [number, number][][] = [];
        switch (code) {
          case 1: case 14: segs.push([left(), bottom()]); break;
          case 2: case 13: segs.push([bottom(), right()]); break;
          case 3: case 12: segs.push([left(), right()]); break;
          case 4: case 11: segs.push([top(), right()]); break;
          case 6: case 9: segs.push([top(), bottom()]); break;
          case 7: case 8: segs.push([left(), top()]); break;
          case 5: segs.push([left(), top()], [bottom(), right()]); break;
          case 10: segs.push([top(), right()], [left(), bottom()]); break;
        }

        const isIndex = level % index === 0;
        const path = isIndex ? indexPath : minorPath;
        for (const [a, b] of segs) {
          path.moveTo(a[0], a[1]);
          path.lineTo(b[0], b[1]);
        }
        if (isIndex && segs.length === 1) {
          labelCandidates.push({ x: (segs[0][0][0] + segs[0][1][0]) / 2, y: (segs[0][0][1] + segs[0][1][1]) / 2, level });
        }
      }
    }
  }

  ctx.lineJoin = 'round';
  ctx.lineCap = 'round';
  const isWinter = theme === 'winter';
  ctx.strokeStyle = isWinter ? 'rgba(51, 92, 138, 0.44)' : 'rgba(214, 158, 96, 0.42)';
  ctx.lineWidth = 0.7;
  ctx.stroke(minorPath);
  ctx.strokeStyle = isWinter ? 'rgba(29, 78, 137, 0.82)' : 'rgba(232, 168, 98, 0.78)';
  ctx.lineWidth = 1.35;
  ctx.stroke(indexPath);

  // Quote sulle curve direttrici (max 2 etichette per quota per tassello, lontane dai bordi)
  if (labelCandidates.length > 0) {
    ctx.font = '600 9px Inter, sans-serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    const placed: { x: number; y: number }[] = [];
    const perLevel = new Map<number, number>();
    for (let k = 0; k < labelCandidates.length; k += 7) {
      const c = labelCandidates[k];
      if (c.x < 24 || c.x > TILE - 24 || c.y < 14 || c.y > TILE - 14) continue;
      if ((perLevel.get(c.level) || 0) >= 2) continue;
      if (placed.some(p => Math.abs(p.x - c.x) < 60 && Math.abs(p.y - c.y) < 26)) continue;
      const txt = `${c.level}`;
      const tw = ctx.measureText(txt).width + 6;
      ctx.fillStyle = isWinter ? 'rgba(248, 250, 252, 0.86)' : 'rgba(20, 20, 24, 0.78)';
      ctx.fillRect(c.x - tw / 2, c.y - 6, tw, 12);
      ctx.fillStyle = isWinter ? 'rgba(30, 58, 110, 0.96)' : 'rgba(240, 186, 120, 0.95)';
      ctx.fillText(txt, c.x, c.y + 0.5);
      placed.push({ x: c.x, y: c.y });
      perLevel.set(c.level, (perLevel.get(c.level) || 0) + 1);
    }
  }
};

/**
 * Crea il layer Leaflet "Curve di livello" da sovrapporre a OSM Standard (dark) o Invernale / Neve (winter).
 */
export const createContourLayer = (
  opts: { zIndex?: number; theme?: 'dark' | 'winter' } = {}
): L.GridLayer => {
  const theme = opts.theme || 'dark';
  const ContourLayer = L.GridLayer.extend({
    createTile(coords: L.Coords, done: (err: Error | undefined, tile: HTMLElement) => void) {
      const canvas = document.createElement('canvas');
      const dpr = Math.min(2, window.devicePixelRatio || 1);
      canvas.width = TILE * dpr;
      canvas.height = TILE * dpr;
      canvas.style.width = `${TILE}px`;
      canvas.style.height = `${TILE}px`;

      const intervals = getIntervals(coords.z);
      if (!intervals) {
        setTimeout(() => done(undefined, canvas), 0);
        return canvas;
      }

      const n = coords.z >= 15 ? 64 : 128;
      buildElevationGrid(coords.z, coords.x, coords.y, n)
        .then(grid => {
          const ctx = canvas.getContext('2d');
          if (grid && ctx) {
            ctx.scale(dpr, dpr);
            drawContours(ctx, grid, n, intervals.step, intervals.index, theme);
          }
          done(undefined, canvas);
        })
        .catch(() => done(undefined, canvas));
      return canvas;
    },
  });

  return new (ContourLayer as any)({
    tileSize: TILE,
    zIndex: opts.zIndex ?? 2,
    minZoom: MIN_CONTOUR_ZOOM,
    maxZoom: 19,
    keepBuffer: 4,
    updateWhenZooming: false,
    updateWhenIdle: true,
    className: 'contour-lines-layer',
    pane: 'tilePane',
  }) as L.GridLayer;
};

// Calcola la dimensione metrica reale di una cella del tassello (z, y) alla sua latitudine
const getCellMeters = (z: number, y: number, n: number): number => {
  const nTiles = Math.pow(2, z);
  const latRad = Math.atan(Math.sinh(Math.PI * (1 - (2 * (y + 0.5)) / nTiles)));
  const metersPerTilePx = (156543.03392 * Math.cos(latRad)) / nTiles;
  return metersPerTilePx * (TILE / n);
};

// --- [MODULAR FEATURE 8] LAYER INVERNALI & SCIALPINISMO (PENDENZE >30°, ESPOSIZIONE VERSANTI, HILLSHADING 3D) ---

/**
 * Overlay Pendenze Valanghive >30° (stile White Risk / Swisstopo / FATMAP):
 * - 30°–34°: Giallo
 * - 35°–39°: Arancio
 * - 40°–44°: Rosso
 * - >=45°:   Viola
 */
export const createSlopeAngleLayer = (opts: { zIndex?: number } = {}): L.GridLayer => {
  const SlopeLayer = L.GridLayer.extend({
    createTile(coords: L.Coords, done: (err: Error | undefined, tile: HTMLElement) => void) {
      const canvas = document.createElement('canvas');
      canvas.width = TILE;
      canvas.height = TILE;

      if (coords.z < 10) {
        setTimeout(() => done(undefined, canvas), 0);
        return canvas;
      }

      const n = 128;
      buildElevationGrid(coords.z, coords.x, coords.y, n)
        .then(grid => {
          const ctx = canvas.getContext('2d');
          if (grid && ctx) {
            const cellM = Math.max(0.5, getCellMeters(coords.z, coords.y, n));
            const off = document.createElement('canvas');
            off.width = n;
            off.height = n;
            const octx = off.getContext('2d');
            if (octx) {
              const img = octx.createImageData(n, n);
              const d = img.data;
              const w = n + 1;
              for (let j = 0; j < n; j++) {
                const jm = Math.max(0, j - 1);
                const jp = Math.min(n, j + 1);
                const dySpan = (jp - jm) * cellM;
                for (let i = 0; i < n; i++) {
                  const im = Math.max(0, i - 1);
                  const ip = Math.min(n, i + 1);
                  const dxSpan = (ip - im) * cellM;
                  const dzdx = (grid[j * w + ip] - grid[j * w + im]) / dxSpan;
                  const dzdy = (grid[jp * w + i] - grid[jm * w + i]) / dySpan;
                  const slopeDeg = (Math.atan(Math.hypot(dzdx, dzdy)) * 180) / Math.PI;
                  if (slopeDeg < 30) continue;
                  const p = (j * n + i) * 4;
                  if (slopeDeg < 35) {
                    d[p] = 250; d[p + 1] = 204; d[p + 2] = 21; d[p + 3] = 132; // Giallo 30-34°
                  } else if (slopeDeg < 40) {
                    d[p] = 249; d[p + 1] = 115; d[p + 2] = 22; d[p + 3] = 148; // Arancio 35-39°
                  } else if (slopeDeg < 45) {
                    d[p] = 239; d[p + 1] = 68; d[p + 2] = 68; d[p + 3] = 165; // Rosso 40-44°
                  } else {
                    d[p] = 168; d[p + 1] = 85; d[p + 2] = 247; d[p + 3] = 178; // Viola >=45°
                  }
                }
              }
              octx.putImageData(img, 0, 0);
              ctx.imageSmoothingEnabled = true;
              ctx.drawImage(off, 0, 0, TILE, TILE);
            }
          }
          done(undefined, canvas);
        })
        .catch(() => done(undefined, canvas));
      return canvas;
    },
  });

  return new (SlopeLayer as any)({
    tileSize: TILE,
    zIndex: opts.zIndex ?? 4,
    minZoom: 10,
    maxZoom: 19,
    keepBuffer: 4,
    updateWhenZooming: false,
    updateWhenIdle: true,
    className: 'slope-angle-layer',
    pane: 'tilePane',
  }) as L.GridLayer;
};

/**
 * Overlay Esposizione Versanti (Aspect Map N/NE/E/SE/S/SO/O/NO) per incrocio con Bollettino Valanghe:
 * colora i pendii con inclinazione >=12° (blu freddi a Nord, caldi giallo/arancio a Sud).
 */
export const createAspectLayer = (opts: { zIndex?: number } = {}): L.GridLayer => {
  const AspectLayer = L.GridLayer.extend({
    createTile(coords: L.Coords, done: (err: Error | undefined, tile: HTMLElement) => void) {
      const canvas = document.createElement('canvas');
      canvas.width = TILE;
      canvas.height = TILE;

      if (coords.z < 10) {
        setTimeout(() => done(undefined, canvas), 0);
        return canvas;
      }

      const n = 128;
      buildElevationGrid(coords.z, coords.x, coords.y, n)
        .then(grid => {
          const ctx = canvas.getContext('2d');
          if (grid && ctx) {
            const cellM = Math.max(0.5, getCellMeters(coords.z, coords.y, n));
            const off = document.createElement('canvas');
            off.width = n;
            off.height = n;
            const octx = off.getContext('2d');
            if (octx) {
              const img = octx.createImageData(n, n);
              const d = img.data;
              const w = n + 1;
              for (let j = 0; j < n; j++) {
                const jm = Math.max(0, j - 1);
                const jp = Math.min(n, j + 1);
                const dySpan = (jp - jm) * cellM;
                for (let i = 0; i < n; i++) {
                  const im = Math.max(0, i - 1);
                  const ip = Math.min(n, i + 1);
                  const dxSpan = (ip - im) * cellM;
                  const dzdx = (grid[j * w + ip] - grid[j * w + im]) / dxSpan;
                  const dzdy = (grid[jp * w + i] - grid[jm * w + i]) / dySpan;
                  const grad = Math.hypot(dzdx, dzdy);
                  if (grad < 0.212) continue; // < ~12° (fondovalle/pianura trasparente)

                  // Direzione di massima discesa in gradi geografici (0°=N, 90°=E, 180°=S, 270°=O)
                  const aspectDeg = ((Math.atan2(-dzdx, dzdy) * 180) / Math.PI + 360) % 360;
                  const p = (j * n + i) * 4;
                  if (aspectDeg >= 337.5 || aspectDeg < 22.5) {
                    d[p] = 37; d[p + 1] = 99; d[p + 2] = 235; d[p + 3] = 122; // N (Blu freddo)
                  } else if (aspectDeg < 67.5) {
                    d[p] = 56; d[p + 1] = 189; d[p + 2] = 248; d[p + 3] = 108; // NE (Azzurro)
                  } else if (aspectDeg < 112.5) {
                    d[p] = 20; d[p + 1] = 184; d[p + 2] = 166; d[p + 3] = 92; // E (Verde acqua)
                  } else if (aspectDeg < 157.5) {
                    d[p] = 245; d[p + 1] = 158; d[p + 2] = 11; d[p + 3] = 108; // SE (Ambra)
                  } else if (aspectDeg < 202.5) {
                    d[p] = 250; d[p + 1] = 204; d[p + 2] = 21; d[p + 3] = 120; // S (Giallo sole)
                  } else if (aspectDeg < 247.5) {
                    d[p] = 251; d[p + 1] = 146; d[p + 2] = 60; d[p + 3] = 108; // SO (Arancio)
                  } else if (aspectDeg < 292.5) {
                    d[p] = 139; d[p + 1] = 92; d[p + 2] = 246; d[p + 3] = 96; // O (Viola)
                  } else {
                    d[p] = 99; d[p + 1] = 102; d[p + 2] = 241; d[p + 3] = 112; // NO (Indaco)
                  }
                }
              }
              octx.putImageData(img, 0, 0);
              ctx.imageSmoothingEnabled = true;
              ctx.drawImage(off, 0, 0, TILE, TILE);
            }
          }
          done(undefined, canvas);
        })
        .catch(() => done(undefined, canvas));
      return canvas;
    },
  });

  return new (AspectLayer as any)({
    tileSize: TILE,
    zIndex: opts.zIndex ?? 4,
    minZoom: 10,
    maxZoom: 19,
    keepBuffer: 4,
    updateWhenZooming: false,
    updateWhenIdle: true,
    className: 'aspect-map-layer',
    pane: 'tilePane',
  }) as L.GridLayer;
};

/**
 * Ombreggiatura Rilievi 3D (Hillshading) per la modalità Invernale / Neve ad alta leggibilità al sole.
 */
export const createHillshadeLayer = (opts: { zIndex?: number } = {}): L.GridLayer => {
  const azRad = (315 * Math.PI) / 180;
  const altRad = (45 * Math.PI) / 180;
  const zenithRad = Math.PI / 2 - altRad;

  const HillshadeLayer = L.GridLayer.extend({
    createTile(coords: L.Coords, done: (err: Error | undefined, tile: HTMLElement) => void) {
      const canvas = document.createElement('canvas');
      canvas.width = TILE;
      canvas.height = TILE;

      if (coords.z < 9) {
        setTimeout(() => done(undefined, canvas), 0);
        return canvas;
      }

      const n = 128;
      buildElevationGrid(coords.z, coords.x, coords.y, n)
        .then(grid => {
          const ctx = canvas.getContext('2d');
          if (grid && ctx) {
            const cellM = Math.max(0.5, getCellMeters(coords.z, coords.y, n));
            const off = document.createElement('canvas');
            off.width = n;
            off.height = n;
            const octx = off.getContext('2d');
            if (octx) {
              const img = octx.createImageData(n, n);
              const d = img.data;
              const w = n + 1;
              for (let j = 0; j < n; j++) {
                const jm = Math.max(0, j - 1);
                const jp = Math.min(n, j + 1);
                const dySpan = (jp - jm) * cellM;
                for (let i = 0; i < n; i++) {
                  const im = Math.max(0, i - 1);
                  const ip = Math.min(n, i + 1);
                  const dxSpan = (ip - im) * cellM;
                  const dzdx = (grid[j * w + ip] - grid[j * w + im]) / dxSpan;
                  const dzdy = (grid[jp * w + i] - grid[jm * w + i]) / dySpan;
                  const slope = Math.atan(Math.hypot(dzdx, dzdy) * 1.15);
                  const aspect = Math.atan2(dzdy, -dzdx);
                  const shade =
                    Math.cos(zenithRad) * Math.cos(slope) +
                    Math.sin(zenithRad) * Math.sin(slope) * Math.cos(azRad - aspect);
                  const p = (j * n + i) * 4;
                  if (shade < 0.72) {
                    const darkness = Math.min(1, (0.72 - shade) / 0.72);
                    d[p] = 30; d[p + 1] = 58; d[p + 2] = 95; d[p + 3] = Math.round(darkness * 108);
                  } else {
                    const lightness = Math.min(1, (shade - 0.72) / 0.28);
                    d[p] = 255; d[p + 1] = 255; d[p + 2] = 255; d[p + 3] = Math.round(lightness * 34);
                  }
                }
              }
              octx.putImageData(img, 0, 0);
              ctx.imageSmoothingEnabled = true;
              ctx.drawImage(off, 0, 0, TILE, TILE);
            }
          }
          done(undefined, canvas);
        })
        .catch(() => done(undefined, canvas));
      return canvas;
    },
  });

  return new (HillshadeLayer as any)({
    tileSize: TILE,
    zIndex: opts.zIndex ?? 2,
    minZoom: 9,
    maxZoom: 19,
    keepBuffer: 4,
    updateWhenZooming: false,
    updateWhenIdle: true,
    className: 'hillshade-winter-layer',
    pane: 'tilePane',
  }) as L.GridLayer;
};
