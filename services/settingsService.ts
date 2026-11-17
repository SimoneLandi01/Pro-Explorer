// --- [MODULAR FEATURE 6] USER SETTINGS, CAI PACE CALIBRATION, SOS 112 & FULL BACKUP SERVICE ---
// Questo modulo gestisce in modo indipendente e retrocompatibile:
// 1. Profilo Escursionista e calibrazione Passo CAI / Munter (velocità orizzontale, salita, discesa, peso corporeo e zaino)
// 2. Modalità Offline Forzata (per segnale instabile in quota e risparmio batteria)
// 3. Persistenza automatica di ultima posizione mappa, stile mappa e filtri preferiti al riavvio
// 4. Formattazione coordinate (DD / DMS) e generatore Report Emergenza SOS 112
// 5. Esportazione e Ripristino Backup Completo (.JSON) di tutti i dati utente

import { POI, POIType, Exposure } from '../types.ts';

export type UserPacePreset = 'relaxed' | 'standard' | 'fast' | 'trail_running' | 'custom';

export interface UserAppSettings {
  hikerName: string;
  iceContact: string;
  iceContactName: string;
  iceContactPhone: string;
  pacePreset: UserPacePreset;
  horizSpeedKmh: number;
  ascentSpeedMh: number;
  descentSpeedMh: number;
  bodyWeightKg: number;
  backpackWeightKg: number;
  forceOfflineMode: boolean;
  defaultMapStyle: 'standard' | 'topo' | 'satellite' | 'hybrid';
  rememberMapPositionOnStartup: boolean;
  rememberFiltersOnStartup: boolean;
  autoSaveMapPosition: boolean;
  autoSaveFilters: boolean;
  coordFormat: 'dd' | 'dms';
  coordinateFormat: 'dd' | 'dms';
}

export interface SavedStartupMapState {
  lat: number;
  lng: number;
  zoom: number;
  mapStyle?: 'standard' | 'topo' | 'satellite' | 'hybrid';
}

export interface SavedStartupFiltersState {
  selectedTypes: POIType[];
  minAltitude: number;
  maxAltitude: number;
  selectedExposures: Exposure[];
  filterWater: boolean;
  filterRoof: boolean;
  minCapacity: number;
  filterFireplace: boolean;
  filterFee: boolean;
  filterOpen: boolean;
  showFavoritesOnly: boolean;
}

export interface MountProFullBackupPayload {
  version: number | string;
  exportedAt: string;
  app: 'MountPro Explorer';
  settings?: UserAppSettings;
  userSettings?: UserAppSettings;
  favorites: string[];
  userNotes: Record<string, string>;
  customPois?: POI[];
  customWaypoints?: POI[];
  gpxTracks: any[];
  tourWaypoints: any[];
  mapStartup?: SavedStartupMapState;
  filtersStartup?: SavedStartupFiltersState;
}

const SETTINGS_STORAGE_KEY = 'mountpro_user_settings_v1';
const STARTUP_MAP_STORAGE_KEY = 'mountpro_startup_map_v1';
const STARTUP_FILTERS_STORAGE_KEY = 'mountpro_startup_filters_v1';

export const PACE_PRESET_CONFIGS: Record<
  Exclude<UserPacePreset, 'custom'>,
  {
    label: string;
    subtitle: string;
    horizSpeedKmh: number;
    ascentSpeedMh: number;
    descentSpeedMh: number;
  }
> = {
  relaxed: {
    label: 'Passo Tranquillo / Fotografico',
    subtitle: '3.2 km/h · +280 m/h salita · -420 m/h discesa',
    horizSpeedKmh: 3.2,
    ascentSpeedMh: 280,
    descentSpeedMh: 420,
  },
  standard: {
    label: 'Standard CAI / Escursionistico',
    subtitle: '4.0 km/h · +350 m/h salita · -500 m/h discesa',
    horizSpeedKmh: 4.0,
    ascentSpeedMh: 350,
    descentSpeedMh: 500,
  },
  fast: {
    label: 'Esperto / Alpinistico Veloce',
    subtitle: '4.8 km/h · +450 m/h salita · -650 m/h discesa',
    horizSpeedKmh: 4.8,
    ascentSpeedMh: 450,
    descentSpeedMh: 650,
  },
  trail_running: {
    label: 'Fast Hiking / Trail Running',
    subtitle: '6.2 km/h · +600 m/h salita · -850 m/h discesa',
    horizSpeedKmh: 6.2,
    ascentSpeedMh: 600,
    descentSpeedMh: 850,
  },
};

