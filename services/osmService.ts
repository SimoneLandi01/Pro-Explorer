
import { POI, POIType, Exposure, SignalStrength } from '../types.ts';

// Overpass instances for area downloads (Failover support)
const OVERPASS_INSTANCES = [
  'https://overpass-api.de/api/interpreter',
  'https://overpass.kumi.systems/api/interpreter',
  'https://api.openstreetmap.fr/oapi/interpreter'
];

// Nominatim for text search (Standard OSM Search)
const NOMINATIM_API_URL = 'https://nominatim.openstreetmap.org/search';

const ELEVATION_API_URL = 'https://api.open-meteo.com/v1/elevation';

// --- HELPER: Overpass Fetcher ---
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

// --- HELPER: Altitude Enrichment (Now Exported) ---
export const enrichPoisWithAltitude = async (pois: POI[]): Promise<POI[]> => {
  const poisMissingAlt = pois.filter(p => p.altitude === 0);
  if (poisMissingAlt.length === 0) return pois;

  const toFetch = poisMissingAlt.slice(0, 150); 
  const lats = toFetch.map(p => p.coordinates.lat).join(',');
  const lngs = toFetch.map(p => p.coordinates.lng).join(',');

  try {
    const url = `${ELEVATION_API_URL}?latitude=${lats}&longitude=${lngs}`;
    const res = await fetch(url); 
    const data = await res.json();
    
    if (!data || !data.elevation) return pois;

    const elevationMap = new Map();
    data.elevation.forEach((ele: number, index: number) => {
      elevationMap.set(toFetch[index].id, ele);
    });

    return pois.map(p => {
      if (elevationMap.has(p.id)) {
        return { ...p, altitude: Math.round(elevationMap.get(p.id)) };
      }
      return p;
    });

  } catch (e) {
    return pois;
  }
};

// --- HELPER: Process OSM Elements (Overpass) ---
const processOsmElements = (elements: any[], filterType: POIType | 'All'): POI[] => {
  return elements
      .filter((el: any) => (el.type === 'node' || el.type === 'way') && el.tags)
      .map((el: any) => {
        const type = mapOsmTypeToPoiType(el.tags);
        if (!type) return null;
        if (filterType !== 'All' && type !== filterType) return null;

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
  filterType: POIType | 'All',
  signal?: AbortSignal
): Promise<POI[]> => {
  let queryFilters = '';
  const isAll = filterType === 'All';
  const includeFountains = isAll || filterType === POIType.FOUNTAIN;
  const includeBivouacs = isAll || filterType === POIType.BIVOUAC;
  const includeRefuges = isAll || filterType === POIType.REFUGE;

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
    
    // Only enrich small batches to avoid API limits on elevation
    if (pois.length > 0 && pois.length < 250) {
       pois = await enrichPoisWithAltitude(pois);
    }
    
    return pois;

  } catch (error: any) {
    if (error.name === 'AbortError') return []; 
    console.warn("Error fetching OSM data:", error);
    return [];
  }
};
