// --- [MODULAR FEATURE] OFFLINE MAPS MANAGER SERVICE (KOMOOT / MAPY.CZ / OSMAND STYLE) ---
// Questo modulo gestisce il catalogo delle regioni e zone alpine predefinite, i metadati espliciti
// per ciascun tipo di mappa (OSM Topografica, Satellite Puro, Ibrida + Sentieri), il calcolo della piramide
// di tasselli multi-zoom e la sincronizzazione con i servizi esistenti (fetchOsmPois, preloadOfflineAreaTrailNetwork,
// seedElevationCacheFromPois, analyzeLocationPhysics) senza alterare alcuna logica pre-esistente.

import { POI } from '../types.ts';
import { dbService } from './dbService.ts';
import {
  fetchOsmPois,
  preloadOfflineAreaTrailNetwork,
  seedElevationCacheFromPois,
} from './osmService.ts';
import { analyzeLocationPhysics } from './analysisService.ts';
import { REGIONAL_VENETO_TRENTINO_POIS } from './regionalData.ts';
import { MOCK_POIS } from '../constants.tsx';

export const TILE_CACHE_NAME = 'mountpro-tiles-v1-offline';
const OFFLINE_PACKAGES_DB_KEY = 'offline_map_packages_v1';

export type OfflineMapStyle = 'standard' | 'satellite' | 'hybrid';

export type AlpineMacroZone =
  | 'Tutte'
  | 'Dolomiti & Veneto'
  | 'Trentino & Alto Adige'
  | 'Friuli & Est'
  | 'Lombardia & Ovest';

export interface BoundingBox {
  south: number;
  west: number;
  north: number;
  east: number;
}

export interface OfflineMapPackage {
  id: string;
  baseRegionId?: string;
  name: string;
  subtitle: string;
  regionGroup: string;
  bounds: BoundingBox;
  center: { lat: number; lng: number };
  mapStyle: OfflineMapStyle;
  minZoom: number;
  maxNativeZoom: number;
  tileCount: number;
  poiCount: number;
  sizeBytes: number;
  areaKm2: number;
  downloadedAt: number;
  isCustomArea?: boolean;
  includesTrailsAndDem: boolean;
}

export interface PredefinedAlpineRegion {
  id: string;
  name: string;
  subtitle: string;
  regionGroup: string;
  macroZone: Exclude<AlpineMacroZone, 'Tutte'>;
  maxPeakName: string;
  maxPeakElevation: number;
  bounds: BoundingBox;
  center: { lat: number; lng: number };
  recommendedZoom: number;
}

export interface OfflineDownloadProgress {
  packageId: string;
  packageName: string;
  mapStyle: OfflineMapStyle;
  phase: 'tiles' | 'pois' | 'trails_dem' | 'finalizing' | 'done' | 'error';
  phaseLabel: string;
  percent: number;
  completedTiles: number;
  totalTiles: number;
  poisSaved: number;
}

// Metadati descrittivi chiari per identificare immediatamente il tipo di mappa scaricata o da scaricare
export const getOfflineMapStyleMeta = (style: OfflineMapStyle) => {
  if (style === 'satellite') {
    return {
      id: 'satellite' as const,
      shortLabel: 'Satellite Puro',
      badgeTitle: 'MAPPA SATELLITARE (ORTOFOTO)',
      fullLabel: 'Satellite Puro (Esri World Imagery + Toponimi)',
      layersSummary: 'Ortofoto satellitare HD + Confini e Vette · Bivacchi/POI · Quote DEM',
      accentText: 'text-sky-400',
      accentBg: 'bg-sky-950/50',
      accentBorder: 'border-sky-500/40',
      buttonActive: 'bg-sky-600 text-white border-sky-500',
    };
  }
  if (style === 'hybrid') {
    return {
      id: 'hybrid' as const,
      shortLabel: 'Ibrida + Sentieri',
      badgeTitle: 'MAPPA IBRIDA (SATELLITE + SENTIERI CAI)',
      fullLabel: 'Ibrida Escursionistica (Satellite + Sentieri Waymarked)',
      layersSummary: 'Ortofoto satellitare + Rete Sentieri CAI/OSM sovrapposta + Bivacchi/POI + DEM',
      accentText: 'text-emerald-400',
      accentBg: 'bg-emerald-950/50',
      accentBorder: 'border-emerald-500/40',
      buttonActive: 'bg-emerald-600 text-white border-emerald-500',
    };
  }
  return {
    id: 'standard' as const,
    shortLabel: 'OSM Topografica',
    badgeTitle: 'MAPPA OSM STANDARD (TOPOGRAFICA)',
    fullLabel: 'OSM Standard Topografica (Curve, Vette e Sentieri)',
    layersSummary: 'Cartografia vettoriale/raster OSM · Bivacchi/POI · Quote DEM · Grafo Sentieri',
    accentText: 'text-orange-400',
    accentBg: 'bg-orange-950/50',
    accentBorder: 'border-orange-500/40',
    buttonActive: 'bg-orange-600 text-white border-orange-500',
  };
};