export const DEFAULT_USER_SETTINGS: UserAppSettings = {
  hikerName: '',
  iceContact: '',
  iceContactName: '',
  iceContactPhone: '',
  pacePreset: 'standard',
  horizSpeedKmh: 4.0,
  ascentSpeedMh: 350,
  descentSpeedMh: 500,
  bodyWeightKg: 75,
  backpackWeightKg: 8,
  forceOfflineMode: false,
  defaultMapStyle: 'standard',
  rememberMapPositionOnStartup: true,
  rememberFiltersOnStartup: true,
  autoSaveMapPosition: true,
  autoSaveFilters: true,
  coordFormat: 'dd',
  coordinateFormat: 'dd',
};

export const loadUserSettings = (): UserAppSettings => {
  try {
    const raw = localStorage.getItem(SETTINGS_STORAGE_KEY);
    if (!raw) return { ...DEFAULT_USER_SETTINGS };
    const parsed = JSON.parse(raw);
    const autoSaveMap =
      typeof parsed.autoSaveMapPosition === 'boolean'
        ? parsed.autoSaveMapPosition
        : typeof parsed.rememberMapPositionOnStartup === 'boolean'
        ? parsed.rememberMapPositionOnStartup
        : true;
    const autoSaveFilters =
      typeof parsed.autoSaveFilters === 'boolean'
        ? parsed.autoSaveFilters
        : typeof parsed.rememberFiltersOnStartup === 'boolean'
        ? parsed.rememberFiltersOnStartup
        : true;
    const coordFmt: 'dd' | 'dms' =
      parsed.coordinateFormat === 'dms' || parsed.coordFormat === 'dms' ? 'dms' : 'dd';

    return {
      ...DEFAULT_USER_SETTINGS,
      ...parsed,
      iceContactName: parsed.iceContactName ?? parsed.iceContact ?? '',
      iceContactPhone: parsed.iceContactPhone ?? '',
      autoSaveMapPosition: autoSaveMap,
      rememberMapPositionOnStartup: autoSaveMap,
      autoSaveFilters: autoSaveFilters,
      rememberFiltersOnStartup: autoSaveFilters,
      coordinateFormat: coordFmt,
      coordFormat: coordFmt,
      horizSpeedKmh: Math.max(1.5, Math.min(12, Number(parsed.horizSpeedKmh) || 4.0)),
      ascentSpeedMh: Math.max(150, Math.min(1200, Number(parsed.ascentSpeedMh) || 350)),
      descentSpeedMh: Math.max(200, Math.min(1500, Number(parsed.descentSpeedMh) || 500)),
      bodyWeightKg: Math.max(35, Math.min(160, Number(parsed.bodyWeightKg) || 75)),
      backpackWeightKg: Math.max(0, Math.min(45, Number(parsed.backpackWeightKg) ?? 8)),
    };
  } catch {
    return { ...DEFAULT_USER_SETTINGS };
  }
};

export const saveUserSettings = (settings: UserAppSettings): void => {
  try {
    localStorage.setItem(SETTINGS_STORAGE_KEY, JSON.stringify(settings));
  } catch (e) {
    console.warn('Unable to persist user settings:', e);
  }
};

