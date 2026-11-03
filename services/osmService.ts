
import { POI, POIType, Exposure, SignalStrength } from '../types.ts';
import { REGIONAL_VENETO_TRENTINO_POIS } from './regionalData.ts';
import { dbService } from './dbService.ts';

// Overpass instances for area downloads (Failover support)
const OVERPASS_INSTANCES = [
  'https://overpass-api.de/api/interpreter',
  'https://overpass.kumi.systems/api/interpreter',
  'https://api.openstreetmap.fr/oapi/interpreter'
];

// Nominatim for text search (Standard OSM Search)
const NOMINATIM_API_URL = 'https://nominatim.openstreetmap.org/search';

const ELEVATION_API_URL = 'https://api.open-meteo.com/v1/elevation';
const DEM_STORAGE_KEY = 'mountpro_dem_cache_v1';

// Elevation Cache to prevent duplicate queries and optimize DEM resolution
const elevationCache = new Map<string, number>();

// Pre-semina cache altimetrica con i dati verificati di Veneto e Trentino-Alto Adige
REGIONAL_VENETO_TRENTINO_POIS.forEach(p => {
  if (p.altitude > 0) {
    elevationCache.set(`${p.coordinates.lat.toFixed(4)},${p.coordinates.lng.toFixed(4)}`, p.altitude);
  }
});

// Ripristina punti DEM precedentemente risolti da localStorage
try {
  const savedDemRaw = typeof localStorage !== 'undefined' ? localStorage.getItem(DEM_STORAGE_KEY) : null;
  if (savedDemRaw) {
    const entries: [string, number][] = JSON.parse(savedDemRaw);
    if (Array.isArray(entries)) {
      entries.forEach(([k, v]) => {
        if (typeof k === 'string' && typeof v === 'number' && v > 0) {
          elevationCache.set(k, v);
        }
      });
    }
  }
} catch {}

const persistDemCache = () => {
  try {
    if (typeof localStorage === 'undefined') return;
    const allEntries = Array.from(elevationCache.entries());
    // Mantieni fino a 2500 punti quotati in localStorage
    const sliced = allEntries.slice(Math.max(0, allEntries.length - 2500));
    localStorage.setItem(DEM_STORAGE_KEY, JSON.stringify(sliced));
  } catch {}
};

// Permette di arricchire la cache altimetrica offline dai POI salvati e dalle tracce GPX caricate
export const seedElevationCacheFromPois = (pois: POI[]) => {
  for (const p of pois) {
    if (p.altitude && p.altitude > 0) {
      elevationCache.set(`${p.coordinates.lat.toFixed(4)},${p.coordinates.lng.toFixed(4)}`, Math.round(p.altitude));
    }
  }
};

export const seedElevationCacheFromPoints = (pts: { lat: number; lng: number; ele: number }[]) => {
  for (const pt of pts) {
    if (pt.ele && pt.ele > 0) {
      elevationCache.set(`${pt.lat.toFixed(4)},${pt.lng.toFixed(4)}`, Math.round(pt.ele));
    }
  }
};

// Stima altimetrica offline tramite interpolazione IDW (Inverse Distance Weighting) sui punti quotati noti entro ~3.5 km
export const estimateOfflineAltitude = (lat: number, lng: number): number | null => {
  const exactKey = `${lat.toFixed(4)},${lng.toFixed(4)}`;
  if (elevationCache.has(exactKey)) {
    return elevationCache.get(exactKey)!;
  }

  const cosLat = Math.cos((lat * Math.PI) / 180);
  let weightedSum = 0;
  let weightTotal = 0;
  let minDistKm = Infinity;
  let closestEle: number | null = null;

  for (const [key, ele] of elevationCache.entries()) {
    const commaIdx = key.indexOf(',');
    if (commaIdx === -1) continue;
    const kLat = parseFloat(key.slice(0, commaIdx));
    const kLng = parseFloat(key.slice(commaIdx + 1));
    if (Math.abs(kLat - lat) > 0.032 || Math.abs(kLng - lng) > 0.045) continue;

    const dLatKm = (kLat - lat) * 111.132;
    const dLngKm = (kLng - lng) * 111.32 * cosLat;
    const distKm = Math.sqrt(dLatKm * dLatKm + dLngKm * dLngKm);

    if (distKm < 0.08) {
      return ele;
    }
    if (distKm <= 3.5) {
      const w = 1 / Math.pow(Math.max(0.05, distKm), 2);
      weightedSum += ele * w;
      weightTotal += w;
      if (distKm < minDistKm) {
        minDistKm = distKm;
        closestEle = ele;
      }
    }
  }

  if (weightTotal > 0) {
    return Math.round(weightedSum / weightTotal);
  }
  return closestEle;
};
const fetchOverpassData = async (query: string, signal?: AbortSignal) => {
  let lastError;

  for (const url of OVERPASS_INSTANCES) {
    try {
      const formData = new URLSearchParams();
      formData.append('data', query);

      const response = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded; charset=UTF-8' },
        body: formData,
        signal: signal
      });

      if (!response.ok) {
        console.warn(`Overpass instance ${url} failed with status ${response.status}. Trying next...`);
        lastError = new Error(`Server ${url} responded with ${response.status}`);
        continue;
      }

      const text = await response.text();
      
      if (text.trim().startsWith('<') && !text.includes('<osm')) {
         if (text.includes('timeout') || text.includes('error')) {
            console.warn(`Overpass instance ${url} returned an error body. Trying next...`);
            lastError = new Error(`Server returned error body: ${text.substring(0, 100)}...`);
            continue;
         }
      }

      try {
        return JSON.parse(text);
      } catch (jsonError) {
        console.warn(`Failed to parse JSON from ${url}. Body was not JSON.`);
        lastError = new Error("Invalid JSON response");
        continue;
      }

    } catch (e: any) {
      if (e.name === 'AbortError') throw e;
      console.warn(`Connection error with ${url}:`, e);
      lastError = e;
    }
  }
  throw lastError || new Error("All Overpass instances failed.");
};

// --- HELPER: Type Mapping ---
const mapOsmTypeToPoiType = (tags: any): POIType | null => {
  // Fountains
  if (tags.amenity === 'drinking_water' || tags.natural === 'spring') return POIType.FOUNTAIN;
  if (tags.tourism === 'picnic_site' || tags.leisure === 'picnic_table') return POIType.PICNIC;
  if (tags.tourism === 'viewpoint') return POIType.VIEWPOINT;
  
  const name = tags.name || '';
  const nameLower = name.toLowerCase();

  // Structures
  if (tags.tourism === 'wilderness_hut') return POIType.BIVOUAC;
  if (tags.tourism === 'alpine_hut') return POIType.REFUGE;
  
  // Shelters/Generic
  if (tags.amenity === 'shelter') {
    if (nameLower.includes('bivacco') || nameLower.includes('capanna')) return POIType.BIVOUAC;
  }

  // Name based fallback
  if (nameLower.includes('bivacco')) return POIType.BIVOUAC;
  if (nameLower.includes('rifugio')) return POIType.REFUGE;
  if (nameLower.includes('fontana') || nameLower.includes('sorgente')) return POIType.FOUNTAIN;
  
  return null;
};

// --- HELPER: Placeholder Images ---
const getPlaceHolderImage = (type: POIType) => {
  switch (type) {
    case POIType.FOUNTAIN: return 'https://images.unsplash.com/photo-1542385906-e789f28c5a24?w=400&q=80';
    case POIType.BIVOUAC: return 'https://images.unsplash.com/photo-1510312305653-8ed496efae75?w=400&q=80';
    case POIType.REFUGE: return 'https://images.unsplash.com/photo-1517627043994-b991abb62fc8?w=400&q=80';
    case POIType.PICNIC: return 'https://images.unsplash.com/photo-1519331379826-f10be5486c6f?w=400&q=80';
    case POIType.VIEWPOINT: return 'https://images.unsplash.com/photo-1464822759023-fed622ff2c3b?w=400&q=80';
    default: return 'https://images.unsplash.com/photo-1464822759023-fed622ff2c3b?w=400&q=80';
  }
};

// --- HELPER: Build Wikipedia Link ---
const buildWikipediaLink = (tags: any): string | undefined => {
    const wikiKey = tags.wikipedia; // e.g. "it:Monte Bianco"
    if (!wikiKey) return undefined;
    const parts = wikiKey.split(':');
    if (parts.length === 2) {
        return `https://${parts[0]}.wikipedia.org/wiki/${parts[1]}`;
    }
    return undefined;
};

// --- HELPER: Fetch Altitude for Single Coordinate (con Fallback Altimetrico Offline IDW) ---
export const fetchAltitudeForCoordinate = async (lat: number, lng: number): Promise<number | null> => {
  const cacheKey = `${lat.toFixed(4)},${lng.toFixed(4)}`;
  if (elevationCache.has(cacheKey)) {
    return elevationCache.get(cacheKey)!;
  }

  if (typeof navigator !== 'undefined' && !navigator.onLine) {
    return estimateOfflineAltitude(lat, lng);
  }

  try {
    const url = `${ELEVATION_API_URL}?latitude=${lat.toFixed(5)}&longitude=${lng.toFixed(5)}`;
    const res = await fetch(url);
    if (!res.ok) return estimateOfflineAltitude(lat, lng);
    const data = await res.json();
    if (data && data.elevation && Array.isArray(data.elevation) && data.elevation.length > 0) {
      const ele = Math.round(data.elevation[0]);
      if (!isNaN(ele) && ele > 0) {
        elevationCache.set(cacheKey, ele);
        persistDemCache();
        return ele;
      }
    }
    return estimateOfflineAltitude(lat, lng);
  } catch (err) {
    console.warn("Single altitude lookup offline fallback:", err);
    return estimateOfflineAltitude(lat, lng);
  }
};

// --- HELPER: Altitude Enrichment (Optimized Batching & Cache) ---
export const enrichPoisWithAltitude = async (pois: POI[]): Promise<POI[]> => {
  const poisMissingAlt = pois.filter(p => !p.altitude || p.altitude === 0);
  if (poisMissingAlt.length === 0) return pois;

  // First apply cached values
  const remaining: POI[] = [];
  const updatedPois = pois.map(p => {
    if (!p.altitude || p.altitude === 0) {
      const cacheKey = `${p.coordinates.lat.toFixed(4)},${p.coordinates.lng.toFixed(4)}`;
      if (elevationCache.has(cacheKey)) {
        return { ...p, altitude: elevationCache.get(cacheKey)! };
      }
      remaining.push(p);
    }
    return p;
  });

  if (remaining.length === 0) return updatedPois;

  // Se siamo offline, usa l'interpolazione IDW sui punti noti
  if (typeof navigator !== 'undefined' && !navigator.onLine) {
    return updatedPois.map(p => {
      if (!p.altitude || p.altitude === 0) {
        const est = estimateOfflineAltitude(p.coordinates.lat, p.coordinates.lng);
        if (est && est > 0) return { ...p, altitude: est };
      }
      return p;
    });
  }

  // Prioritize BIVOUAC and REFUGE first so mountain huts always get DEM altitude first
  remaining.sort((a, b) => {
    const aPri = a.type === POIType.BIVOUAC ? 2 : a.type === POIType.REFUGE ? 1 : 0;
    const bPri = b.type === POIType.BIVOUAC ? 2 : b.type === POIType.REFUGE ? 1 : 0;
    return bPri - aPri;
  });

  // Batch in chunks of 80 coordinates to avoid Open-Meteo URL overflow
  const CHUNK_SIZE = 80;
  const toProcess = remaining.slice(0, 160);
  let demUpdated = false;

  for (let i = 0; i < toProcess.length; i += CHUNK_SIZE) {
    const chunk = toProcess.slice(i, i + CHUNK_SIZE);
    const lats = chunk.map(p => p.coordinates.lat.toFixed(5)).join(',');
    const lngs = chunk.map(p => p.coordinates.lng.toFixed(5)).join(',');

    try {
      const url = `${ELEVATION_API_URL}?latitude=${lats}&longitude=${lngs}`;
      const res = await fetch(url);
      if (!res.ok) continue;
      const data = await res.json();
      
      if (data && data.elevation && Array.isArray(data.elevation)) {
        data.elevation.forEach((ele: number, index: number) => {
          if (chunk[index] && typeof ele === 'number' && !isNaN(ele)) {
            const rounded = Math.round(ele);
            const cacheKey = `${chunk[index].coordinates.lat.toFixed(4)},${chunk[index].coordinates.lng.toFixed(4)}`;
            elevationCache.set(cacheKey, rounded);
            demUpdated = true;
            const targetIdx = updatedPois.findIndex(p => p.id === chunk[index].id);
            if (targetIdx !== -1) {
              updatedPois[targetIdx] = { ...updatedPois[targetIdx], altitude: rounded };
            }
          }
        });
      }
    } catch (e) {
      console.warn("Altitude batch error:", e);
    }
  }

  if (demUpdated) {
    persistDemCache();
  }

  return updatedPois;
};