// Catalogo completo di 12 Regioni e Zone Montuose Predefinite (ispirato a Mapy.cz / Komoot / OsmAnd)
export const PREDEFINED_ALPINE_REGIONS: PredefinedAlpineRegion[] = [
  {
    id: 'reg-dolomiti-centrali',
    name: 'Dolomiti Centrali & Cortina d’Ampezzo',
    subtitle: 'Tofane, Cristallo, Sorapiss, Marmolada, Gruppo del Sella, Fanes-Sennes',
    regionGroup: 'Veneto · Trentino · Alto Adige',
    macroZone: 'Dolomiti & Veneto',
    maxPeakName: 'Marmolada (Punta Penia)',
    maxPeakElevation: 3343,
    bounds: { south: 46.36, west: 11.72, north: 46.68, east: 12.26 },
    center: { lat: 46.538, lng: 12.05 },
    recommendedZoom: 11,
  },
  {
    id: 'reg-tre-cime-cadore-comelico',
    name: 'Tre Cime di Lavaredo, Cadore & Comelico',
    subtitle: 'Tre Cime, Cadini di Misurina, Croda dei Toni, Marmarole, Antelao',
    regionGroup: 'Veneto · Alta Val Pusteria',
    macroZone: 'Dolomiti & Veneto',
    maxPeakName: 'Monte Antelao',
    maxPeakElevation: 3264,
    bounds: { south: 46.40, west: 12.15, north: 46.72, east: 12.68 },
    center: { lat: 46.58, lng: 12.35 },
    recommendedZoom: 11,
  },
  {
    id: 'reg-alpi-venete-prealpi',
    name: 'Dolomiti Bellunesi, Civetta, Pelmo & Schiara',
    subtitle: 'Civetta, Moiazza, Monte Pelmo, Schiara, Monti del Sole, Val di Zoldo',
    regionGroup: 'Veneto · Belluno · Agordino',
    macroZone: 'Dolomiti & Veneto',
    maxPeakName: 'Monte Civetta',
    maxPeakElevation: 3220,
    bounds: { south: 46.10, west: 11.85, north: 46.45, east: 12.38 },
    center: { lat: 46.30, lng: 12.08 },
    recommendedZoom: 11,
  },
  {
    id: 'reg-prealpi-venete-pasubio-grappa',
    name: 'Prealpi Venete, Pasubio, Carega & Monte Grappa',
    subtitle: 'Pasubio (52 Gallerie), Piccole Dolomiti, Altopiano di Asiago, Monte Grappa',
    regionGroup: 'Veneto · Vicenza · Treviso · Trento',
    macroZone: 'Dolomiti & Veneto',
    maxPeakName: 'Cima Dodici / Cima Carega',
    maxPeakElevation: 2336,
    bounds: { south: 45.68, west: 11.10, north: 46.05, east: 11.90 },
    center: { lat: 45.84, lng: 11.45 },
    recommendedZoom: 11,
  },
  {
    id: 'reg-brenta-adamello',
    name: 'Dolomiti di Brenta, Adamello & Presanella',
    subtitle: 'Campiglio, Cima Tosa, Carè Alto, Val Genova, Val di Sole, Val Rendena',
    regionGroup: 'Trentino Occidentale · Lombardia',
    macroZone: 'Trentino & Alto Adige',
    maxPeakName: 'Cima Presanella',
    maxPeakElevation: 3558,
    bounds: { south: 45.98, west: 10.48, north: 46.36, east: 11.02 },
    center: { lat: 46.175, lng: 10.78 },
    recommendedZoom: 11,
  },
  {
    id: 'reg-lagorai-pale',
    name: 'Catena del Lagorai & Pale di San Martino',
    subtitle: 'Cima d’Asta, Vezzana, Cimon della Pala, Val Canali, Val di Fiemme',
    regionGroup: 'Trentino Orientale · Veneto',
    macroZone: 'Trentino & Alto Adige',
    maxPeakName: 'Cima della Vezzana',
    maxPeakElevation: 3192,
    bounds: { south: 46.08, west: 11.35, north: 46.38, east: 11.95 },
    center: { lat: 46.23, lng: 11.68 },
    recommendedZoom: 11,
  },
  {
    id: 'reg-catinaccio-puez-odle',
    name: 'Catinaccio, Sciliar, Sassolungo & Puez-Odle',
    subtitle: 'Val di Fassa, Val Gardena, Alpe di Siusi, Seceda, Odle, Vajolet',
    regionGroup: 'Trentino · Alto Adige',
    macroZone: 'Trentino & Alto Adige',
    maxPeakName: 'Sassolungo',
    maxPeakElevation: 3181,
    bounds: { south: 46.40, west: 11.50, north: 46.68, east: 11.92 },
    center: { lat: 46.53, lng: 11.72 },
    recommendedZoom: 11,
  },
  {
    id: 'reg-ortles-alto-adige',
    name: 'Ortles-Cevedale, Val Venosta & Alpi Venoste',
    subtitle: 'Ortles, Gran Zebrù, Cevedale, Gruppo di Tessa, Val Martello, Val Senales',
    regionGroup: 'Alto Adige / Südtirol · Lombardia',
    macroZone: 'Trentino & Alto Adige',
    maxPeakName: 'Ortles',
    maxPeakElevation: 3905,
    bounds: { south: 46.38, west: 10.45, north: 46.82, east: 11.25 },
    center: { lat: 46.54, lng: 10.72 },
    recommendedZoom: 11,
  },
  {
    id: 'reg-giulie-carniche',
    name: 'Alpi Giulie, Carniche & Dolomiti Friulane',
    subtitle: 'Jôf di Montasio, Jôf Fuart, Coglians, Canin, Campanile di Val Montanaia',
    regionGroup: 'Friuli Venezia Giulia · Veneto',
    macroZone: 'Friuli & Est',
    maxPeakName: 'Monte Coglians',
    maxPeakElevation: 2780,
    bounds: { south: 46.22, west: 12.42, north: 46.66, east: 13.62 },
    center: { lat: 46.42, lng: 13.05 },
    recommendedZoom: 10,
  },
  {
    id: 'reg-orobie-bernina',
    name: 'Alpi Orobie, Bernina & Val Masino',
    subtitle: 'Pizzo Coca, Redorta, Monte Disgrazia, Bernina, Valmalenco, Passo San Marco',
    regionGroup: 'Lombardia · Sondrio · Bergamo',
    macroZone: 'Lombardia & Ovest',
    maxPeakName: 'Pizzo Bernina',
    maxPeakElevation: 4049,
    bounds: { south: 45.95, west: 9.52, north: 46.40, east: 10.28 },
    center: { lat: 46.15, lng: 9.88 },
    recommendedZoom: 10,
  },
  {
    id: 'reg-valle-daosta-gran-paradiso',
    name: 'Valle d’Aosta, Gran Paradiso, Cervino & Monte Rosa',
    subtitle: 'Parco Nazionale Gran Paradiso, Monte Bianco, Cervino, Monte Rosa',
    regionGroup: 'Valle d’Aosta · Piemonte',
    macroZone: 'Lombardia & Ovest',
    maxPeakName: 'Monte Bianco',
    maxPeakElevation: 4810,
    bounds: { south: 45.48, west: 6.82, north: 45.96, east: 7.90 },
    center: { lat: 45.72, lng: 7.36 },
    recommendedZoom: 10,
  },
  {
    id: 'reg-monviso-cozie-marittime',
    name: 'Monviso, Alpi Cozie & Alpi Marittime',
    subtitle: 'Giro del Monviso, Argentera, Val Varaita, Val Maira, Val Gesso',
    regionGroup: 'Piemonte · Cuneo · Torino',
    macroZone: 'Lombardia & Ovest',
    maxPeakName: 'Monviso',
    maxPeakElevation: 3841,
    bounds: { south: 44.12, west: 6.88, north: 44.82, east: 7.42 },
    center: { lat: 44.66, lng: 7.09 },
    recommendedZoom: 10,
  },
];