export const loadSavedMapStartupState = (): SavedStartupMapState | null => {
  try {
    const raw = localStorage.getItem(STARTUP_MAP_STORAGE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    if (
      typeof parsed?.lat === 'number' &&
      typeof parsed?.lng === 'number' &&
      typeof parsed?.zoom === 'number'
    ) {
      return {
        lat: parsed.lat,
        lng: parsed.lng,
        zoom: parsed.zoom,
        mapStyle:
          parsed.mapStyle === 'topo' ||
          parsed.mapStyle === 'satellite' ||
          parsed.mapStyle === 'hybrid'
            ? parsed.mapStyle
            : 'standard',
      };
    }
    return null;
  } catch {
    return null;
  }
};

export const saveMapStartupState = (state: SavedStartupMapState): void => {
  try {
    let nextStyle = state.mapStyle;
    if (!nextStyle) {
      const existing = loadSavedMapStartupState();
      nextStyle = existing?.mapStyle || 'standard';
    }
    localStorage.setItem(
      STARTUP_MAP_STORAGE_KEY,
      JSON.stringify({ ...state, mapStyle: nextStyle })
    );
  } catch {}
};

export const loadSavedFiltersStartupState = (): SavedStartupFiltersState | null => {
  try {
    const raw = localStorage.getItem(STARTUP_FILTERS_STORAGE_KEY);
    if (!raw) return null;
    return JSON.parse(raw);
  } catch {
    return null;
  }
};

export const saveFiltersStartupState = (state: SavedStartupFiltersState): void => {
  try {
    localStorage.setItem(STARTUP_FILTERS_STORAGE_KEY, JSON.stringify(state));
  } catch {}
};

// Conversione di un singolo valore decimale in Gradi° Minuti' Secondi"
const toDmsPart = (deg: number, isLat: boolean): string => {
  const dir = isLat ? (deg >= 0 ? 'N' : 'S') : deg >= 0 ? 'E' : 'W';
  const abs = Math.abs(deg);
  const d = Math.floor(abs);
  const mFloat = (abs - d) * 60;
  const m = Math.floor(mFloat);
  const s = ((mFloat - m) * 60).toFixed(1);
  return `${d}°${String(m).padStart(2, '0')}'${String(s).padStart(4, '0')}"${dir}`;
};

export const formatCoordinatesDms = (
  lat: number,
  lng: number
): { latDms: string; lngDms: string; combined: string } => {
  const latDms = toDmsPart(lat, true);
  const lngDms = toDmsPart(lng, false);
  return {
    latDms,
    lngDms,
    combined: `${latDms} ${lngDms}`,
  };
};

export const formatCoordinatesByPreference = (
  lat: number,
  lng: number,
  format: 'dd' | 'dms'
): string => {
  if (format === 'dms') {
    return formatCoordinatesDms(lat, lng).combined;
  }
  return `${lat.toFixed(5)}° N, ${lng.toFixed(5)}° E`;
};

/**
 * Parser universale di Coordinate GPS per la Barra di Ricerca (Stile OsmAnd):
 * Riconosce automaticamente:
 * 1) Gradi Decimali (DD): "46.0854, 11.6123", "46,0854; 11,6123", "46.0854° N, 11.6123° E", "N 46.0854 E 11.6123"
 * 2) Gradi Minuti Secondi (DMS Elicottero 112): "46°05'07.4\"N 11°36'44.2\"E", "46° 05' 07\" N, 11° 36' 44\" E"
 * 3) Gradi e Minuti Decimali (DDM Garmin): "46° 05.123' N, 11° 36.737' E"
 */
export const parseGpsCoordinatesInput = (
  rawInput: string
): { lat: number; lng: number; formatDetected: 'DD' | 'DMS' | 'DDM' } | null => {
  const cleaned = (rawInput || '')
    .trim()
    .replace(/\b(lat|latitude|latitudine|lon|lng|long|longitude|longitudine)\s*[:=]?\s*/gi, ' ')
    .replace(/[′’']/g, "'")
    .replace(/[″”"]/g, '"')
    .replace(/\s+/g, ' ')
    .trim();

  if (cleaned.length < 4) return null;

  // 1. Formato DMS (Gradi° Minuti' Secondi" [N/S/E/W/O])
  const dmsRegex =
    /^([NSns+-])?\s*(\d{1,2})\s*(?:°|\s)\s*(\d{1,2})\s*(?:'|\s)\s*(\d{1,2}(?:[.,]\d+)?)\s*"?\s*([NSns])?\s*[,;/\s]+\s*([EWewOo+-])?\s*(\d{1,3})\s*(?:°|\s)\s*(\d{1,2})\s*(?:'|\s)\s*(\d{1,2}(?:[.,]\d+)?)\s*"?\s*([EWewOo])?$/;
  const dmsMatch = cleaned.match(dmsRegex);
  if (dmsMatch) {
    const latDeg = parseInt(dmsMatch[2], 10);
    const latMin = parseInt(dmsMatch[3], 10);
    const latSec = parseFloat(dmsMatch[4].replace(',', '.'));
    const latSignChar = (dmsMatch[1] || dmsMatch[5] || 'N').toUpperCase();

    const lngDeg = parseInt(dmsMatch[7], 10);
    const lngMin = parseInt(dmsMatch[8], 10);
    const lngSec = parseFloat(dmsMatch[9].replace(',', '.'));
    const lngSignChar = (dmsMatch[6] || dmsMatch[10] || 'E').toUpperCase();

    if (latMin < 60 && latSec < 60 && lngMin < 60 && lngSec < 60) {
      let lat = latDeg + latMin / 60 + latSec / 3600;
      let lng = lngDeg + lngMin / 60 + lngSec / 3600;
      if (latSignChar === 'S' || latSignChar === '-') lat = -lat;
      if (lngSignChar === 'W' || lngSignChar === 'O' || lngSignChar === '-') lng = -lng;
      if (lat >= -90 && lat <= 90 && lng >= -180 && lng <= 180) {
        return { lat, lng, formatDetected: 'DMS' };
      }
    }
  }

  // 2. Formato DDM Garmin (Gradi° Minuti.decimali' [N/S/E/W/O])
  const ddmRegex =
    /^([NSns+-])?\s*(\d{1,2})\s*(?:°|\s)\s*(\d{1,2}[.,]\d+)\s*'?\s*([NSns])?\s*[,;/\s]+\s*([EWewOo+-])?\s*(\d{1,3})\s*(?:°|\s)\s*(\d{1,2}[.,]\d+)\s*'?\s*([EWewOo])?$/;
  const ddmMatch = cleaned.match(ddmRegex);
  if (ddmMatch) {
    const latDeg = parseInt(ddmMatch[2], 10);
    const latMin = parseFloat(ddmMatch[3].replace(',', '.'));
    const latSignChar = (ddmMatch[1] || ddmMatch[4] || 'N').toUpperCase();

    const lngDeg = parseInt(ddmMatch[6], 10);
    const lngMin = parseFloat(ddmMatch[7].replace(',', '.'));
    const lngSignChar = (ddmMatch[5] || ddmMatch[8] || 'E').toUpperCase();

    if (latMin < 60 && lngMin < 60) {
      let lat = latDeg + latMin / 60;
      let lng = lngDeg + lngMin / 60;
      if (latSignChar === 'S' || latSignChar === '-') lat = -lat;
      if (lngSignChar === 'W' || lngSignChar === 'O' || lngSignChar === '-') lng = -lng;
      if (lat >= -90 && lat <= 90 && lng >= -180 && lng <= 180) {
        return { lat, lng, formatDetected: 'DDM' };
      }
    }
  }

  // 3. Formato DD (Gradi Decimali con punto o virgola, con o senza ° e N/S/E/W/O)
  const ddRegex =
    /^([NSns+-])?\s*(\d{1,2}(?:[.,]\d+)?)\s*°?\s*([NSns])?\s*(?:[,;/]\s*|\s+)\s*([EWewOo+-])?\s*(\d{1,3}(?:[.,]\d+)?)\s*°?\s*([EWewOo])?$/;
  const ddMatch = cleaned.match(ddRegex);
  if (ddMatch) {
    let lat = parseFloat(ddMatch[2].replace(',', '.'));
    let lng = parseFloat(ddMatch[5].replace(',', '.'));
    const latSignChar = (ddMatch[1] || ddMatch[3] || 'N').toUpperCase();
    const lngSignChar = (ddMatch[4] || ddMatch[6] || 'E').toUpperCase();

    if (latSignChar === 'S' || latSignChar === '-') lat = -Math.abs(lat);
    if (lngSignChar === 'W' || lngSignChar === 'O' || lngSignChar === '-') lng = -Math.abs(lng);

    if (!Number.isNaN(lat) && !Number.isNaN(lng) && lat >= -90 && lat <= 90 && lng >= -180 && lng <= 180) {
      return { lat, lng, formatDetected: 'DD' };
    }
  }

  return null;
};

// Genera il messaggio strutturato SOS 112 / Soccorso Alpino pronto per copia o invio SMS
export const buildSosEmergencyReport = (params: {
  lat: number;
  lng: number;
  altitude: number | null;
  isGpsFix?: boolean;
  sourceLabel?: string;
  nearestPoi?: { name: string; type: string; distKm: number; bearingDeg: number; cardinal: string } | null;
  nearestShelter?: { name: string; type?: string; distanceKm: number; bearingDeg?: number; bearingCardinal: string } | null;
  hikerName?: string;
  iceContact?: string;
  settings?: UserAppSettings;
}): string => {
  const { lat, lng, altitude, isGpsFix, sourceLabel, nearestPoi, nearestShelter, hikerName, iceContact, settings } = params;
  const ddStr = `${lat.toFixed(6)}, ${lng.toFixed(6)}`;
  const dmsStr = formatCoordinatesDms(lat, lng).combined;
  const timeStr = new Date().toLocaleTimeString('it-IT', { hour: '2-digit', minute: '2-digit' });
  const dateStr = new Date().toLocaleDateString('it-IT');

  const resolvedHiker = hikerName || settings?.hikerName || '';
  const resolvedIce =
    iceContact ||
    [settings?.iceContactName, settings?.iceContactPhone].filter(Boolean).join(' - ') ||
    settings?.iceContact ||
    '';
  const posSource = sourceLabel || (isGpsFix ? 'Rilevamento GPS' : 'Punto Mappa');

  const shelterLine = nearestShelter
    ? `• Punto noto più vicino: ${nearestShelter.name} a ${
        nearestShelter.distanceKm < 1
          ? `${Math.round(nearestShelter.distanceKm * 1000)}m`
          : `${nearestShelter.distanceKm.toFixed(2)}km`
      } dir. ${nearestShelter.bearingCardinal}`
    : nearestPoi
    ? `• Punto noto più vicino: ${nearestPoi.name} (${nearestPoi.type}) a ${
        nearestPoi.distKm < 1
          ? `${Math.round(nearestPoi.distKm * 1000)}m`
          : `${nearestPoi.distKm.toFixed(2)}km`
      } dir. ${nearestPoi.bearingDeg}° (${nearestPoi.cardinal})`
    : null;

  const lines = [
    `[SOS EMERGENZA MONTAGNA - 112 / CNSAS]`,
    resolvedHiker ? `Escursionista: ${resolvedHiker}` : null,
    `Posizione (${posSource}):`,
    `• Coord. Decimali (WGS84): ${ddStr}`,
    `• Coord. DMS (Elicottero): ${dmsStr}`,
    `• Quota stimata DEM: ${altitude !== null && altitude !== undefined ? `${Math.round(altitude)} m s.l.m.` : 'N/D'}`,
    shelterLine,
    resolvedIce ? `• Contatto Emergenza (ICE): ${resolvedIce}` : null,
    `• Data/Ora rilevamento: ${dateStr} ore ${timeStr}`,
    `• Mappa: https://maps.google.com/?q=${lat.toFixed(6)},${lng.toFixed(6)}`,
  ].filter(Boolean);

  return lines.join('\n');
};

// Esporta tutti i dati utente in un file di backup JSON scaricabile
export const triggerFullBackupDownload = (payload: Partial<MountProFullBackupPayload> & { favorites: string[]; userNotes: Record<string, string>; gpxTracks: any[]; tourWaypoints: any[] }) => {
  const fullData: MountProFullBackupPayload = {
    version: payload.version ?? '1.0',
    exportedAt: payload.exportedAt ?? new Date().toISOString(),
    app: 'MountPro Explorer',
    ...payload,
  };
  const blob = new Blob([JSON.stringify(fullData, null, 2)], {
    type: 'application/json;charset=utf-8',
  });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  const dateTag = new Date().toISOString().slice(0, 10);
  a.href = url;
  a.download = `mountpro-backup-${dateTag}.json`;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
};