// --- HELPER: Process OSM Elements (Overpass) ---
const processOsmElements = (elements: any[], filterType: POIType[] | POIType | 'All'): POI[] => {
  const allowedTypes = Array.isArray(filterType) 
    ? filterType 
    : filterType === 'All' 
      ? null 
      : [filterType];

  return elements
      .filter((el: any) => (el.type === 'node' || el.type === 'way') && el.tags)
      .map((el: any) => {
        const type = mapOsmTypeToPoiType(el.tags);
        if (!type) return null;
        if (allowedTypes && !allowedTypes.includes(type)) return null;

        const osmAltitude = el.tags.ele ? parseInt(el.tags.ele) : 0;
        const lat = el.lat || el.center?.lat;
        const lng = el.lon || el.center?.lon;

        if (!lat || !lng) return null;

        const hasWater = type === POIType.FOUNTAIN || el.tags.drinking_water === 'yes';
        const hasRoof = type === POIType.BIVOUAC || type === POIType.REFUGE || el.tags.amenity === 'shelter';
        
        // --- EXTENDED DATA EXTRACTION ---
        const capacity = el.tags.sleeping_places || el.tags.capacity ? parseInt(el.tags.sleeping_places || el.tags.capacity) : undefined;
        const operator = el.tags.operator;
        const website = el.tags.website || el.tags['contact:website'] || el.tags.url;
        const access = el.tags.access; // yes, private, permit
        const fee = el.tags.fee === 'yes';
        const material = el.tags.material || el.tags['building:material'];
        const hikingDifficulty = el.tags.sac_scale; // T1, T2...
        const surfaceType = el.tags.surface;
        const wikipediaLink = buildWikipediaLink(el.tags);

        // Build a smarter description if missing
        let description = el.tags.description || el.tags.note;
        if (!description) {
           const parts = [];
           if (operator) parts.push(`Gestito da: ${operator}.`);
           if (capacity) parts.push(`Posti letto: ${capacity}.`);
           if (access === 'private') parts.push('Accesso privato/chiavi.');
           if (el.tags.fireplace === 'yes') parts.push('Dotato di stufa/camino.');
           if (hikingDifficulty) parts.push(`Difficoltà: ${hikingDifficulty.toUpperCase()}.`);
           if (type === POIType.BIVOUAC && parts.length === 0) parts.push('Bivacco non custodito.');
           description = parts.join(' ');
        }
        
        return {
          id: `osm-${el.id}`,
          name: el.tags.name || `${type} Senza Nome`,
          type: type,
          altitude: osmAltitude, 
          coordinates: { lat: lat, lng: lng },
          exposure: Exposure.VARIOUS,
          signal: SignalStrength.NONE,
          hasWater: hasWater,
          hasRoof: hasRoof,
          hasElectricity: el.tags.electricity === 'yes',
          hasFireplace: el.tags.fireplace === 'yes' || el.tags.heating === 'stove',
          description: description || (type === POIType.BIVOUAC ? 'Struttura in quota.' : 'Punto di interesse.'),
          imageUrl: getPlaceHolderImage(type),
          // Add extended fields
          capacity,
          operator,
          website,
          access,
          fee,
          material,
          hikingDifficulty,
          surfaceType,
          wikipediaLink
        };
      })
      .filter((poi: POI | null) => poi !== null) as POI[];
}

// --- NEW GLOBAL SEARCH (NOMINATIM) ---
export const searchOsmPoisByName = async (searchTerm: string, fastMode: boolean = false): Promise<POI[]> => {
  // Use Nominatim API for text search
  try {
    const params = new URLSearchParams({
      q: searchTerm,
      format: 'json',
      limit: fastMode ? '5' : '15', // Fetch fewer items in fast/autocomplete mode
      addressdetails: '1',
      extratags: '1',
      // Bias search towards Italy/Alps roughly, but allow global
      viewbox: '6.6,47.1,18.5,36.6', 
      bounded: '0'
    });

    const response = await fetch(`${NOMINATIM_API_URL}?${params.toString()}`);
    if (!response.ok) throw new Error("Nominatim API error");
    
    const results = await response.json();

    const pois: POI[] = results
      .map((item: any) => {
        const tags = { 
            name: item.name, 
            ...item.extratags, 
            amenity: item.class === 'amenity' ? item.type : undefined,
            tourism: item.class === 'tourism' ? item.type : undefined,
            natural: item.class === 'natural' ? item.type : undefined
        };

        let finalType = mapOsmTypeToPoiType(tags);
        
        // --- SEARCH FIX: ALLOW GENERIC LOCATIONS ---
        // If it's not a standard POI (Bivouac/Refuge), check if it's a valid generic location
        if (!finalType) {
            const nameLower = item.display_name.toLowerCase();
            
            // Name-based override
            if (nameLower.includes('rifugio')) finalType = POIType.REFUGE;
            else if (nameLower.includes('bivacco')) finalType = POIType.BIVOUAC;
            
            // Geographic type override (Peaks, Cities, Localities)
            // If it's a place, boundary or natural feature, treat it as a Viewpoint/Destination
            else if (
                item.class === 'place' || 
                item.class === 'boundary' || 
                item.class === 'natural' ||
                item.type === 'peak' ||
                item.type === 'administrative'
            ) {
                finalType = POIType.VIEWPOINT; 
            }
        }

        // If filtering still failed, exclude it (e.g. roads, specific buildings without purpose)
        if (!finalType) return null;

        // Extended info from Nominatim extratags
        const capacity = item.extratags?.sleeping_places || item.extratags?.capacity ? parseInt(item.extratags.sleeping_places || item.extratags.capacity) : undefined;
        const hikingDifficulty = item.extratags?.sac_scale;
        const wikipediaLink = buildWikipediaLink(item.extratags || {});

        return {
            id: `nom-${item.place_id}`,
            name: item.name || item.display_name.split(',')[0],
            type: finalType,
            altitude: 0, // Nominatim doesn't always have elevation, enriched later
            coordinates: { lat: parseFloat(item.lat), lng: parseFloat(item.lon) },
            exposure: Exposure.VARIOUS,
            signal: SignalStrength.NONE,
            hasWater: finalType === POIType.FOUNTAIN,
            hasRoof: finalType !== POIType.FOUNTAIN && finalType !== POIType.VIEWPOINT && finalType !== POIType.PICNIC,
            hasElectricity: false,
            hasFireplace: false,
            description: item.display_name, // Full address as description for generic results
            imageUrl: getPlaceHolderImage(finalType),
            capacity: capacity,
            operator: item.extratags?.operator,
            website: item.extratags?.website || item.extratags?.url,
            hikingDifficulty,
            wikipediaLink
        };
      })
      .filter((p: POI | null) => p !== null);

    // Skip altitude enrichment for autocomplete to make it fast
    if (fastMode) return pois;

    return await enrichPoisWithAltitude(pois);

  } catch (e) {
    console.error("Search Error:", e);
    return [];
  }
};

// --- BOUNDING BOX SEARCH (OVERPASS) ---
export const fetchOsmPois = async (
  bounds: { south: number; west: number; north: number; east: number }, 
  filterType: POIType[] | POIType | 'All',
  signal?: AbortSignal
): Promise<POI[]> => {
  let queryFilters = '';
  const typesArray = Array.isArray(filterType) 
    ? filterType 
    : filterType === 'All' 
      ? [POIType.BIVOUAC, POIType.REFUGE, POIType.FOUNTAIN, POIType.PICNIC, POIType.VIEWPOINT] 
      : [filterType];

  if (typesArray.length === 0) return [];

  const includeFountains = typesArray.includes(POIType.FOUNTAIN);
  const includeBivouacs = typesArray.includes(POIType.BIVOUAC);
  const includeRefuges = typesArray.includes(POIType.REFUGE);
  const includePicnic = typesArray.includes(POIType.PICNIC);
  const includeViewpoint = typesArray.includes(POIType.VIEWPOINT);

  const bbox = `(${bounds.south},${bounds.west},${bounds.north},${bounds.east})`;

  if (includeFountains) {
    queryFilters += `
      node["amenity"="drinking_water"]${bbox};
      node["natural"="spring"]${bbox};
    `;
  }

  if (includeBivouacs) {
    queryFilters += `
      node["tourism"="wilderness_hut"]${bbox};
      way["tourism"="wilderness_hut"]${bbox};
      node["amenity"="shelter"]["name"~"Bivacco",i]${bbox};
    `;
  }

  if (includeRefuges) {
     queryFilters += `
       node["tourism"="alpine_hut"]${bbox};
       way["tourism"="alpine_hut"]${bbox};
     `;
  }

  if (includePicnic) {
     queryFilters += `
       node["tourism"="picnic_site"]${bbox};
       way["tourism"="picnic_site"]${bbox};
     `;
  }

  if (includeViewpoint) {
     queryFilters += `
       node["tourism"="viewpoint"]${bbox};
     `;
  }

  if (!queryFilters.trim()) return [];

  const query = `
    [out:json][timeout:90];
    (
      ${queryFilters}
    );
    out center qt 8000;
  `;

  try {
    const data = await fetchOverpassData(query, signal);
    if (!data.elements) return [];

    let pois = processOsmElements(data.elements, filterType);
    
    // Enrich POIs with DEM altitude
    if (pois.length > 0) {
       pois = await enrichPoisWithAltitude(pois);
    }
    
    return pois;

  } catch (error: any) {
    if (error.name === 'AbortError') return []; 
    console.warn("Error fetching OSM data:", error);
    return [];
  }
};

// --- [MODULAR FEATURE 1.2 & PEAK CALIBRATION] GPX WAYTYPES, SURFACES, SAC DIFFICULTY & OFFICIAL OSM PEAK ELEVATION ---
export interface DetectedTrackPeak {
  id: string;
  name: string;
  ele: number;
  rawGpxEle: number;
  lat: number;
  lng: number;
  pointIndex: number;
  distKm: number;
  distanceToTrackMeters: number;
  kind: 'peak' | 'saddle';
}