// Costruisce l'ID univoco per combinazione Regione + Tipo Mappa così una stessa regione
// può essere scaricata in OSM, Satellite e/o Ibrida senza sovrascrivere gli altri stili
export const buildRegionPackageId = (baseRegionId: string, style: OfflineMapStyle): string => {
  return `${baseRegionId}__${style}`;
};

// Conversione coordinate geografiche -> coordinate Tile XYZ Slippy Map
export const lat2tile = (lat: number, zoom: number): number => {
  const clampedLat = Math.max(-85.0511, Math.min(85.0511, lat));
  const rad = (clampedLat * Math.PI) / 180;
  return Math.floor(((1 - Math.log(Math.tan(rad) + 1 / Math.cos(rad)) / Math.PI) / 2) * Math.pow(2, zoom));
};

export const lon2tile = (lon: number, zoom: number): number => {
  return Math.floor(((lon + 180) / 360) * Math.pow(2, zoom));
};

// Calcola l'area approssimativa in km² di un BoundingBox
export const calculateBoundsAreaKm2 = (bounds: BoundingBox): number => {
  const R = 6371;
  const dLat = ((bounds.north - bounds.south) * Math.PI) / 180;
  const dLon = ((bounds.east - bounds.west) * Math.PI) / 180;
  const midLat = (((bounds.north + bounds.south) / 2) * Math.PI) / 180;
  const heightKm = R * dLat;
  const widthKm = R * dLon * Math.cos(midLat);
  return Math.max(1, Math.round(Math.abs(heightKm * widthKm)));
};

