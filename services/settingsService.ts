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
  pacePreset: UserPacePreset;
  horizSpeedKmh: number;
  ascentSpeedMh: number;
  descentSpeedMh: number;
  bodyWeightKg: number;
  backpackWeightKg: number;
  forceOfflineMode: boolean;
  defaultMapStyle: 'standard' | 'satellite' | 'hybrid';
  rememberMapPositionOnStartup: boolean;
  rememberFiltersOnStartup: boolean;
  coordFormat: 'dd' | 'dms';
}

export interface SavedStartupMapState {
  lat: number;
  lng: number;
  zoom: number;
  mapStyle: 'standard' | 'satellite' | 'hybrid';
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
  version: number;
  exportedAt: string;
  app: 'MountPro Explorer';
  settings: UserAppSettings;
  favorites: string[];
  userNotes: Record<string, string>;
  customPois: POI[];
  gpxTracks: any[];
  tourWaypoints: any[];
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
  coordFormat: 'dd',
};

export const loadUserSettings = (): UserAppSettings => {
  try {
    const raw = localStorage.getItem(SETTINGS_STORAGE_KEY);
    if (!raw) return { ...DEFAULT_USER_SETTINGS };
    const parsed = JSON.parse(raw);
    return {
      ...DEFAULT_USER_SETTINGS,
      ...parsed,
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
          parsed.mapStyle === 'satellite' || parsed.mapStyle === 'hybrid'
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
    localStorage.setItem(STARTUP_MAP_STORAGE_KEY, JSON.stringify(state));
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

export const formatCoordinatesDms = (lat: number, lng: number): string => {
  return `${toDmsPart(lat, true)} ${toDmsPart(lng, false)}`;
};

export const formatCoordinatesByPreference = (
  lat: number,
  lng: number,
  format: 'dd' | 'dms'
): string => {
  if (format === 'dms') {
    return formatCoordinatesDms(lat, lng);
  }
  return `${lat.toFixed(5)}° N, ${lng.toFixed(5)}° E`;
};

// Genera il messaggio strutturato SOS 112 / Soccorso Alpino pronto per copia o invio SMS
export const buildSosEmergencyReport = (params: {
  lat: number;
  lng: number;
  altitude: number | null;
  isGpsFix: boolean;
  nearestPoi?: { name: string; type: string; distKm: number; bearingDeg: number; cardinal: string } | null;
  hikerName?: string;
  iceContact?: string;
}): string => {
  const { lat, lng, altitude, isGpsFix, nearestPoi, hikerName, iceContact } = params;
  const ddStr = `${lat.toFixed(5)}, ${lng.toFixed(5)}`;
  const dmsStr = formatCoordinatesDms(lat, lng);
  const timeStr = new Date().toLocaleTimeString('it-IT', { hour: '2-digit', minute: '2-digit' });
  const dateStr = new Date().toLocaleDateString('it-IT');

  const lines = [
    `[SOS EMERGENZA MONTAGNA - 112 / CNSAS]`,
    hikerName ? `Escursionista: ${hikerName}` : null,
    `Posizione (${isGpsFix ? 'Rilevamento GPS' : 'Punto Mappa'}):`,
    `• Coord. Decimali (WGS84): ${ddStr}`,
    `• Coord. DMS: ${dmsStr}`,
    `• Quota stimata DEM: ${altitude ? `${Math.round(altitude)} m s.l.m.` : 'N/D'}`,
    nearestPoi
      ? `• Punto noto più vicino: ${nearestPoi.name} (${nearestPoi.type}) a ${
          nearestPoi.distKm < 1
            ? `${Math.round(nearestPoi.distKm * 1000)}m`
            : `${nearestPoi.distKm.toFixed(2)}km`
        } dir. ${nearestPoi.bearingDeg}° (${nearestPoi.cardinal})`
      : null,
    iceContact ? `• Contatto Emergenza (ICE): ${iceContact}` : null,
    `• Data/Ora rilevamento: ${dateStr} ore ${timeStr}`,
    `• Mappa: https://maps.google.com/?q=${lat.toFixed(6)},${lng.toFixed(6)}`,
  ].filter(Boolean);

  return lines.join('\n');
};

// Esporta tutti i dati utente in un file di backup JSON scaricabile
export const triggerFullBackupDownload = (payload: Omit<MountProFullBackupPayload, 'version' | 'exportedAt' | 'app'>) => {
  const fullData: MountProFullBackupPayload = {
    version: 1,
    exportedAt: new Date().toISOString(),
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