export interface GpxTrailAnalysisResult {
  trackId: string;
  waytypes: {
    alpinePathPct: number;
    hikingPathPct: number;
    forestTrackPct: number;
    pavedRoadPct: number;
    alpinePathKm: number;
    hikingPathKm: number;
    forestTrackKm: number;
    pavedRoadKm: number;
  };
  surfaces: {
    rockScreePct: number;
    naturalEarthPct: number;
    gravelCompactedPct: number;
    asphaltPavedPct: number;
    rockScreeKm: number;
    naturalEarthKm: number;
    gravelCompactedKm: number;
    asphaltPavedKm: number;
  };
  sacDistribution: {
    t1Pct: number;
    t2Pct: number;
    t3Pct: number;
    t4PlusPct: number;
  };
  overallCaiGrade: 'T' | 'E' | 'EE' | 'EEA / F';
  overallSacScale: 'T1' | 'T2' | 'T3' | 'T4+';
  overallDifficultyLabel: string;
  hasViaFerrataOrAssisted: boolean;
  detectedPeaks: DetectedTrackPeak[];
  calibratedMaxElevation: number;
  rawGpxMaxElevation: number;
  maxElevationSource: 'osm_peak' | 'dem_calibrated' | 'gpx_native';
  summitName?: string;
  calibratedPointUpdates: { index: number; newEle: number }[];
  osmMatchedSegmentsPct?: number;
}

const fetchTrailOverpassData = async (query: string): Promise<any> => {
  // Ordine server dedicato (Kumi / Mail.ru prioritari) per non entrare in collisione 429 con fetchOsmPois su overpass-api.de
  const instances = [
    'https://overpass.kumi.systems/api/interpreter',
    'https://overpass-api.de/api/interpreter',
    'https://maps.mail.ru/osm/tools/overpass/api/interpreter',
    'https://api.openstreetmap.fr/oapi/interpreter',
  ];

  for (const url of instances) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 9500);
    try {
      const formData = new URLSearchParams();
      formData.append('data', query);

      const response = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded; charset=UTF-8' },
        body: formData,
        signal: controller.signal,
      });
      clearTimeout(timer);

      if (!response.ok) continue;
      const text = await response.text();
      if (text.trim().startsWith('<')) continue;
      const parsed = JSON.parse(text);
      if (parsed && Array.isArray(parsed.elements)) {
        return parsed;
      }
    } catch {
      clearTimeout(timer);
    }
  }
  return null;
};

const parseOsmElevationTag = (rawEle: string | number | undefined): number | null => {
  if (rawEle === undefined || rawEle === null) return null;
  const s = String(rawEle).trim();
  if (!s) return null;
  // Gestisce formati come "2.220" (separatore migliaia italiano) vs "2220.5"
  const thousandMatch = s.match(/^(\d)\.(\d{3})(?:\s*m)?$/i);
  if (thousandMatch) {
    return parseInt(thousandMatch[1] + thousandMatch[2], 10);
  }
  const cleaned = s.replace(',', '.').replace(/[^\d.-]/g, '');
  const val = parseFloat(cleaned);
  if (!isNaN(val) && val > 0 && val < 9000) {
    return Math.round(val);
  }
  return null;
};