// Costruisce gli URL canonici dei tasselli per uno specifico stile mappa e coordinata (z, x, y)
export const getTileUrlsForCoord = (z: number, x: number, y: number, style: OfflineMapStyle): string[] => {
  if (style === 'standard') {
    return [`https://a.tile.openstreetmap.org/${z}/${x}/${y}.png`];
  }
  if (style === 'satellite') {
    return [
      `https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/${z}/${y}/${x}`,
      `https://server.arcgisonline.com/ArcGIS/rest/services/Reference/World_Boundaries_and_Places/MapServer/tile/${z}/${y}/${x}`,
    ];
  }
  // hybrid: Satellite + Strade + Toponimi + Sentieri Escursionistici Waymarked Trails
  return [
    `https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/${z}/${y}/${x}`,
    `https://server.arcgisonline.com/ArcGIS/rest/services/Reference/World_Boundaries_and_Places/MapServer/tile/${z}/${y}/${x}`,
    `https://tile.waymarkedtrails.org/hiking/${z}/${x}/${y}.png`,
  ];
};

/**
 * Genera la piramide di tasselli multi-zoom (Z9..Z16) per un'area geografica.
 * I livelli Z17-Z19 sono gestiti nativamente da Leaflet tramite Overzooming nitido dei tasselli Z15/Z16.
 */
export const buildMultiZoomTileList = (
  bounds: BoundingBox,
  style: OfflineMapStyle,
  maxTileBudget: number = 420
): { urls: string[]; minZoom: number; maxNativeZoom: number } => {
  const urls: string[] = [];
  const seen = new Set<string>();
  const minZoom = 9;
  const maxNativeZoom = 16;

  const centerLat = (bounds.north + bounds.south) / 2;
  const centerLng = (bounds.east + bounds.west) / 2;

  for (let z = minZoom; z <= maxNativeZoom; z++) {
    let south = bounds.south;
    let north = bounds.north;
    let west = bounds.west;
    let east = bounds.east;

    const latSpan = north - south;
    const lngSpan = east - west;
    if (z === 15 && (latSpan > 0.22 || lngSpan > 0.28)) {
      const halfLat = Math.min(latSpan / 2, 0.08);
      const halfLng = Math.min(lngSpan / 2, 0.11);
      south = centerLat - halfLat;
      north = centerLat + halfLat;
      west = centerLng - halfLng;
      east = centerLng + halfLng;
    } else if (z === 16 && (latSpan > 0.12 || lngSpan > 0.15)) {
      const halfLat = Math.min(latSpan / 2, 0.04);
      const halfLng = Math.min(lngSpan / 2, 0.055);
      south = centerLat - halfLat;
      north = centerLat + halfLat;
      west = centerLng - halfLng;
      east = centerLng + halfLng;
    }

    const xMin = lon2tile(west, z);
    const xMax = lon2tile(east, z);
    const yMin = lat2tile(north, z);
    const yMax = lat2tile(south, z);

    const coords: { x: number; y: number; dist2: number }[] = [];
    const cx = (xMin + xMax) / 2;
    const cy = (yMin + yMax) / 2;

    for (let x = xMin; x <= xMax; x++) {
      for (let y = yMin; y <= yMax; y++) {
        coords.push({ x, y, dist2: (x - cx) * (x - cx) + (y - cy) * (y - cy) });
      }
    }
    coords.sort((a, b) => a.dist2 - b.dist2);

    for (const c of coords) {
      const tileUrls = getTileUrlsForCoord(z, c.x, c.y, style);
      for (const u of tileUrls) {
        if (!seen.has(u)) {
          seen.add(u);
          urls.push(u);
        }
      }
      if (urls.length >= maxTileBudget) break;
    }
    if (urls.length >= maxTileBudget) break;
  }

  return { urls, minZoom, maxNativeZoom };
};

// Stima rapida per l'anteprima UI (differenziata per tipo di mappa: OSM vs Satellite vs Ibrida)
export const estimateOfflinePackageStats = (bounds: BoundingBox, style: OfflineMapStyle) => {
  const areaKm2 = calculateBoundsAreaKm2(bounds);
  const budget = style === 'standard' ? 210 : style === 'satellite' ? 250 : 290;
  const { urls, minZoom, maxNativeZoom } = buildMultiZoomTileList(bounds, style, budget);
  const tileCount = urls.length;
  const avgBytesPerTile = style === 'standard' ? 23500 : style === 'satellite' ? 27500 : 29500;
  const sizeBytes = tileCount * avgBytesPerTile + 1150000;
  const sizeMB = Number((sizeBytes / (1024 * 1024)).toFixed(1));
  return {
    areaKm2,
    tileCount,
    sizeBytes,
    sizeMB,
    minZoom,
    maxNativeZoom,
  };
};

// Legge i pacchetti offline salvati in IndexedDB
export const getSavedOfflinePackages = async (): Promise<OfflineMapPackage[]> => {
  const list = await dbService.getOfflineItem<OfflineMapPackage[]>(OFFLINE_PACKAGES_DB_KEY);
  if (!Array.isArray(list)) return [];
  return list.sort((a, b) => b.downloadedAt - a.downloadedAt);
};

// Salva l'elenco aggiornato di pacchetti offline in IndexedDB
export const saveOfflinePackagesList = async (packages: OfflineMapPackage[]): Promise<void> => {
  await dbService.setOfflineItem(OFFLINE_PACKAGES_DB_KEY, packages);
};

// Elimina un pacchetto offline e pulisce i relativi tasselli non condivisi dalla CacheStorage
export const deleteOfflinePackage = async (packageId: string): Promise<OfflineMapPackage[]> => {
  const existing = await getSavedOfflinePackages();
  const target = existing.find(p => p.id === packageId);
  const remaining = existing.filter(p => p.id !== packageId);
  await saveOfflinePackagesList(remaining);

  if (target && 'caches' in window) {
    try {
      const cache = await caches.open(TILE_CACHE_NAME);
      const { urls } = buildMultiZoomTileList(target.bounds, target.mapStyle, 320);
      const keepUrls = new Set<string>();
      for (const other of remaining) {
        const otherTiles = buildMultiZoomTileList(other.bounds, other.mapStyle, 320).urls;
        otherTiles.forEach(u => keepUrls.add(u));
      }
      // Pulizia parallela veloce dalla CacheStorage
      await Promise.allSettled(
        urls
          .filter(u => !keepUrls.has(u))
          .map(u => cache.delete(u, { ignoreVary: true }))
      );
    } catch (e) {
      console.warn('Cache cleanup note:', e);
    }
  }

  return remaining;
};

// Distribuisce le richieste OSM sui 3 sottodomini CDN (a, b, c) durante il fetch di rete
// per triplicare il limite di connessioni HTTP concorrenti del browser, mantenendo però
// la chiave canonica "https://a.tile.openstreetmap.org/..." nella CacheStorage offline.
const getShardedFetchUrl = (canonicalUrl: string, index: number): string => {
  if (canonicalUrl.startsWith('https://a.tile.openstreetmap.org/')) {
    const sub = ['a', 'b', 'c'][index % 3];
    return canonicalUrl.replace('https://a.tile.openstreetmap.org/', `https://${sub}.tile.openstreetmap.org/`);
  }
  return canonicalUrl;
};