export const analyzeGpxTrailAndPeaks = async (
  trackId: string,
  points: { lat: number; lng: number; ele: number; dist: number }[],
  rawMaxElevation: number
): Promise<GpxTrailAnalysisResult | null> => {
  if (!points || points.length < 2) return null;

  const haversineKm = (lat1: number, lon1: number, lat2: number, lon2: number) => {
    const R = 6371;
    const dLat = ((lat2 - lat1) * Math.PI) / 180;
    const dLon = ((lon2 - lon1) * Math.PI) / 180;
    const a =
      Math.sin(dLat / 2) * Math.sin(dLat / 2) +
      Math.cos((lat1 * Math.PI) / 180) *
        Math.cos((lat2 * Math.PI) / 180) *
        Math.sin(dLon / 2) *
        Math.sin(dLon / 2);
    return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  };

  // Distanza esatta punto P -> segmento [A, B] in km (proiezione equirettangolare locale)
  const distToSegmentKm = (
    pLat: number,
    pLng: number,
    aLat: number,
    aLng: number,
    bLat: number,
    bLng: number
  ): number => {
    const cosLat = Math.cos(((pLat + aLat + bLat) / 3) * (Math.PI / 180));
    const kx = 111.32 * cosLat;
    const ky = 111.132;
    const px = (pLng - aLng) * kx;
    const py = (pLat - aLat) * ky;
    const bx = (bLng - aLng) * kx;
    const by = (bLat - aLat) * ky;
    const lenSq = bx * bx + by * by;
    let t = 0;
    if (lenSq > 1e-10) {
      t = Math.max(0, Math.min(1, (px * bx + py * by) / lenSq));
    }
    const dx = px - t * bx;
    const dy = py - t * by;
    return Math.sqrt(dx * dx + dy * dy);
  };

  let south = Infinity;
  let north = -Infinity;
  let west = Infinity;
  let east = -Infinity;
  let highestIdx = 0;
  let highestEle = -Infinity;
  let lowestEle = Infinity;

  points.forEach((p, idx) => {
    if (p.lat < south) south = p.lat;
    if (p.lat > north) north = p.lat;
    if (p.lng < west) west = p.lng;
    if (p.lng > east) east = p.lng;
    if (p.ele > highestEle) {
      highestEle = p.ele;
      highestIdx = idx;
    }
    if (p.ele < lowestEle) {
      lowestEle = p.ele;
    }
  });

  // Se il GPX era privo di quote valide (es. tutto a 0m), campiona quote DEM sui punti chiave
  let workingPoints = points;
  let effectiveRawMax = rawMaxElevation > 0 ? rawMaxElevation : highestEle;

  // Costruisce sotto-bounding-box lungo il tracciato per evitare query Overpass giganti su tracce diagonali
  const numChunks = Math.min(6, Math.max(1, Math.ceil(points.length / 70)));
  const chunkSize = Math.ceil(points.length / numChunks);
  const pad = 0.0028; // ~300m di margine attorno al sentiero per catturare cime (es. 2220m) e bivi
  const chunkBboxes: string[] = [];

  for (let c = 0; c < numChunks; c++) {
    const slice = points.slice(c * chunkSize, Math.min(points.length, (c + 1) * chunkSize + 1));
    if (slice.length === 0) continue;
    let cS = Infinity, cN = -Infinity, cW = Infinity, cE = -Infinity;
    for (const pt of slice) {
      if (pt.lat < cS) cS = pt.lat;
      if (pt.lat > cN) cN = pt.lat;
      if (pt.lng < cW) cW = pt.lng;
      if (pt.lng > cE) cE = pt.lng;
    }
    chunkBboxes.push(
      `(${(cS - pad).toFixed(5)},${(cW - pad).toFixed(5)},${(cN + pad).toFixed(5)},${(cE + pad).toFixed(5)})`
    );
  }

  const globalBbox = `(${(south - pad).toFixed(5)},${(west - pad).toFixed(5)},${(north + pad).toFixed(5)},${(east + pad).toFixed(5)})`;

  interface OsmWayGeom {
    tags: Record<string, string>;
    coords: { lat: number; lng: number }[];
    minLat: number;
    maxLat: number;
    minLng: number;
    maxLng: number;
  }

  const osmWays: OsmWayGeom[] = [];
  const osmPeakNodes: {
    id: string;
    lat: number;
    lng: number;
    tags: Record<string, string>;
  }[] = [];

  try {
    const wayClauses = chunkBboxes
      .map(
        b =>
          `way["highway"~"^(path|footway|track|bridleway|steps|via_ferrata|cycleway|service|unclassified|residential|tertiary|secondary|primary|living_street|pedestrian)$"]${b};`
      )
      .join('\n        ');

    // CRITICO: Usa `out body geom qt;` (NON `out geom tags` che in Overpass QL sopprime coordinate e geometry!)
    const query = `
      [out:json][timeout:15];
      (
        node["natural"~"^(peak|saddle|ridge|cliff|volcano)$"]${globalBbox};
        node["mountain_pass"="yes"]${globalBbox};
        node["tourism"="viewpoint"]["ele"]${globalBbox};
        ${wayClauses}
      );
      out body geom qt 4000;
    `;

    let data = (typeof navigator !== 'undefined' && !navigator.onLine) ? null : await fetchTrailOverpassData(query);

    // Se siamo offline o i server Overpass non rispondono, usa gli elementi OSM salvati nella cache persistente dell'area
    if (!data || !Array.isArray(data.elements) || data.elements.length === 0) {
      await ensureTrailNetworkCacheLoaded();
      const cachedElements = getCachedTrailElementsForBounds(south - pad, west - pad, north + pad, east + pad);
      if (cachedElements.length > 0) {
        data = { elements: cachedElements };
      }
    } else if (Array.isArray(data.elements) && data.elements.length > 0) {
      saveTrailElementsToCache(south - pad, west - pad, north + pad, east + pad, data.elements);
    }

    if (data && Array.isArray(data.elements)) {
      const seenNodeIds = new Set<number | string>();
      const seenWayIds = new Set<number | string>();

      for (const el of data.elements) {
        if (
          el.type === 'node' &&
          typeof el.lat === 'number' &&
          typeof el.lon === 'number' &&
          el.tags &&
          !seenNodeIds.has(el.id)
        ) {
          seenNodeIds.add(el.id);
          if (
            el.tags.natural === 'peak' ||
            el.tags.natural === 'saddle' ||
            el.tags.natural === 'ridge' ||
            el.tags.mountain_pass === 'yes' ||
            (el.tags.tourism === 'viewpoint' && el.tags.ele)
          ) {
            osmPeakNodes.push({
              id: `peak-${el.id}`,
              lat: el.lat,
              lng: el.lon,
              tags: el.tags,
            });
          }
        } else if (
          el.type === 'way' &&
          el.tags &&
          Array.isArray(el.geometry) &&
          el.geometry.length >= 2 &&
          !seenWayIds.has(el.id)
        ) {
          seenWayIds.add(el.id);
          let wMinLat = Infinity,
            wMaxLat = -Infinity,
            wMinLng = Infinity,
            wMaxLng = -Infinity;
          const coords: { lat: number; lng: number }[] = [];

          for (let k = 0; k < el.geometry.length; k++) {
            const g = el.geometry[k];
            if (typeof g?.lat === 'number' && typeof g?.lon === 'number') {
              coords.push({ lat: g.lat, lng: g.lon });
              if (g.lat < wMinLat) wMinLat = g.lat;
              if (g.lat > wMaxLat) wMaxLat = g.lat;
              if (g.lon < wMinLng) wMinLng = g.lon;
              if (g.lon > wMaxLng) wMaxLng = g.lon;
            }
          }

          if (coords.length >= 2) {
            osmWays.push({
              tags: el.tags,
              coords,
              minLat: wMinLat - 0.0012,
              maxLat: wMaxLat + 0.0012,
              minLng: wMinLng - 0.0016,
              maxLng: wMaxLng + 0.0016,
            });
          }
        }
      }
    }
  } catch (err) {
    console.warn('Overpass GPX Trail & Peak analysis fallback:', err);
  }

  // 1. Rilevamento Cime e Passi OSM lungo il tracciato (distanza punto-segmento entro 240m, o 290m vicino al punto più alto)
  const detectedPeaks: DetectedTrackPeak[] = [];
  const calibratedPointUpdates: { index: number; newEle: number }[] = [];

  for (const pk of osmPeakNodes) {
    let bestIdx = 0;
    let minVertexDistKm = Infinity;
    let minSegDistKm = Infinity;

    for (let i = 0; i < workingPoints.length; i++) {
      const dV = haversineKm(pk.lat, pk.lng, workingPoints[i].lat, workingPoints[i].lng);
      if (dV < minVertexDistKm) {
        minVertexDistKm = dV;
        bestIdx = i;
      }
      if (i > 0) {
        const dS = distToSegmentKm(
          pk.lat,
          pk.lng,
          workingPoints[i - 1].lat,
          workingPoints[i - 1].lng,
          workingPoints[i].lat,
          workingPoints[i].lng
        );
        if (dS < minSegDistKm) {
          minSegDistKm = dS;
        }
      }
    }

    const effectiveDistKm = Math.min(minVertexDistKm, minSegDistKm);
    const isNearHighestPoint = Math.abs(bestIdx - highestIdx) <= Math.max(8, Math.round(workingPoints.length * 0.05));
    const maxAllowedDistKm = isNearHighestPoint ? 0.29 : 0.23;

    if (effectiveDistKm <= maxAllowedDistKm) {
      const officialEle = parseOsmElevationTag(pk.tags.ele);

      if (officialEle && officialEle > 0) {
        const kind: 'peak' | 'saddle' =
          pk.tags.natural === 'saddle' || pk.tags.mountain_pass === 'yes' ? 'saddle' : 'peak';

        const duplicate = detectedPeaks.find(
          existing =>
            Math.abs(existing.ele - officialEle) <= 5 &&
            haversineKm(existing.lat, existing.lng, pk.lat, pk.lng) < 0.18
        );

        if (!duplicate) {
          let targetIdx = bestIdx;
          if (kind === 'peak') {
            let localMaxE = workingPoints[bestIdx].ele;
            const searchWindow = 6;
            for (
              let j = Math.max(0, bestIdx - searchWindow);
              j <= Math.min(workingPoints.length - 1, bestIdx + searchWindow);
              j++
            ) {
              if (workingPoints[j].ele >= localMaxE) {
                localMaxE = workingPoints[j].ele;
                targetIdx = j;
              }
            }
          }

          detectedPeaks.push({
            id: pk.id,
            name: pk.tags.name || (kind === 'saddle' ? 'Forcella / Passo' : 'Cima Quotata'),
            ele: officialEle,
            rawGpxEle: Math.round(workingPoints[targetIdx].ele),
            lat: pk.lat,
            lng: pk.lng,
            pointIndex: targetIdx,
            distKm: workingPoints[targetIdx].dist,
            distanceToTrackMeters: Math.round(effectiveDistKm * 1000),
            kind,
          });

          if (kind === 'peak' && Math.abs(officialEle - workingPoints[targetIdx].ele) >= 1) {
            calibratedPointUpdates.push({ index: targetIdx, newEle: officialEle });
          }
        }
      }
    }
  }

  // Ordina cime per quota decrescente
  detectedPeaks.sort((a, b) => b.ele - a.ele);

  // Determina la quota massima reale calibrata (allineata alla cima sulla mappa OSM se presente, es. 2220m)
  let calibratedMaxElevation = Math.round(effectiveRawMax);
  let maxElevationSource: 'osm_peak' | 'dem_calibrated' | 'gpx_native' = 'gpx_native';
  let summitName: string | undefined = undefined;

  const highestOsmPeak = detectedPeaks.find(p => p.kind === 'peak');
  if (
    highestOsmPeak &&
    (highestOsmPeak.ele >= calibratedMaxElevation - 95 ||
      Math.abs(highestOsmPeak.ele - calibratedMaxElevation) <= 130)
  ) {
    calibratedMaxElevation = highestOsmPeak.ele;
    maxElevationSource = 'osm_peak';
    summitName = highestOsmPeak.name;

    // Assicura che anche il punto di massimo assoluto del GPX non resti sopra/sotto la quota ufficiale della vetta
    if (!calibratedPointUpdates.some(u => u.index === highestIdx)) {
      calibratedPointUpdates.push({ index: highestIdx, newEle: highestOsmPeak.ele });
    }
  } else {
    // Verifica DEM sul punto più alto del GPX (con timeout rapido)
    try {
      const demAtHighest = await fetchAltitudeForCoordinate(
        workingPoints[highestIdx].lat,
        workingPoints[highestIdx].lng
      );
      if (demAtHighest && (effectiveRawMax <= 0 || Math.abs(demAtHighest - effectiveRawMax) > 20)) {
        calibratedMaxElevation = demAtHighest;
        maxElevationSource = 'dem_calibrated';
        calibratedPointUpdates.push({ index: highestIdx, newEle: demAtHighest });
      }
    } catch {
      // Fallback silenzioso a quota nativa GPX
    }
  }

  // 2. Analisi Waytypes (Tipologia Percorso), Surfaces (Fondo) e Difficoltà SAC lungo i segmenti GPX
  let alpinePathKm = 0;
  let hikingPathKm = 0;
  let forestTrackKm = 0;
  let pavedRoadKm = 0;

  let rockScreeKm = 0;
  let naturalEarthKm = 0;
  let gravelCompactedKm = 0;
  let asphaltPavedKm = 0;

  let t1Km = 0;
  let t2Km = 0;
  let t3Km = 0;
  let t4PlusKm = 0;

  let hasViaFerrataOrAssisted = false;
  let osmMatchedCount = 0;
  let validSegCount = 0;

  const eleSpan = Math.max(100, (calibratedMaxElevation || highestEle) - (lowestEle < Infinity ? lowestEle : 0));
  const baseMinEle = lowestEle < Infinity ? lowestEle : 0;

  let lastMatchedTags: Record<string, string> | null = null;
  let carryOverLeft = 0;

  for (let i = 1; i < workingPoints.length; i++) {
    const pPrev = workingPoints[i - 1];
    const pCurr = workingPoints[i];
    const segDist = Math.max(0, pCurr.dist - pPrev.dist);
    if (segDist <= 0) continue;
    validSegCount++;

    const midLat = (pPrev.lat + pCurr.lat) / 2;
    const midLng = (pPrev.lng + pCurr.lng) / 2;
    const avgEle = (pPrev.ele + pCurr.ele) / 2;
    const relEle = Math.max(0, Math.min(1, (avgEle - baseMinEle) / eleSpan));

    // Calcola pendenza smussata su finestra di ±1 punto per evitare rumore puntuale GPS
    const pStart = workingPoints[Math.max(0, i - 2)];
    const pEnd = workingPoints[Math.min(workingPoints.length - 1, i + 1)];
    const winDist = Math.max(segDist, pEnd.dist - pStart.dist);
    const absGrade =
      winDist > 0.004
        ? Math.min(85, Math.abs(((pEnd.ele - pStart.ele) / (winDist * 1000)) * 100))
        : 0;

    // Cerca la way OSM più vicina entro 95 metri usando distanza esatta punto-segmento
    let matchedTags: Record<string, string> | null = null;
    let bestWayDist = 0.095;

    for (const w of osmWays) {
      if (
        midLat < w.minLat ||
        midLat > w.maxLat ||
        midLng < w.minLng ||
        midLng > w.maxLng
      ) {
        continue;
      }
      const coords = w.coords;
      for (let k = 1; k < coords.length; k++) {
        const a = coords[k - 1];
        const b = coords[k];
        const d = distToSegmentKm(midLat, midLng, a.lat, a.lng, b.lat, b.lng);
        if (d < bestWayDist) {
          bestWayDist = d;
          matchedTags = w.tags;
        }
      }
    }

    if (matchedTags) {
      osmMatchedCount++;
      lastMatchedTags = matchedTags;
      carryOverLeft = 2; // Continuità su brevi gap GPS di 1-2 punti
    } else if (carryOverLeft > 0 && lastMatchedTags) {
      matchedTags = lastMatchedTags;
      carryOverLeft--;
    }

    const hw = (matchedTags?.highway || '').toLowerCase();
    const surf = (matchedTags?.surface || '').toLowerCase();
    const sac = (matchedTags?.sac_scale || '').toLowerCase();
    const tracktype = (matchedTags?.tracktype || '').toLowerCase();
    const smoothness = (matchedTags?.smoothness || '').toLowerCase();

    if (
      hw === 'via_ferrata' ||
      matchedTags?.via_ferrata_scale ||
      matchedTags?.assisted_trail === 'yes' ||
      matchedTags?.safety_rope === 'yes' ||
      matchedTags?.ladder === 'yes' ||
      matchedTags?.['Rung'] === 'yes'
    ) {
      hasViaFerrataOrAssisted = true;
    }

    // --- 1. Classificazione Waytype (Komoot: Sentiero Alpino, Sentiero, Forestale, Asfalto) ---
    let wayCategory: 'alpine' | 'hiking' | 'forest' | 'paved' = 'hiking';

    if (matchedTags) {
      if (
        hw === 'primary' ||
        hw === 'secondary' ||
        hw === 'tertiary' ||
        hw === 'residential' ||
        hw === 'living_street' ||
        hw === 'pedestrian' ||
        surf === 'asphalt' ||
        surf === 'paved' ||
        surf === 'concrete'
      ) {
        wayCategory = 'paved';
      } else if (
        hw === 'track' ||
        hw === 'service' ||
        hw === 'unclassified' ||
        hw === 'bridleway' ||
        hw === 'cycleway' ||
        tracktype.startsWith('grade')
      ) {
        wayCategory = 'forest';
      } else if (
        hw === 'via_ferrata' ||
        sac.includes('alpine_hiking') ||
        sac === 'demanding_mountain_hiking' ||
        (hw === 'path' && (avgEle >= 2000 || absGrade >= 19 || (relEle >= 0.72 && absGrade >= 14)))
      ) {
        wayCategory = 'alpine';
      } else {
        wayCategory = 'hiking';
      }
    } else {
      // Classificatore topografico/cinematico multi-banda quando il segmento non è mappato in OSM
      if (relEle < 0.08 && absGrade < 5 && avgEle < 1350) {
        wayCategory = 'paved';
      } else if ((relEle < 0.32 && absGrade < 10) || (avgEle < 1550 && absGrade < 8.5)) {
        wayCategory = 'forest';
      } else if (avgEle >= 2000 || absGrade >= 18 || (relEle >= 0.72 && absGrade >= 13)) {
        wayCategory = 'alpine';
      } else {
        wayCategory = 'hiking';
      }
    }

    if (wayCategory === 'alpine') alpinePathKm += segDist;
    else if (wayCategory === 'hiking') hikingPathKm += segDist;
    else if (wayCategory === 'forest') forestTrackKm += segDist;
    else pavedRoadKm += segDist;

    // --- 2. Classificazione Superficie / Fondo (Komoot: Roccia/Pietraia, Terra/Sentiero, Sterrato/Ghiaia, Asfalto/Lastricato) ---
    if (
      surf.includes('rock') ||
      surf.includes('stone') ||
      surf.includes('scree') ||
      surf.includes('pebble') ||
      surf.includes('boulder') ||
      smoothness === 'impassable' ||
      sac.includes('alpine_hiking') ||
      sac === 'demanding_mountain_hiking' ||
      (wayCategory === 'alpine' && (avgEle >= 1900 || absGrade >= 17 || relEle >= 0.75))
    ) {
      rockScreeKm += segDist;
    } else if (
      surf === 'asphalt' ||
      surf === 'paved' ||
      surf === 'concrete' ||
      surf === 'paving_stones' ||
      surf === 'cobblestone' ||
      surf === 'sett' ||
      wayCategory === 'paved'
    ) {
      asphaltPavedKm += segDist;
    } else if (
      surf.includes('gravel') ||
      surf === 'compacted' ||
      surf === 'fine_gravel' ||
      tracktype === 'grade1' ||
      tracktype === 'grade2' ||
      tracktype === 'grade3' ||
      wayCategory === 'forest' ||
      (wayCategory === 'hiking' && absGrade < 7.5 && relEle < 0.35)
    ) {
      gravelCompactedKm += segDist;
    } else {
      naturalEarthKm += segDist;
    }

    // --- 3. Classificazione Difficoltà SAC / CAI ---
    if (
      hw === 'via_ferrata' ||
      sac.includes('alpine_hiking') ||
      absGrade >= 28 ||
      (avgEle >= 2250 && absGrade >= 22)
    ) {
      t4PlusKm += segDist;
    } else if (
      sac === 'demanding_mountain_hiking' ||
      absGrade >= 17 ||
      (wayCategory === 'alpine' && (avgEle >= 1850 || relEle >= 0.75))
    ) {
      t3Km += segDist;
    } else if (
      sac === 'mountain_hiking' ||
      wayCategory === 'alpine' ||
      wayCategory === 'hiking' ||
      absGrade >= 8.5
    ) {
      t2Km += segDist;
    } else {
      t1Km += segDist;
    }
  }

  const totalWayKm = alpinePathKm + hikingPathKm + forestTrackKm + pavedRoadKm || 1;
  const totalSurfKm = rockScreeKm + naturalEarthKm + gravelCompactedKm + asphaltPavedKm || 1;
  const totalSacKm = t1Km + t2Km + t3Km + t4PlusKm || 1;

  // Calcolo percentuali esatte con ribilanciamento sulla categoria dominante per sommare sempre a 100%
  const computeBalancedPercentages = (values: number[], total: number): [number, number, number, number] => {
    const raw = values.map(v => Math.round((v / total) * 100));
    const sum = raw[0] + raw[1] + raw[2] + raw[3];
    if (sum !== 100 && total > 0) {
      let maxIdx = 0;
      for (let idx = 1; idx < 4; idx++) {
        if (values[idx] > values[maxIdx]) maxIdx = idx;
      }
      raw[maxIdx] = Math.max(0, raw[maxIdx] + (100 - sum));
    }
    return [raw[0], raw[1], raw[2], raw[3]];
  };

  const [t1Pct, t2Pct, t3Pct, t4PlusPct] = computeBalancedPercentages(
    [t1Km, t2Km, t3Km, t4PlusKm],
    totalSacKm
  );

  const [alpinePathPct, hikingPathPct, forestTrackPct, pavedRoadPct] = computeBalancedPercentages(
    [alpinePathKm, hikingPathKm, forestTrackKm, pavedRoadKm],
    totalWayKm
  );

  const [rockScreePct, naturalEarthPct, gravelCompactedPct, asphaltPavedPct] = computeBalancedPercentages(
    [rockScreeKm, naturalEarthKm, gravelCompactedKm, asphaltPavedKm],
    totalSurfKm
  );

  let overallCaiGrade: 'T' | 'E' | 'EE' | 'EEA / F' = 'E';
  let overallSacScale: 'T1' | 'T2' | 'T3' | 'T4+' = 'T2';
  let overallDifficultyLabel = 'Escursionistico (Passo fermo, sentiero montano)';

  if (hasViaFerrataOrAssisted || t4PlusPct >= 8) {
    overallCaiGrade = 'EEA / F';
    overallSacScale = 'T4+';
    overallDifficultyLabel = hasViaFerrataOrAssisted
      ? 'Escursionisti Esperti con Attrezzatura / Tratti Attrezzati'
      : 'Alpinistico / Tratti molto ripidi o esposti su roccia';
  } else if (t3Pct >= 14 || t3Pct + t4PlusPct >= 16) {
    overallCaiGrade = 'EE';
    overallSacScale = 'T3';
    overallDifficultyLabel = 'Escursionisti Esperti (Terreno impervio, tratti ripidi o pietraia)';
  } else if (t2Pct >= 18 || t3Pct >= 4) {
    overallCaiGrade = 'E';
    overallSacScale = 'T2';
    overallDifficultyLabel = 'Escursionistico (Sentiero di montagna con pendenze moderate)';
  } else {
    overallCaiGrade = 'T';
    overallSacScale = 'T1';
    overallDifficultyLabel = 'Turistico (Percorso agevole su mulattiere o strade forestali)';
  }

  return {
    trackId,
    waytypes: {
      alpinePathPct,
      hikingPathPct,
      forestTrackPct,
      pavedRoadPct,
      alpinePathKm: Number(alpinePathKm.toFixed(1)),
      hikingPathKm: Number(hikingPathKm.toFixed(1)),
      forestTrackKm: Number(forestTrackKm.toFixed(1)),
      pavedRoadKm: Number(pavedRoadKm.toFixed(1)),
    },
    surfaces: {
      rockScreePct,
      naturalEarthPct,
      gravelCompactedPct,
      asphaltPavedPct,
      rockScreeKm: Number(rockScreeKm.toFixed(1)),
      naturalEarthKm: Number(naturalEarthKm.toFixed(1)),
      gravelCompactedKm: Number(gravelCompactedKm.toFixed(1)),
      asphaltPavedKm: Number(asphaltPavedKm.toFixed(1)),
    },
    sacDistribution: {
      t1Pct,
      t2Pct,
      t3Pct,
      t4PlusPct,
    },
    overallCaiGrade,
    overallSacScale,
    overallDifficultyLabel,
    hasViaFerrataOrAssisted,
    detectedPeaks,
    calibratedMaxElevation,
    rawGpxMaxElevation: Math.round(effectiveRawMax),
    maxElevationSource,
    summitName,
    calibratedPointUpdates,
    osmMatchedSegmentsPct: validSegCount > 0 ? Math.round((osmMatchedCount / validSegCount) * 100) : 0,
  };
};

// --- [MODULAR FEATURE 1.3] PIANIFICATORE RAPIDO "AGGIUNGI AL TOUR" (MULTI-WAYPOINT HIKING ROUTE BUILDER) ---

export interface TourWaypoint {
  id: string;
  name: string;
  lat: number;
  lng: number;
  altitude: number | null;
  category?: string;
}

export interface TourLegSummary {
  fromName: string;
  toName: string;
  distanceKm: number;
  elevationGain: number;
  elevationLoss: number;
  durationMinutes: number;
}

export interface ComputedTourRoute {
  latlngs: [number, number][];
  points: {
    lat: number;
    lng: number;
    ele: number;
    dist: number;
  }[];
  stats: {
    totalDistance: number;
    elevationGain: number;
    elevationLoss: number;
    minElevation: number;
    maxElevation: number;
    totalTimeSeconds: number;
    avgSpeedKmh: number;
    maxGrade: number;
    avgGrade: number;
    isEstimatedTime: boolean;
    vam?: number;
  };
  legs: TourLegSummary[];
  routingSource: 'brouter_hiking' | 'osm_foot' | 'direct_trail';
}

// Calcolo rapido distanza geodetica in km (usato dal router sentieri e dal calcolo tappe)
const distKmFast = (lat1: number, lon1: number, lat2: number, lon2: number): number => {
  const R = 6371;
  const dLat = ((lat2 - lat1) * Math.PI) / 180;
  const dLon = ((lon2 - lon1) * Math.PI) / 180;
  const a =
    Math.sin(dLat / 2) * Math.sin(dLat / 2) +
    Math.cos((lat1 * Math.PI) / 180) *
      Math.cos((lat2 * Math.PI) / 180) *
      Math.sin(dLon / 2) *
      Math.sin(dLon / 2);
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
};

// Cache in-memory + IndexedDB delle reti sentieristiche e cime Overpass per area geografica
interface CachedTrailNetworkArea {
  south: number;
  west: number;
  north: number;
  east: number;
  elements: any[];
  timestamp: number;
}

const trailNetworkCache: CachedTrailNetworkArea[] = [];
let isTrailNetworkCacheHydrated = false;

const ensureTrailNetworkCacheLoaded = async () => {
  if (isTrailNetworkCacheHydrated) return;
  isTrailNetworkCacheHydrated = true;
  try {
    const saved = await dbService.getOfflineItem<CachedTrailNetworkArea[]>('trail_networks_v1');
    if (Array.isArray(saved) && saved.length > 0) {
      saved.forEach(item => {
        if (item && Array.isArray(item.elements) && item.elements.length > 0) {
          trailNetworkCache.push(item);
        }
      });
    }
  } catch {}
};

// Avvia pre-idratazione asincrona all'avvio
ensureTrailNetworkCacheLoaded();

const saveTrailElementsToCache = (
  south: number,
  west: number,
  north: number,
  east: number,
  elements: any[]
) => {
  if (!elements || elements.length === 0) return;
  // Evita duplicati sulla stessa identica bbox
  const existingIdx = trailNetworkCache.findIndex(
    c =>
      Math.abs(c.south - south) < 0.005 &&
      Math.abs(c.west - west) < 0.005 &&
      Math.abs(c.north - north) < 0.005 &&
      Math.abs(c.east - east) < 0.005
  );
  if (existingIdx !== -1) {
    trailNetworkCache.splice(existingIdx, 1);
  }
  trailNetworkCache.push({
    south,
    west,
    north,
    east,
    elements,
    timestamp: Date.now(),
  });
  if (trailNetworkCache.length > 10) {
    trailNetworkCache.shift();
  }
  dbService.setOfflineItem('trail_networks_v1', trailNetworkCache);
};

const getCachedTrailElementsForBounds = (
  south: number,
  west: number,
  north: number,
  east: number
): any[] => {
  // 1. Cerca una singola area in cache che contenga l'intera bbox richiesta
  const covering = trailNetworkCache.find(
    c =>
      c.south <= south + 0.004 &&
      c.west <= west + 0.005 &&
      c.north >= north - 0.004 &&
      c.east >= east - 0.005
  );
  if (covering) return covering.elements;

  // 2. Altrimenti unisci tutte le aree in cache che si sovrappongono alla bbox richiesta
  const merged: any[] = [];
  const seen = new Set<string>();
  for (const c of trailNetworkCache) {
    const overlaps =
      c.south <= north + 0.01 &&
      c.north >= south - 0.01 &&
      c.west <= east + 0.01 &&
      c.east >= west - 0.01;
    if (overlaps) {
      for (const el of c.elements) {
        const k = `${el.type}-${el.id}`;
        if (!seen.has(k)) {
          seen.add(k);
          merged.push(el);
        }
      }
    }
  }
  return merged;
};

/**
 * Scarica e salva in IndexedDB la rete di sentieri e le cime OSM per l'area visibile ("Scarica area visibile")
 * così che sia il Pianificatore Tour (1.3) sia l'Analisi Percorso GPX (1.2) funzionino al 100% offline.
 */
export const preloadOfflineAreaTrailNetwork = async (bounds: {
  south: number;
  west: number;
  north: number;
  east: number;
}): Promise<number> => {
  await ensureTrailNetworkCacheLoaded();
  const latSpan = bounds.north - bounds.south;
  const lngSpan = bounds.east - bounds.west;
  // Se il viewport è troppo ampio (es. tutta l'Italia), ritaglia il riquadro centrale (~30x30km max) per non saturare Overpass
  const centerLat = (bounds.south + bounds.north) / 2;
  const centerLng = (bounds.west + bounds.east) / 2;
  const halfLat = Math.min(latSpan / 2, 0.14);
  const halfLng = Math.min(lngSpan / 2, 0.18);

  const s = (centerLat - halfLat).toFixed(5);
  const w = (centerLng - halfLng).toFixed(5);
  const n = (centerLat + halfLat).toFixed(5);
  const e = (centerLng + halfLng).toFixed(5);
  const bbox = `(${s},${w},${n},${e})`;

  const query = `
    [out:json][timeout:25];
    (
      node["natural"~"^(peak|saddle|ridge|cliff|volcano)$"]${bbox};
      node["mountain_pass"="yes"]${bbox};
      way["highway"~"^(path|footway|track|steps|bridleway|via_ferrata|cycleway|pedestrian|service|unclassified|tertiary|secondary)$"]${bbox};
    );
    out body geom qt 6000;
  `;

  let data = await fetchTrailOverpassData(query);
  if (!data || !Array.isArray(data.elements) || data.elements.length === 0) {
    try {
      data = await fetchOverpassData(query);
    } catch {
      data = null;
    }
  }

  const elements = Array.isArray(data?.elements) ? data.elements : [];
  if (elements.length > 0) {
    // Registra anche le quote delle cime OSM nella cache DEM offline
    for (const el of elements) {
      if (el.type === 'node' && el.tags?.ele && typeof el.lat === 'number' && typeof el.lon === 'number') {
        const parsedEle = parseOsmElevationTag(el.tags.ele);
        if (parsedEle && parsedEle > 0) {
          elevationCache.set(`${el.lat.toFixed(4)},${el.lon.toFixed(4)}`, parsedEle);
        }
      }
    }
    persistDemCache();
    saveTrailElementsToCache(
      centerLat - halfLat,
      centerLng - halfLng,
      centerLat + halfLat,
      centerLng + halfLng,
      elements
    );
  }
  return elements.length;
};