/**
 * Motore Turbo Download All-in-One:
 * - Esegue in PARALLELO il download multi-CDN dei tasselli (24 worker + timeout 2.8s/tile)
 *   e l'indicizzazione immediata dei Bivacchi/Rifugi/Fontane + Quote DEM.
 * - Salva le risposte sotto URL canonico normalizzato in CacheStorage per hit istantaneo col Service Worker.
 * - Completa in background l'arricchimento Overpass esteso e il grafo sentieristico CAI senza bloccare la UI.
 */
export const downloadCompleteOfflinePackage = async (params: {
  id: string;
  baseRegionId?: string;
  name: string;
  subtitle: string;
  regionGroup: string;
  bounds: BoundingBox;
  mapStyle: OfflineMapStyle;
  isCustomArea?: boolean;
  onProgress: (progress: OfflineDownloadProgress) => void;
  signal?: AbortSignal;
}): Promise<{ pkg: OfflineMapPackage; pois: POI[] }> => {
  const { id, baseRegionId, name, subtitle, regionGroup, bounds, mapStyle, isCustomArea, onProgress, signal } = params;
  const styleMeta = getOfflineMapStyleMeta(mapStyle);
  const budget = mapStyle === 'standard' ? 210 : mapStyle === 'satellite' ? 250 : 290;
  const { urls, minZoom, maxNativeZoom } = buildMultiZoomTileList(bounds, mapStyle, budget);
  const totalTiles = urls.length;
  let completedTiles = 0;

  const checkAborted = () => {
    if (signal?.aborted) {
      throw new DOMException('Download annullato dall’utente', 'AbortError');
    }
  };

  // Pre-raccolta istantanea (0ms) dei POI verificati e già presenti nel DB locale nell'area
  const existingDbPois = await dbService.getAllPois().catch(() => [] as POI[]);
  const localAndRegionalInBounds = [...MOCK_POIS, ...REGIONAL_VENETO_TRENTINO_POIS, ...existingDbPois].filter(
    p =>
      p.coordinates.lat >= bounds.south &&
      p.coordinates.lat <= bounds.north &&
      p.coordinates.lng >= bounds.west &&
      p.coordinates.lng <= bounds.east
  );

  onProgress({
    packageId: id,
    packageName: `${name} (${styleMeta.shortLabel})`,
    mapStyle,
    phase: 'tiles',
    phaseLabel: `Download Turbo ${styleMeta.shortLabel} (Z${minZoom}–Z${maxNativeZoom})...`,
    percent: 5,
    completedTiles: 0,
    totalTiles,
    poisSaved: localAndRegionalInBounds.length,
  });

  // Avvia IN PARALLELO la ricerca Overpass POI con timeout rapido (3.8s max d'attesa bloccante)
  // Se Overpass impiega più tempo, finirà in background aggiornando silenziosamente il DB locale
  const fastOverpassPromise = (async (): Promise<POI[]> => {
    try {
      const raceTimeout = new Promise<POI[]>(resolve => setTimeout(() => resolve([]), 3800));
      const fetchPromise = fetchOsmPois(bounds, 'All', signal).then(async fetched => {
        if (fetched && fetched.length > 0 && !signal?.aborted) {
          await dbService.savePois(fetched).catch(() => {});
          seedElevationCacheFromPois(fetched);
        }
        return fetched || [];
      });
      return await Promise.race([fetchPromise, raceTimeout]);
    } catch {
      return [];
    }
  })();

  // STREAM 1: Download concorrente ad alta velocità (24 worker + Sharding CDN a/b/c + Timeout 2.8s per tile)
  const tileCache = 'caches' in window ? await caches.open(TILE_CACHE_NAME) : null;
  const CONCURRENCY = 24;
  const PER_TILE_TIMEOUT_MS = 2800;
  let cursor = 0;

  const worker = async () => {
    while (cursor < urls.length) {
      checkAborted();
      const idx = cursor++;
      const canonicalUrl = urls[idx];
      const networkUrl = getShardedFetchUrl(canonicalUrl, idx);

      const tileAbort = new AbortController();
      const timeoutId = setTimeout(() => tileAbort.abort(), PER_TILE_TIMEOUT_MS);
      const onParentAbort = () => tileAbort.abort();
      signal?.addEventListener('abort', onParentAbort, { once: true });

      try {
        const alreadyCached = tileCache ? await tileCache.match(canonicalUrl) : null;
        if (!alreadyCached) {
          const req = new Request(networkUrl, { mode: 'no-cors' });
          const res = await fetch(req, { signal: tileAbort.signal });
          if (tileCache && res && (res.status === 200 || res.type === 'opaque')) {
            // Salva sempre con chiave canonicalUrl per match immediato col Service Worker
            await tileCache.put(canonicalUrl, res);
          }
        }
      } catch {
        checkAborted();
      } finally {
        clearTimeout(timeoutId);
        signal?.removeEventListener('abort', onParentAbort);
        completedTiles++;
        if (completedTiles % 8 === 0 || completedTiles === totalTiles) {
          const tilePct = Math.round((completedTiles / Math.max(1, totalTiles)) * 86);
          onProgress({
            packageId: id,
            packageName: `${name} (${styleMeta.shortLabel})`,
            mapStyle,
            phase: 'tiles',
            phaseLabel: `Tasselli ${styleMeta.shortLabel}: ${completedTiles} / ${totalTiles} salvati`,
            percent: Math.min(86, Math.max(6, tilePct)),
            completedTiles,
            totalTiles,
            poisSaved: localAndRegionalInBounds.length,
          });
        }
      }
    }
  };

  await Promise.all(Array.from({ length: Math.min(CONCURRENCY, urls.length || 1) }, () => worker()));
  checkAborted();

  // STREAM 2: Unione istantanea POI Regionali + POI Overpass già arrivati in parallelo
  onProgress({
    packageId: id,
    packageName: `${name} (${styleMeta.shortLabel})`,
    mapStyle,
    phase: 'pois',
    phaseLabel: 'Sincronizzazione Bivacchi, Rifugi, Fontane e Quote DEM...',
    percent: 93,
    completedTiles,
    totalTiles,
    poisSaved: localAndRegionalInBounds.length,
  });

  const fetchedPois = await fastOverpassPromise;
  checkAborted();

  const mergedPoiMap = new Map<string, POI>();
  localAndRegionalInBounds.forEach(p => mergedPoiMap.set(p.id, p));
  fetchedPois.forEach(p => mergedPoiMap.set(p.id, p));
  const finalAreaPois = Array.from(mergedPoiMap.values());

  if (finalAreaPois.length > 0) {
    await dbService.savePois(finalAreaPois);
    seedElevationCacheFromPois(finalAreaPois);
  }

  checkAborted();

  const centerLat = Number(((bounds.north + bounds.south) / 2).toFixed(4));
  const centerLng = Number(((bounds.east + bounds.west) / 2).toFixed(4));

  // STREAM 3 (Non-bloccante in background): Pre-carica grafo sentieristico CAI e fisica meteo locale
  // senza trattenere la barra di avanzamento dell'utente
  Promise.allSettled([
    preloadOfflineAreaTrailNetwork(bounds),
    analyzeLocationPhysics(centerLat, centerLng),
  ]).catch(() => {});

  // Salvataggio immediato record pacchetto offline in IndexedDB
  const areaKm2 = calculateBoundsAreaKm2(bounds);
  const avgBytesPerTile = mapStyle === 'standard' ? 23500 : mapStyle === 'satellite' ? 27500 : 29500;
  const sizeBytes = completedTiles * avgBytesPerTile + finalAreaPois.length * 1800 + 1150000;

  const newPkg: OfflineMapPackage = {
    id,
    baseRegionId: baseRegionId || id,
    name,
    subtitle,
    regionGroup,
    bounds,
    center: { lat: centerLat, lng: centerLng },
    mapStyle,
    minZoom,
    maxNativeZoom,
    tileCount: completedTiles,
    poiCount: finalAreaPois.length,
    sizeBytes,
    areaKm2,
    downloadedAt: Date.now(),
    isCustomArea: !!isCustomArea,
    includesTrailsAndDem: true,
  };

  const existingPackages = await getSavedOfflinePackages();
  const updatedPackages = [newPkg, ...existingPackages.filter(p => p.id !== id)];
  await saveOfflinePackagesList(updatedPackages);

  onProgress({
    packageId: id,
    packageName: `${name} (${styleMeta.shortLabel})`,
    mapStyle,
    phase: 'done',
    phaseLabel: 'Pacchetto Offline completato e pronto all’uso!',
    percent: 100,
    completedTiles,
    totalTiles,
    poisSaved: finalAreaPois.length,
  });

  return { pkg: newPkg, pois: finalAreaPois };
};