/**
 * Router Grafo Sentieri OSM Locale (Dijkstra / A* su geometrie reali Overpass `out body geom qt;`).
 * Costruisce il grafo topologico di tutti i sentieri escursionistici (`path`, `footway`, `track`, `steps`, `via_ferrata`, ecc.)
 * presenti sulla mappa nell'area del Tour e calcola il tracciato esatto lungo i sentieri reali.
 */
interface TrailGraphNode {
  id: number;
  lat: number;
  lng: number;
  edges: { to: number; cost: number }[];
}

const buildAndRouteOsmTrailGraph = async (
  waypoints: TourWaypoint[]
): Promise<{
  routedCoords: { lat: number; lng: number }[];
  snappedWaypoints: { lat: number; lng: number }[];
} | null> => {
  if (waypoints.length < 2) return null;

  await ensureTrailNetworkCacheLoaded();

  let minLat = Infinity;
  let maxLat = -Infinity;
  let minLng = Infinity;
  let maxLng = -Infinity;

  for (const w of waypoints) {
    if (w.lat < minLat) minLat = w.lat;
    if (w.lat > maxLat) maxLat = w.lat;
    if (w.lng < minLng) minLng = w.lng;
    if (w.lng > maxLng) maxLng = w.lng;
  }

  const latSpan = maxLat - minLat;
  const lngSpan = maxLng - minLng;
  // Evita query Overpass eccessivamente vaste (> ~45 km)
  if (latSpan > 0.42 || lngSpan > 0.55) return null;

  const padLat = Math.max(0.016, Math.min(0.048, latSpan * 0.45 + 0.014));
  const padLng = Math.max(0.022, Math.min(0.065, lngSpan * 0.45 + 0.018));

  const reqSouth = minLat - padLat;
  const reqWest = minLng - padLng;
  const reqNorth = maxLat + padLat;
  const reqEast = maxLng + padLng;

  try {
    // 1. Verifica se la rete sentieristica dell'area è già in cache (in-memory o IndexedDB offline)
    const now = Date.now();
    const isOfflineNow = typeof navigator !== 'undefined' && !navigator.onLine;
    let elements: any[] = [];
    const cached = trailNetworkCache.find(
      c =>
        (isOfflineNow || now - c.timestamp < 30 * 60 * 1000) &&
        c.south <= minLat - 0.004 &&
        c.west <= minLng - 0.005 &&
        c.north >= maxLat + 0.004 &&
        c.east >= maxLng + 0.005
    );

    if (cached) {
      elements = cached.elements;
    } else if (isOfflineNow) {
      elements = getCachedTrailElementsForBounds(minLat, minLng, maxLat, maxLng);
    } else {
      const south = reqSouth.toFixed(5);
      const west = reqWest.toFixed(5);
      const north = reqNorth.toFixed(5);
      const east = reqEast.toFixed(5);

      const query = `
        [out:json][timeout:18];
        (
          way["highway"~"^(path|footway|track|steps|bridleway|via_ferrata|cycleway|pedestrian|service|unclassified|tertiary|secondary|residential|living_street)$"](${south},${west},${north},${east});
        );
        out body geom qt;
      `;

      let data = await fetchTrailOverpassData(query);
      if (!data || !Array.isArray(data.elements) || data.elements.length === 0) {
        try {
          data = await fetchOverpassData(query);
        } catch {
          data = null;
        }
      }

      elements = Array.isArray(data?.elements) ? data.elements : [];
      if (elements.length > 0) {
        saveTrailElementsToCache(reqSouth, reqWest, reqNorth, reqEast, elements);
      } else {
        elements = getCachedTrailElementsForBounds(minLat, minLng, maxLat, maxLng);
      }
    }

    if (elements.length === 0) return null;

    const nodes: TrailGraphNode[] = [];
    const coordToNodeId = new Map<string, number>();

    const getOrCreateNode = (lat: number, lng: number): number => {
      // Precisione ~1.1m per fondere i nodi di incrocio condivisi tra sentieri OSM
      const key = `${lat.toFixed(5)},${lng.toFixed(5)}`;
      const existing = coordToNodeId.get(key);
      if (existing !== undefined) return existing;
      const id = nodes.length;
      nodes.push({ id, lat, lng, edges: [] });
      coordToNodeId.set(key, id);
      return id;
    };

    const addEdge = (u: number, v: number, cost: number) => {
      if (u === v) return;
      const nodeU = nodes[u];
      const nodeV = nodes[v];
      const existingU = nodeU.edges.find(e => e.to === v);
      if (existingU) {
        if (cost < existingU.cost) existingU.cost = cost;
      } else {
        nodeU.edges.push({ to: v, cost });
      }
      const existingV = nodeV.edges.find(e => e.to === u);
      if (existingV) {
        if (cost < existingV.cost) existingV.cost = cost;
      } else {
        nodeV.edges.push({ to: u, cost });
      }
    };

    // Peso fortemente preferenziale per i sentieri escursionistici (arancioni tratteggiati/continui sulla mappa)
    const getHighwayPreferenceFactor = (hw: string, sac?: string): number => {
      if (hw === 'path' || hw === 'footway' || hw === 'steps' || hw === 'bridleway' || hw === 'via_ferrata') {
        if (sac && (sac.includes('mountain_hiking') || sac.includes('hiking') || sac.includes('alpine_hiking'))) {
          return 0.72;
        }
        return 0.78;
      }
      if (hw === 'track') return 0.90;
      if (hw === 'pedestrian' || hw === 'cycleway') return 1.05;
      if (hw === 'service' || hw === 'unclassified' || hw === 'living_street') return 1.25;
      return 1.55; // Strade asfaltate usate solo se non esiste alcun sentiero alternativo
    };

    for (const el of elements) {
      if (el.type !== 'way' || !Array.isArray(el.geometry) || el.geometry.length < 2) continue;
      const hw = String(el.tags?.highway || 'path');
      const sac = el.tags?.sac_scale ? String(el.tags.sac_scale) : undefined;
      const factor = getHighwayPreferenceFactor(hw, sac);

      let prevNodeId: number | null = null;
      for (let i = 0; i < el.geometry.length; i++) {
        const pt = el.geometry[i];
        const lat = Number(pt.lat);
        const lng = Number(pt.lon);
        if (Number.isNaN(lat) || Number.isNaN(lng)) continue;

        // Registra SEMPRE il vertice OSM reale così tutti gli incroci tra way condividono lo stesso ID
        const curNodeId = getOrCreateNode(lat, lng);

        if (prevNodeId !== null && prevNodeId !== curNodeId) {
          const prevNode = nodes[prevNodeId];
          const segKm = distKmFast(prevNode.lat, prevNode.lng, lat, lng);
          // Suddivide segmenti lunghi (> 30m) inserendo nodi intermedi tra prevNodeId e curNodeId
          if (segKm > 0.030) {
            const subSteps = Math.min(16, Math.ceil(segKm / 0.024));
            let lastId = prevNodeId;
            const stepCost = Math.max(0.0003, (segKm / subSteps) * factor);
            for (let s = 1; s < subSteps; s++) {
              const t = s / subSteps;
              const iLat = prevNode.lat + (lat - prevNode.lat) * t;
              const iLng = prevNode.lng + (lng - prevNode.lng) * t;
              const midId = getOrCreateNode(iLat, iLng);
              addEdge(lastId, midId, stepCost);
              lastId = midId;
            }
            addEdge(lastId, curNodeId, stepCost);
          } else {
            addEdge(prevNodeId, curNodeId, Math.max(0.0003, segKm * factor));
          }
        }

        prevNodeId = curNodeId;
      }
    }

    if (nodes.length < 4) return null;

    // Griglia spaziale per chiudere micro-gap topologici tra bivi di sentieri OSM adiacenti
    const cellSize = 0.001; // ~100m
    const spatialGrid = new Map<string, number[]>();
    for (let i = 0; i < nodes.length; i++) {
      const gx = Math.floor(nodes[i].lng / cellSize);
      const gy = Math.floor(nodes[i].lat / cellSize);
      const gKey = `${gx},${gy}`;
      const bucket = spatialGrid.get(gKey);
      if (bucket) bucket.push(i);
      else spatialGrid.set(gKey, [i]);
    }

    for (let i = 0; i < nodes.length; i++) {
      const nA = nodes[i];
      const gx = Math.floor(nA.lng / cellSize);
      const gy = Math.floor(nA.lat / cellSize);
      for (let dx = -1; dx <= 1; dx++) {
        for (let dy = -1; dy <= 1; dy++) {
          const bucket = spatialGrid.get(`${gx + dx},${gy + dy}`);
          if (!bucket) continue;
          for (const j of bucket) {
            if (j <= i) continue;
            const nB = nodes[j];
            const dKm = distKmFast(nA.lat, nA.lng, nB.lat, nB.lng);
            if (dKm <= 0.065) {
              // Bivio ravvicinato / intersezione sentieri
              addEdge(i, j, dKm * 1.6);
            } else if (dKm <= 0.18 && (nA.edges.length <= 1 || nB.edges.length <= 1)) {
              // Raccordo tra fine sentiero e traccia vicina in quota
              addEdge(i, j, dKm * 4.5);
            }
          }
        }
      }
    }

    // Calcola le componenti connesse (Union-Find) per evitare di agganciarsi a frammenti isolati (es. vialetto di 15m di una baita)
    const compParent = new Int32Array(nodes.length);
    const compSize = new Int32Array(nodes.length);
    for (let i = 0; i < nodes.length; i++) {
      compParent[i] = i;
      compSize[i] = 1;
    }
    const findComp = (x: number): number => {
      let root = x;
      while (root !== compParent[root]) root = compParent[root];
      let curr = x;
      while (curr !== root) {
        const nxt = compParent[curr];
        compParent[curr] = root;
        curr = nxt;
      }
      return root;
    };
    const unionComp = (a: number, b: number) => {
      const rA = findComp(a);
      const rB = findComp(b);
      if (rA === rB) return;
      if (compSize[rA] < compSize[rB]) {
        compParent[rA] = rB;
        compSize[rB] += compSize[rA];
      } else {
        compParent[rB] = rA;
        compSize[rA] += compSize[rB];
      }
    };
    for (let i = 0; i < nodes.length; i++) {
      for (const e of nodes[i].edges) {
        if (e.to > i) unionComp(i, e.to);
      }
    }

    // Trova il nodo sentiero più vicino per ciascun waypoint (preferendo la rete principale rispetto a micro-segmenti isolati)
    const findNearestTrailNode = (lat: number, lng: number): { nodeId: number; distKm: number } => {
      let bestMainId = -1;
      let bestMainDist = Infinity;
      let bestAnyId = 0;
      let bestAnyDist = Infinity;

      for (let i = 0; i < nodes.length; i++) {
        const d = distKmFast(lat, lng, nodes[i].lat, nodes[i].lng);
        if (d < bestAnyDist) {
          bestAnyDist = d;
          bestAnyId = i;
        }
        if (compSize[findComp(i)] >= 8 && d < bestMainDist) {
          bestMainDist = d;
          bestMainId = i;
        }
      }

      // Usa il nodo della rete sentieristica principale se si trova entro 120m dal frammento più vicino
      if (bestMainId !== -1 && bestMainDist <= bestAnyDist + 0.12) {
        return { nodeId: bestMainId, distKm: bestMainDist };
      }
      return { nodeId: bestAnyId, distKm: bestAnyDist };
    };

    const snappedWaypoints = waypoints.map(wp => {
      const snap = findNearestTrailNode(wp.lat, wp.lng);
      if (snap.distKm <= 0.55) {
        return { lat: nodes[snap.nodeId].lat, lng: nodes[snap.nodeId].lng };
      }
      return { lat: wp.lat, lng: wp.lng };
    });

    // Coda di priorità Min-Heap veloce per A* sul grafo dei sentieri
    const runAStar = (startId: number, goalId: number): number[] | null => {
      if (startId === goalId) return [startId];
      const N = nodes.length;
      const gScore = new Float64Array(N);
      gScore.fill(Infinity);
      const cameFrom = new Int32Array(N);
      cameFrom.fill(-1);
      const closed = new Uint8Array(N);

      const goalLat = nodes[goalId].lat;
      const goalLng = nodes[goalId].lng;

      const heapNodes: number[] = [];
      const heapPriorities: number[] = [];

      const heapPush = (node: number, priority: number) => {
        heapNodes.push(node);
        heapPriorities.push(priority);
        let idx = heapNodes.length - 1;
        while (idx > 0) {
          const parent = (idx - 1) >> 1;
          if (heapPriorities[parent] <= heapPriorities[idx]) break;
          const tmpN = heapNodes[parent];
          heapNodes[parent] = heapNodes[idx];
          heapNodes[idx] = tmpN;
          const tmpP = heapPriorities[parent];
          heapPriorities[parent] = heapPriorities[idx];
          heapPriorities[idx] = tmpP;
          idx = parent;
        }
      };

      const heapPop = (): number | undefined => {
        if (heapNodes.length === 0) return undefined;
        const top = heapNodes[0];
        const lastN = heapNodes.pop()!;
        const lastP = heapPriorities.pop()!;
        if (heapNodes.length > 0) {
          heapNodes[0] = lastN;
          heapPriorities[0] = lastP;
          let idx = 0;
          const len = heapNodes.length;
          while (true) {
            const left = (idx << 1) + 1;
            const right = left + 1;
            let smallest = idx;
            if (left < len && heapPriorities[left] < heapPriorities[smallest]) smallest = left;
            if (right < len && heapPriorities[right] < heapPriorities[smallest]) smallest = right;
            if (smallest === idx) break;
            const tmpN = heapNodes[smallest];
            heapNodes[smallest] = heapNodes[idx];
            heapNodes[idx] = tmpN;
            const tmpP = heapPriorities[smallest];
            heapPriorities[smallest] = heapPriorities[idx];
            heapPriorities[idx] = tmpP;
            idx = smallest;
          }
        }
        return top;
      };

      gScore[startId] = 0;
      const hStart = distKmFast(nodes[startId].lat, nodes[startId].lng, goalLat, goalLng) * 0.7;
      heapPush(startId, hStart);

      while (heapNodes.length > 0) {
        const curr = heapPop()!;
        if (curr === goalId) {
          const path: number[] = [];
          let cur = goalId;
          while (cur !== -1) {
            path.push(cur);
            cur = cameFrom[cur];
          }
          path.reverse();
          return path;
        }
        if (closed[curr]) continue;
        closed[curr] = 1;

        const curG = gScore[curr];
        const edges = nodes[curr].edges;
        for (let i = 0; i < edges.length; i++) {
          const edge = edges[i];
          const neighbor = edge.to;
          if (closed[neighbor]) continue;
          const tentativeG = curG + edge.cost;
          if (tentativeG < gScore[neighbor]) {
            cameFrom[neighbor] = curr;
            gScore[neighbor] = tentativeG;
            const h = distKmFast(nodes[neighbor].lat, nodes[neighbor].lng, goalLat, goalLng) * 0.7;
            heapPush(neighbor, tentativeG + h);
          }
        }
      }

      return null;
    };

    let wideBridgesAdded = false;
    const ensureWideAlpineBridges = () => {
      if (wideBridgesAdded) return;
      wideBridgesAdded = true;
      // Collega componenti disconnesse / passi alpini fino a ~750m con penalità alta (così il percorso segue i sentieri ovunque possibile)
      for (let i = 0; i < nodes.length; i++) {
        const nA = nodes[i];
        const gx = Math.floor(nA.lng / cellSize);
        const gy = Math.floor(nA.lat / cellSize);
        for (let dx = -7; dx <= 7; dx++) {
          for (let dy = -7; dy <= 7; dy++) {
            const bucket = spatialGrid.get(`${gx + dx},${gy + dy}`);
            if (!bucket) continue;
            for (const j of bucket) {
              if (j <= i) continue;
              if (findComp(i) === findComp(j) && dKmQuick(nA, nodes[j]) > 0.14) continue;
              const nB = nodes[j];
              const dKm = distKmFast(nA.lat, nA.lng, nB.lat, nB.lng);
              if (dKm > 0.065 && dKm <= 0.75) {
                addEdge(i, j, dKm * 8.5);
                unionComp(i, j);
              }
            }
          }
        }
      }
    };

    function dKmQuick(a: TrailGraphNode, b: TrailGraphNode): number {
      return Math.abs(a.lat - b.lat) * 111 + Math.abs(a.lng - b.lng) * 78;
    }

    const fullCoords: { lat: number; lng: number }[] = [];

    for (let w = 0; w < waypoints.length - 1; w++) {
      const wpA = waypoints[w];
      const wpB = waypoints[w + 1];
      const snapA = findNearestTrailNode(wpA.lat, wpA.lng);
      const snapB = findNearestTrailNode(wpB.lat, wpB.lng);

      if (w === 0) {
        fullCoords.push({ lat: wpA.lat, lng: wpA.lng });
      }

      if (findComp(snapA.nodeId) !== findComp(snapB.nodeId)) {
        ensureWideAlpineBridges();
      }

      let nodePath =
        snapA.distKm <= 1.8 && snapB.distKm <= 1.8
          ? runAStar(snapA.nodeId, snapB.nodeId)
          : null;

      if (!nodePath && snapA.distKm <= 1.8 && snapB.distKm <= 1.8) {
        ensureWideAlpineBridges();
        nodePath = runAStar(snapA.nodeId, snapB.nodeId);
      }

      if (nodePath && nodePath.length >= 2) {
        for (const nid of nodePath) {
          const n = nodes[nid];
          const prev = fullCoords[fullCoords.length - 1];
          if (!prev || distKmFast(prev.lat, prev.lng, n.lat, n.lng) > 0.0015) {
            fullCoords.push({ lat: n.lat, lng: n.lng });
          }
        }
        const last = fullCoords[fullCoords.length - 1];
        if (!last || distKmFast(last.lat, last.lng, wpB.lat, wpB.lng) > 0.002) {
          fullCoords.push({ lat: wpB.lat, lng: wpB.lng });
        }
      } else {
        return { routedCoords: [], snappedWaypoints };
      }
    }

    return {
      routedCoords: fullCoords.length >= 3 ? fullCoords : [],
      snappedWaypoints,
    };
  } catch (err) {
    console.warn("OSM Trail Graph routing fallback:", err);
    return null;
  }
};

/**
 * Calcola un itinerario escursionistico multi-tappa seguendo i sentieri OSM reali:
 * 1. Grafo Sentieri OSM Overpass (usa esattamente i sentieri `path`/`footway`/`track`/`via_ferrata` disegnati sulla mappa)
 * 2. BRouter Alpino (`brouter.m11n.de` profilo `hiking-Alpine-SAC6` / `brouter.de` profilo `trekking`)
 * 3. OpenStreetMap Foot Router (`routed-foot`)
 * e risolve il profilo altimetrico completo DEM + statistiche CAI/Munter per l'intero tour e per singola tratta.
 */
export const computeHikingTourRoute = async (
  waypoints: TourWaypoint[],
  closeLoop: boolean = false
): Promise<ComputedTourRoute | null> => {
  if (!waypoints || waypoints.length < 2) return null;

  const effectiveWaypoints: TourWaypoint[] =
    closeLoop && waypoints.length >= 2
      ? [...waypoints, { ...waypoints[0], id: `${waypoints[0].id}-loop-return`, name: `${waypoints[0].name} (Rientro)` }]
      : [...waypoints];

  let rawCoords3D: { lat: number; lng: number; ele?: number }[] = [];
  let routingSource: 'brouter_hiking' | 'osm_foot' | 'direct_trail' = 'direct_trail';

  // 1. Esecuzione parallela ultra-rapida (~100-180ms) dei router sui sentieri OSM:
  //    - OpenStreetMap Foot Router (`routed-foot`: indicizza tutti i `path`, `footway`, `track`, `steps`, `bridleway`)
  //    - BRouter Trail Router (`brouter.de` profilo `shortest` e `trekking`: include anche le quote DEM 3D native)
  const lonLatsPipe = effectiveWaypoints
    .map(w => `${w.lng.toFixed(6)},${w.lat.toFixed(6)}`)
    .join('|');
  const osrmSemi = effectiveWaypoints
    .map(w => `${w.lng.toFixed(6)},${w.lat.toFixed(6)}`)
    .join(';');

  const fetchBrouterProfile = async (base: string, profile: string): Promise<number[][] | null> => {
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), 4000);
    try {
      const url = `${base}?lonlats=${lonLatsPipe}&profile=${profile}&alternativeidx=0&format=geojson`;
      const res = await fetch(url, { signal: ctrl.signal });
      clearTimeout(timer);
      if (!res.ok) return null;
      const geo = await res.json();
      const coords = geo?.features?.[0]?.geometry?.coordinates;
      if (Array.isArray(coords) && coords.length > effectiveWaypoints.length * 2) {
        return coords;
      }
      return null;
    } catch {
      clearTimeout(timer);
      return null;
    }
  };

  const fetchOsrmFoot = async (): Promise<number[][] | null> => {
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), 4000);
    try {
      const url = `https://routing.openstreetmap.de/routed-foot/route/v1/foot/${osrmSemi}?overview=full&geometries=geojson`;
      const res = await fetch(url, { signal: ctrl.signal });
      clearTimeout(timer);
      if (!res.ok) return null;
      const data = await res.json();
      const coords = data?.routes?.[0]?.geometry?.coordinates;
      if (Array.isArray(coords) && coords.length > effectiveWaypoints.length * 2) {
        return coords;
      }
      return null;
    } catch {
      clearTimeout(timer);
      return null;
    }
  };

  const isOfflineNow = typeof navigator !== 'undefined' && !navigator.onLine;
  const [brouterShortest, osrmFoot, brouterTrekking] = isOfflineNow
    ? [null, null, null]
    : await Promise.all([
        fetchBrouterProfile('https://brouter.de/brouter', 'shortest'),
        fetchOsrmFoot(),
        fetchBrouterProfile('https://brouter.de/brouter', 'trekking'),
      ]);

  const computePathLengthKm = (coords: number[][]): number => {
    let d = 0;
    for (let i = 1; i < coords.length; i++) {
      d += distKmFast(Number(coords[i - 1][1]), Number(coords[i - 1][0]), Number(coords[i][1]), Number(coords[i][0]));
    }
    return d;
  };

  if (brouterShortest && osrmFoot) {
    const dBr = computePathLengthKm(brouterShortest);
    const dOsrm = computePathLengthKm(osrmFoot);
    // Se BRouter `shortest` segue lo stesso sentiero di `routed-foot` (entro 15% di lunghezza), usiamo BRouter perché include già le quote DEM 3D su ogni punto
    if (dBr <= dOsrm * 1.15) {
      rawCoords3D = brouterShortest.map((c: number[]) => ({
        lng: Number(c[0]),
        lat: Number(c[1]),
        ele: typeof c[2] === 'number' && !Number.isNaN(c[2]) ? Number(c[2]) : undefined,
      }));
      routingSource = 'brouter_hiking';
    } else {
      rawCoords3D = osrmFoot.map((c: number[]) => ({
        lng: Number(c[0]),
        lat: Number(c[1]),
      }));
      routingSource = 'osm_foot';
    }
  } else if (osrmFoot) {
    rawCoords3D = osrmFoot.map((c: number[]) => ({
      lng: Number(c[0]),
      lat: Number(c[1]),
    }));
    routingSource = 'osm_foot';
  } else if (brouterShortest) {
    rawCoords3D = brouterShortest.map((c: number[]) => ({
      lng: Number(c[0]),
      lat: Number(c[1]),
      ele: typeof c[2] === 'number' && !Number.isNaN(c[2]) ? Number(c[2]) : undefined,
    }));
    routingSource = 'brouter_hiking';
  } else if (brouterTrekking) {
    rawCoords3D = brouterTrekking.map((c: number[]) => ({
      lng: Number(c[0]),
      lat: Number(c[1]),
      ele: typeof c[2] === 'number' && !Number.isNaN(c[2]) ? Number(c[2]) : undefined,
    }));
    routingSource = 'brouter_hiking';
  }

  // 2. Fallback Grafo Sentieri OSM Overpass (o Cache Offline in IndexedDB per vie ferrate / aree scaricate)
  if (rawCoords3D.length < 2) {
    const osmGraphResult = await buildAndRouteOsmTrailGraph(effectiveWaypoints);
    if (osmGraphResult && osmGraphResult.routedCoords.length >= 3) {
      rawCoords3D = osmGraphResult.routedCoords.map(pt => ({
        lat: pt.lat,
        lng: pt.lng,
      }));
      routingSource = 'osm_foot';
    }
  }

  // 3. Fallback offline / alta quota fuori rete: interpolazione progressiva tra le tappe
  if (rawCoords3D.length < 2) {
    routingSource = 'direct_trail';
    for (let i = 0; i < effectiveWaypoints.length - 1; i++) {
      const a = effectiveWaypoints[i];
      const b = effectiveWaypoints[i + 1];
      const dKm = distKmFast(a.lat, a.lng, b.lat, b.lng);
      const steps = Math.max(8, Math.min(40, Math.ceil(dKm * 12)));
      for (let s = 0; s < steps; s++) {
        const t = s / steps;
        const eA = a.altitude ?? estimateOfflineAltitude(a.lat, a.lng) ?? 1400;
        const eB = b.altitude ?? estimateOfflineAltitude(b.lat, b.lng) ?? eA;
        rawCoords3D.push({
          lat: a.lat + (b.lat - a.lat) * t,
          lng: a.lng + (b.lng - a.lng) * t,
          ele: Math.round(eA + (eB - eA) * t),
        });
      }
    }
    const lastW = effectiveWaypoints[effectiveWaypoints.length - 1];
    rawCoords3D.push({
      lat: lastW.lat,
      lng: lastW.lng,
      ele: lastW.altitude ?? estimateOfflineAltitude(lastW.lat, lastW.lng) ?? 1400,
    });
  }

  // Sfoltimento ad alta risoluzione (max ~420 punti per preservare ogni tornante dei sentieri sulla mappa)
  const maxPts = 420;
  const step = rawCoords3D.length > maxPts ? Math.ceil(rawCoords3D.length / maxPts) : 1;
  const sampledCoords = rawCoords3D.filter(
    (_, idx) => idx === 0 || idx === rawCoords3D.length - 1 || idx % step === 0
  );

  // 6. Risoluzione altimetrica DEM tramite Open-Meteo Elevation API (se online) o interpolazione DEM locale (se offline)
  const missingEleCount = sampledCoords.filter(p => p.ele === undefined).length;
  if (missingEleCount > sampledCoords.length * 0.2) {
    let resolvedOnline = false;
    if (!isOfflineNow) {
      try {
        // Campioniamo fino a 85 punti in un'unica chiamata Open-Meteo Elevation
        const demStep = Math.max(1, Math.ceil(sampledCoords.length / 80));
        const demIndices: number[] = [];
        for (let i = 0; i < sampledCoords.length; i += demStep) {
          demIndices.push(i);
        }
        if (demIndices[demIndices.length - 1] !== sampledCoords.length - 1) {
          demIndices.push(sampledCoords.length - 1);
        }

        const lats = demIndices.map(idx => sampledCoords[idx].lat.toFixed(5)).join(',');
        const lngs = demIndices.map(idx => sampledCoords[idx].lng.toFixed(5)).join(',');
        const eleRes = await fetch(`https://api.open-meteo.com/v1/elevation?latitude=${lats}&longitude=${lngs}`);
        if (eleRes.ok) {
          const eleData = await eleRes.json();
          const elevations: number[] = Array.isArray(eleData?.elevation) ? eleData.elevation : [];
          if (elevations.length === demIndices.length) {
            resolvedOnline = true;
            demIndices.forEach((ptIdx, k) => {
              if (typeof elevations[k] === 'number' && !Number.isNaN(elevations[k])) {
                const rounded = Math.round(elevations[k]);
                sampledCoords[ptIdx].ele = rounded;
                elevationCache.set(
                  `${sampledCoords[ptIdx].lat.toFixed(4)},${sampledCoords[ptIdx].lng.toFixed(4)}`,
                  rounded
                );
              }
            });
            persistDemCache();
            // Interpola linearmente i punti intermedi tra i campioni DEM
            for (let k = 0; k < demIndices.length - 1; k++) {
              const iStart = demIndices[k];
              const iEnd = demIndices[k + 1];
              const eStart = sampledCoords[iStart].ele ?? 1200;
              const eEnd = sampledCoords[iEnd].ele ?? eStart;
              for (let j = iStart + 1; j < iEnd; j++) {
                const ratio = (j - iStart) / Math.max(1, iEnd - iStart);
                sampledCoords[j].ele = Math.round(eStart + (eEnd - eStart) * ratio);
              }
            }
          }
        }
      } catch {
        // Fallback alle quote DEM locali e waypoint
      }
    }

    if (!resolvedOnline) {
      // Stima le quote mancanti tramite cache DEM locale IDW + interpolazione tra le tappe
      for (let i = 0; i < sampledCoords.length; i++) {
        if (sampledCoords[i].ele === undefined) {
          const est = estimateOfflineAltitude(sampledCoords[i].lat, sampledCoords[i].lng);
          if (est && est > 0) {
            sampledCoords[i].ele = est;
          }
        }
      }
    }
  }

  // Ancora le quote note delle tappe (es. Bivacco o Cima con quota nota) sul vertice più vicino
  const waypointVertexIndices: number[] = [];
  let searchStart = 0;
  for (let w = 0; w < effectiveWaypoints.length; w++) {
    const wp = effectiveWaypoints[w];
    let bestIdx = searchStart;
    let bestDist = Infinity;
    for (let i = searchStart; i < sampledCoords.length; i++) {
      const d = distKmFast(wp.lat, wp.lng, sampledCoords[i].lat, sampledCoords[i].lng);
      if (d < bestDist) {
        bestDist = d;
        bestIdx = i;
      }
    }
    waypointVertexIndices.push(bestIdx);
    searchStart = bestIdx;

    if (wp.altitude && wp.altitude > 0) {
      sampledCoords[bestIdx].ele = Math.round(wp.altitude);
    }
  }

  // 7. Costruzione array TrackPoint, latlngs e calcolo statistiche complessive e per singola tratta
  const points: { lat: number; lng: number; ele: number; dist: number }[] = [];
  const latlngs: [number, number][] = [];
  let totalDist = 0;
  let gain = 0;
  let loss = 0;
  let minEle = Infinity;
  let maxEle = -Infinity;
  let maxGrade = 0;
  let gradeSum = 0;
  let gradeCount = 0;

  for (let i = 0; i < sampledCoords.length; i++) {
    const c = sampledCoords[i];
    const ele = Math.round(c.ele ?? 1200);
    latlngs.push([c.lat, c.lng]);

    if (i > 0) {
      const prev = points[i - 1];
      // Se il percorso proviene da interpolazione diretta in linea d'aria, applica fattore tortuosità sentiero 1.18x
      const rawStepKm = distKmFast(prev.lat, prev.lng, c.lat, c.lng);
      const stepKm = routingSource === 'direct_trail' ? rawStepKm * 1.18 : rawStepKm;
      totalDist += stepKm;

      const dEle = ele - prev.ele;
      if (dEle > 0) gain += dEle;
      else loss += Math.abs(dEle);

      if (stepKm > 0.008) {
        const g = Math.abs((dEle / (stepKm * 1000)) * 100);
        if (g < 85) {
          if (g > maxGrade) maxGrade = g;
          gradeSum += g;
          gradeCount++;
        }
      }
    }

    if (ele < minEle) minEle = ele;
    if (ele > maxEle) maxEle = ele;

    points.push({
      lat: c.lat,
      lng: c.lng,
      ele,
      dist: totalDist,
    });
  }

  // Calcolo statistiche per singola tappa (Leg)
  const legs: TourLegSummary[] = [];
  for (let w = 0; w < effectiveWaypoints.length - 1; w++) {
    const idxA = waypointVertexIndices[w] ?? 0;
    const idxB = waypointVertexIndices[w + 1] ?? points.length - 1;
    let legGain = 0;
    let legLoss = 0;
    for (let i = idxA + 1; i <= idxB; i++) {
      const diff = points[i].ele - points[i - 1].ele;
      if (diff > 0) legGain += diff;
      else legLoss += Math.abs(diff);
    }
    const legDistKm = Math.max(0.05, (points[idxB]?.dist ?? 0) - (points[idxA]?.dist ?? 0));
    // Formula Munter / CAI per singola tratta
    const horizH = legDistKm / 4.0;
    const vertH = legGain / 350.0 + legLoss / 550.0;
    const legHours = Math.max(horizH, vertH) + 0.5 * Math.min(horizH, vertH);

    legs.push({
      fromName: effectiveWaypoints[w].name,
      toName: effectiveWaypoints[w + 1].name,
      distanceKm: Number(legDistKm.toFixed(2)),
      elevationGain: Math.round(legGain),
      elevationLoss: Math.round(legLoss),
      durationMinutes: Math.max(5, Math.round(legHours * 60)),
    });
  }

  const totalMinutes = legs.reduce((acc, l) => acc + l.durationMinutes, 0);
  const totalTimeSeconds = Math.max(300, totalMinutes * 60);
  const avgSpeedKmh = totalTimeSeconds > 0 ? totalDist / (totalTimeSeconds / 3600) : 3.5;
  const ascentTimeHours = gain > 0 ? gain / 400 : 0;
  const vam = ascentTimeHours > 0.15 ? Math.round(gain / ascentTimeHours) : undefined;

  return {
    latlngs,
    points,
    stats: {
      totalDistance: totalDist,
      elevationGain: Math.round(gain),
      elevationLoss: Math.round(loss),
      minElevation: minEle === Infinity ? 0 : Math.round(minEle),
      maxElevation: maxEle === -Infinity ? 0 : Math.round(maxEle),
      totalTimeSeconds,
      avgSpeedKmh,
      maxGrade,
      avgGrade: gradeCount > 0 ? gradeSum / gradeCount : 0,
      isEstimatedTime: true,
      vam,
    },
    legs,
    routingSource,
  };
};



