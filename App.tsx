// --- MOUNTPRO EXPLORER - MAIN APP COMPONENT [LOCKED LOGIC] ---
// This file contains the core logic for Map, List, GPX, Weather, and UI.
// Modifications should be minimal to preserve established functionality.

import React, { useState, useMemo, useEffect, useRef, useCallback } from 'react';
import Supercluster, { ClusterProperties, PointFeature } from 'supercluster';
import { fetchOsmPois, searchOsmPoisByName, enrichPoisWithAltitude, fetchAltitudeForCoordinate, analyzeGpxTrailAndPeaks, GpxTrailAnalysisResult, computeHikingTourRoute, TourWaypoint, ComputedTourRoute, preloadOfflineAreaTrailNetwork, seedElevationCacheFromPois, seedElevationCacheFromPoints } from './services/osmService.ts'; 
import { MOCK_POIS } from './constants.tsx';
import { REGIONAL_VENETO_TRENTINO_POIS } from './services/regionalData.ts';
import { dbService } from './services/dbService.ts';
import { analyzeLocationPhysics, GeoAnalysis } from './services/analysisService.ts';
import { usePWAInstall } from './usePWAInstall.ts';
import { 
  Map as MapIcon, 
  List, 
  Mountain, 
  Droplets, 
  Home, 
  Signal, 
  Sun, 
  Navigation, 
  ChevronLeft, 
  Info,
  Wind,
  Filter,
  Layers,
  CloudRain,
  Loader2,
  Search,
  Compass,
  ImageIcon,
  Zap,
  Flame,
  Smartphone,
  WifiOff,
  CloudOff,
  Download,
  CheckCircle2,
  AlertCircle,
  Wifi,
  Plus,
  Minus,
  Globe,
  RefreshCw,
  X,
  Thermometer,
  Sunrise,
  Sunset,
  ArrowRight,
  Tent,
  Database,
  Heart, 
  Star,
  BedDouble,
  Building,
  Key,
  Euro,
  Save,
  Edit3,
  Unlock,
  Coins,
  FileUp,
  Footprints,
  Trash2,
  Route,
  Activity,
  ArrowUpRight,
  ArrowDownRight,
  Maximize2,
  Minimize2,
  BarChart3,
  Play,
  Pause,
  Flag,
  ChevronRight,
  Snowflake, 
  Cloud, 
  CloudLightning,
  CloudFog,
  Clock,
  ThermometerSun,
  Eye, 
  Gauge, 
  Umbrella, 
  Calendar,
  Locate,
  ChevronUp,
  ChevronDown,
  Timer,
  TrendingUp,
  HeartPulse,
  ScanEye,
  Waves,
  MapPin,
  BookOpen,
  Leaf,
  CloudSun
} from 'lucide-react';
import L from 'leaflet';
import { POI, POIType, Exposure, SignalStrength } from './types.ts';

// --- [LOCKED FEATURE] UTILS & GEOMETRY ---
// DO NOT MODIFY GEOMETRY FUNCTIONS WITHOUT PERMISSION
const getDistance = (lat1: number, lon1: number, lat2: number, lon2: number) => {
  const R = 6371; 
  const dLat = (lat2 - lat1) * Math.PI / 180;
  const dLon = (lon2 - lon1) * Math.PI / 180;
  const a = Math.sin(dLat/2) * Math.sin(dLat/2) + Math.cos(lat1 * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180) * Math.sin(dLon/2) * Math.sin(dLon/2);
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1-a));
  return R * c;
};

const getDistanceFromPointToSegment = (p: any, v: any, w: any) => {
  const R = 6371; 
  const x = (p.lng - v.lng) * Math.cos((v.lat + p.lat) / 2 * (Math.PI / 180));
  const y = p.lat - v.lat;
  const l2 = Math.pow((w.lng - v.lng) * Math.cos((v.lat + w.lat) / 2 * (Math.PI / 180)), 2) + Math.pow(w.lat - v.lat, 2);
  if (l2 === 0) return Math.sqrt(x*x + y*y) * (Math.PI / 180) * R;
  let t = ((p.lng - v.lng) * (w.lng - v.lng) + (p.lat - v.lat) * (w.lat - v.lat)) / (l2 / (Math.cos((v.lat + w.lat) / 2 * (Math.PI / 180)) ** 2));
  const dx = w.lng - v.lng;
  const dy = w.lat - v.lat;
  let t_param = ((p.lng - v.lng) * dx + (p.lat - v.lat) * dy) / (dx*dx + dy*dy);
  t_param = Math.max(0, Math.min(1, t_param));
  const closestLng = v.lng + t_param * dx;
  const closestLat = v.lat + t_param * dy;
  const dLat = (p.lat - closestLat) * (Math.PI / 180);
  const dLng = (p.lng - closestLng) * (Math.PI / 180);
  const a = Math.sin(dLat/2) * Math.sin(dLat/2) + Math.cos(closestLat * (Math.PI/180)) * Math.cos(p.lat * (Math.PI/180)) * Math.sin(dLng/2) * Math.sin(dLng/2);
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1-a));
  return R * c;
};

const isPointNearPolyline = (point: any, polyline: any[], maxDistKm: number) => {
  if (polyline.length === 0) return false;
  if (Math.abs(point.lat - polyline[0][0]) > 1 && Math.abs(point.lng - polyline[0][1]) > 1) return false; 
  for (let i = 0; i < polyline.length - 1; i++) {
    const v = { lat: polyline[i][0], lng: polyline[i][1] };
    const w = { lat: polyline[i+1][0], lng: polyline[i+1][1] };
    const dist = getDistanceFromPointToSegment(point, v, w);
    if (dist <= maxDistKm) return true;
  }
  return false;
};

// --- [MODULAR FEATURE 2 & 4] SOLAR EPHEMERIS, AZIMUTH & CAI WALKING TIME CALCULATOR ---
const computeBearing = (lat1: number, lon1: number, lat2: number, lon2: number) => {
  const dLon = ((lon2 - lon1) * Math.PI) / 180;
  const lat1Rad = (lat1 * Math.PI) / 180;
  const lat2Rad = (lat2 * Math.PI) / 180;
  const y = Math.sin(dLon) * Math.cos(lat2Rad);
  const x =
    Math.cos(lat1Rad) * Math.sin(lat2Rad) -
    Math.sin(lat1Rad) * Math.cos(lat2Rad) * Math.cos(dLon);
  const deg = Math.round(((Math.atan2(y, x) * 180) / Math.PI + 360) % 360);
  const dirs = ['N', 'NE', 'E', 'SE', 'S', 'SW', 'W', 'NW'];
  const cardinal = dirs[Math.round(deg / 45) % 8];
  return { deg, cardinal };
};

const computeSolarTimes = (lat: number, lng: number, altitude: number = 0) => {
  const now = new Date();
  const start = new Date(now.getFullYear(), 0, 0);
  const dayOfYear = Math.floor((now.getTime() - start.getTime()) / 86400000);
  const rad = Math.PI / 180;

  // Declinazione solare ed equazione del tempo (approssimazione astronomica NOAA)
  const gamma = ((2 * Math.PI) / 365) * (dayOfYear - 1 + (12 - 12) / 24);
  const eqTime =
    229.18 *
    (0.000075 +
      0.001868 * Math.cos(gamma) -
      0.032077 * Math.sin(gamma) -
      0.014615 * Math.cos(2 * gamma) -
      0.040849 * Math.sin(2 * gamma));
  const decl =
    0.006918 -
    0.399912 * Math.cos(gamma) +
    0.070257 * Math.sin(gamma) -
    0.006758 * Math.cos(2 * gamma) +
    0.000907 * Math.sin(2 * gamma) -
    0.002697 * Math.cos(3 * gamma) +
    0.00148 * Math.sin(3 * gamma);

  // Correzione depressione orizzonte per la quota altimetrica (in gradi)
  const altDipDeg = altitude > 0 ? 0.0347 * Math.sqrt(altitude) : 0;
  const zenithOfficial = (90.833 + altDipDeg) * rad;
  const zenithCivil = 96.0 * rad;

  const calcHourAngle = (zenithRad: number) => {
    const cosHA =
      Math.cos(zenithRad) / (Math.cos(lat * rad) * Math.cos(decl)) -
      Math.tan(lat * rad) * Math.tan(decl);
    return Math.acos(Math.max(-1, Math.min(1, cosHA))) / rad;
  };

  const haSun = calcHourAngle(zenithOfficial);
  const haCivil = calcHourAngle(zenithCivil);
  const tzOffsetMin = -now.getTimezoneOffset();

  const solarNoonMin = 720 - 4 * lng - eqTime + tzOffsetMin;
  const sunriseMin = solarNoonMin - haSun * 4;
  const sunsetMin = solarNoonMin + haSun * 4;
  const civilDuskMin = solarNoonMin + haCivil * 4;

  const formatMin = (m: number) => {
    const norm = ((Math.round(m) % 1440) + 1440) % 1440;
    const hh = String(Math.floor(norm / 60)).padStart(2, '0');
    const mm = String(norm % 60).padStart(2, '0');
    return `${hh}:${mm}`;
  };

  const nowMin = now.getHours() * 60 + now.getMinutes();
  let remainingLightLabel = 'Notte (oltre il crepuscolo)';
  let isDaylight = false;

  if (nowMin < sunriseMin) {
    const diff = Math.round(sunriseMin - nowMin);
    remainingLightLabel = `Alba tra ${Math.floor(diff / 60)}h ${diff % 60}m`;
  } else if (nowMin <= sunsetMin) {
    isDaylight = true;
    const diff = Math.round(sunsetMin - nowMin);
    remainingLightLabel = `${Math.floor(diff / 60)}h ${diff % 60}m di luce residua`;
  } else if (nowMin <= civilDuskMin) {
    const diff = Math.round(civilDuskMin - nowMin);
    remainingLightLabel = `Crepuscolo (${diff}m di luce civile)`;
  }

  return {
    sunrise: formatMin(sunriseMin),
    sunset: formatMin(sunsetMin),
    civilTwilightEnd: formatMin(civilDuskMin),
    remainingLightLabel,
    isDaylight,
  };
};

const computeCaiWalkingEstimate = (
  fromLat: number,
  fromLng: number,
  fromAlt: number,
  toLat: number,
  toLng: number,
  toAlt: number
) => {
  const linearDistKm = getDistance(fromLat, fromLng, toLat, toLng);
  // Fattore tortuosità sentiero alpino medio (~1.25x rispetto alla linea d'aria)
  const trailDistKm = linearDistKm * 1.25;
  const deltaH = Math.round((toAlt || 0) - (fromAlt || 0));

  // Formula CAI / Munter: 4 km/h orizzontale, +350 m/h salita, -500 m/h discesa
  const horizHours = trailDistKm / 4.0;
  const vertHours = deltaH >= 0 ? deltaH / 350.0 : Math.abs(deltaH) / 500.0;
  const totalHours = Math.max(horizHours, vertHours) + 0.5 * Math.min(horizHours, vertHours);
  const totalMinutes = Math.max(5, Math.round(totalHours * 60));
  const h = Math.floor(totalMinutes / 60);
  const m = totalMinutes % 60;
  const caiTimeFormatted = h > 0 ? `${h}h ${m}m` : `${m} min`;
  const { deg, cardinal } = computeBearing(fromLat, fromLng, toLat, toLng);

  return {
    linearDistKm,
    trailDistKm,
    deltaH,
    totalMinutes,
    caiTimeFormatted,
    bearingDeg: deg,
    bearingCardinal: cardinal,
  };
};

function useOnClickOutside(ref: React.RefObject<HTMLElement>, handler: (event: MouseEvent | TouchEvent) => void) {
  useEffect(() => {
    const listener = (event: MouseEvent | TouchEvent) => {
      if (!ref.current || ref.current.contains(event.target as Node)) return;
      handler(event);
    };
    document.addEventListener("mousedown", listener);
    document.addEventListener("touchstart", listener);
    return () => {
      document.removeEventListener("mousedown", listener);
      document.removeEventListener("touchstart", listener);
    };
  }, [ref, handler]);
}

const createCustomIcon = (poi: POI, isSelected: boolean, isFavorite: boolean, analysis?: GeoAnalysis | null) => {
  const rawType = (poi.type || '').toString().toLowerCase();
  const rawName = (poi.name || '').toString().toLowerCase();
  const isBivouac = poi.type === POIType.BIVOUAC || rawType.includes('bivacco') || rawName.includes('bivacco');
  const isRefuge = poi.type === POIType.REFUGE || rawType.includes('rifugio') || rawType.includes('alpine_hut') || rawType.includes('refuge') || rawName.includes('rifugio');
  const isFountain = poi.type === POIType.FOUNTAIN || rawType.includes('fontan') || rawType.includes('sorgente') || rawType.includes('drinking_water') || rawName.includes('fontana') || rawName.includes('sorgente');
  const isPicnic = poi.type === POIType.PICNIC || rawType.includes('picnic') || rawName.includes('picnic');
  const isViewpoint = poi.type === POIType.VIEWPOINT || rawType.includes('panoram') || rawType.includes('viewpoint') || rawType.includes('peak') || rawName.includes('cima');

  if (isSelected) {
    const cardWidth = Math.min(195, typeof window !== 'undefined' ? window.innerWidth - 32 : 195);
    
    const signalLevel = analysis ? analysis.signalEstimate.level : poi.signal;
    
    let signalColor = 'text-zinc-500';
    let signalText = 'N/D';
    let signalIconColor = '#71717a';

    if (signalLevel === SignalStrength.EXCELLENT || signalLevel === SignalStrength.HIGH) {
        signalColor = 'text-emerald-400';
        signalIconColor = '#34d399';
        signalText = signalLevel;
    } else if (signalLevel === SignalStrength.MEDIUM) {
        signalColor = 'text-yellow-400';
        signalIconColor = '#facc15';
        signalText = signalLevel;
    } else if (signalLevel === SignalStrength.LOW) {
        signalColor = 'text-orange-400';
        signalIconColor = '#fb923c';
        signalText = signalLevel;
    } else if (signalLevel === SignalStrength.NONE) {
        signalColor = 'text-red-400';
        signalIconColor = '#f87171';
        signalText = 'No Segnale';
    } else {
        signalText = 'Verifica...';
    }

    const favBtnClass = isFavorite 
      ? 'bg-red-900/30 border-red-500/50 text-red-500' 
      : 'bg-zinc-800 border-zinc-700 text-zinc-400 hover:text-zinc-200';

    const favIconFill = isFavorite ? '#ef4444' : 'none';
    const altText = poi.altitude > 0 ? `${poi.altitude}m` : 'Rilevamento...';

    // Mini icona tipologia coerente con i filtri per l'header del popup
    let typeIconSvg = '';
    let typeTextColor = 'text-orange-500';

    if (isBivouac) {
      typeTextColor = 'text-orange-500';
      typeIconSvg = `<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" class="shrink-0"><path d="M3.5 21 14 3"/><path d="M20.5 21 10 3"/><path d="M15.5 21 12 15l-3.5 6"/><path d="M2 21h20"/></svg>`;
    } else if (isRefuge) {
      typeTextColor = 'text-rose-400';
      typeIconSvg = `<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" class="shrink-0"><path d="m3 9 9-7 9 7v11a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"/><polyline points="9 22 9 12 15 12 15 22"/></svg>`;
    } else if (isFountain) {
      typeTextColor = 'text-sky-400';
      typeIconSvg = `<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="shrink-0"><path d="M7 16.3c2.2 0 4-1.83 4-4.05 0-1.16-.57-2.26-1.71-3.19S7.29 6.75 7 5.3c-.29 1.45-1.14 2.84-2.29 3.76S3 11.1 3 12.25c0 2.22 1.8 4.05 4 4.05z"/><path d="M12.56 6.6A10.97 10.97 0 0 0 14 3.02c.5 2.5 2 4.9 4 6.5s3 3.5 3 5.5a6.98 6.98 0 0 1-11.91 4.97"/></svg>`;
    } else if (isPicnic) {
      typeTextColor = 'text-emerald-400';
      typeIconSvg = `<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="shrink-0"><path d="M11 20A7 7 0 0 1 9.8 6.1C15.5 5 17 4.48 19 2c1 2 2 4.18 2 8 0 5.5-4.78 10-10 10Z"/><path d="M2 21c0-3 1.85-5.36 5.08-6C9.5 14.52 12 13 13 12"/></svg>`;
    } else {
      typeTextColor = 'text-purple-400';
      typeIconSvg = `<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="shrink-0"><circle cx="12" cy="12" r="10"/><polygon points="16.24 7.76 14.12 14.12 7.76 16.24 9.88 9.88 16.24 7.76"/></svg>`;
    }

    return L.divIcon({
      className: 'custom-poi-marker-expanded',
      html: `
        <div style="position: absolute; bottom: 0; left: 50%; transform: translate(-50%, 0) rotate(var(--map-counter-rotation, 0deg)); width: ${cardWidth}px; max-width: calc(100vw - 32px); box-sizing: border-box;" class="flex flex-col items-center pointer-events-auto origin-bottom transition-all duration-200 ease-out z-[9999]">
            <div class="bg-zinc-900 border border-orange-500 rounded-xl shadow-2xl p-3 flex flex-col justify-between cursor-default w-full" style="min-height: 120px;">
                <div>
                   <div class="flex justify-between items-center gap-1 mb-1">
                      <div class="text-xs font-bold ${typeTextColor} uppercase tracking-wide truncate max-w-[95px] flex items-center gap-1">
                         ${typeIconSvg}
                         <span class="truncate">${poi.type}</span>
                      </div>
                      <div class="flex items-center gap-1 shrink-0">
                         <div class="text-[11px] font-mono text-zinc-300 bg-zinc-800 border border-orange-500/30 px-1.5 py-0.5 rounded">${altText}</div>
                         <button onclick="window.closeMountProPopup(event)" class="w-5 h-5 rounded-md bg-zinc-800 hover:bg-zinc-700 text-zinc-400 hover:text-white flex items-center justify-center border border-zinc-700 cursor-pointer" title="Chiudi">
                            <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><path d="M18 6 6 18"/><path d="m6 6 12 12"/></svg>
                         </button>
                      </div>
                   </div>
                   <h3 class="font-bold text-sm text-white leading-tight mb-2 pr-1 line-clamp-2">${poi.name}</h3>
                   
                   <div class="flex items-center gap-1.5 mb-2 flex-wrap">
                      <div class="flex items-center gap-1.5 bg-zinc-800/80 rounded-md px-2 py-1 border border-zinc-700/50">
                         <svg viewBox="0 0 24 24" fill="none" stroke="${signalIconColor}" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="w-3 h-3">
                            <path d="M2 20h.01"/><path d="M7 20v-4"/><path d="M12 20v-8"/><path d="M17 20V8"/><path d="M22 20V4"/>
                         </svg>
                         <span class="text-[10px] font-bold ${signalColor}">${signalText}</span>
                      </div>
                      ${poi.userNote ? `<span class="text-[9px] font-bold text-emerald-400 bg-emerald-950/60 border border-emerald-700/50 px-1.5 py-0.5 rounded">Nota</span>` : analysis ? `<span class="text-[9px] text-zinc-400 italic truncate max-w-[70px]">Meteo OK</span>` : ''}
                   </div>
                </div>
                <div class="flex gap-1.5 mt-auto pt-1">
                    <button onclick="window.openMountProDetails(event, '${poi.id}')" class="flex-1 bg-orange-600 hover:bg-orange-500 text-white text-[10px] font-bold py-1.5 rounded-lg transition-colors flex items-center justify-center gap-1 cursor-pointer shadow">
                       Dettagli
                    </button>
                    <button onclick="window.toggleMountProTourWaypoint(event, '${poi.id}')" class="px-1.5 h-7 flex items-center justify-center gap-0.5 rounded-lg border border-emerald-500/40 bg-emerald-950/40 text-emerald-400 hover:bg-emerald-900/50 text-[9px] font-bold transition-all cursor-pointer" title="Aggiungi / Rimuovi Tappa dal Tour">
                       +Tour
                    </button>
                    <button onclick="window.toggleMountProTargetLock(event, '${poi.id}')" class="w-7 h-7 flex items-center justify-center rounded-lg border border-cyan-500/40 bg-cyan-950/40 text-cyan-400 hover:bg-cyan-900/50 transition-all cursor-pointer" title="Punta con Bussola (Target Lock)">
                       <svg xmlns="http://www.w3.org/2000/svg" width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round">
                          <circle cx="12" cy="12" r="10"/><polygon points="16.24 7.76 14.12 14.12 7.76 16.24 9.88 9.88 16.24 7.76"/>
                       </svg>
                    </button>
                    <button onclick="window.toggleMountProFavorite(event, '${poi.id}')" class="w-7 h-7 flex items-center justify-center rounded-lg border transition-all cursor-pointer ${favBtnClass}" title="Preferito">
                       <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="${favIconFill}" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                          <path d="M19 14c1.49-1.46 3-3.21 3-5.5A5.5 5.5 0 0 0 16.5 3c-1.76 0-3 .5-4.5 2-1.5-1.5-2.74-2-4.5-2A5.5 5.5 0 0 0 2 8.5c0 2.3 1.5 4.05 3 5.5l7 7Z"/>
                       </svg>
                    </button>
                </div>
            </div>
            <!-- Punta arancio del popup, posizionata precisamente all'altezza del punto POI -->
            <div class="w-0 h-0 border-l-[7px] border-l-transparent border-r-[7px] border-r-transparent border-t-[8px] border-t-orange-500 -mt-px shrink-0"></div>
        </div>
      `,
      iconSize: [cardWidth, 0], 
      iconAnchor: [cardWidth / 2, 0], 
    });
  }

  let size = 30;
  let baseColor = '#0284c7';
  let innerSvg = '';
  let isPin = false;

  if (isBivouac) {
    size = 35;
    baseColor = '#ea580c'; // Arancio Bivacco CAI
    isPin = true;
    const color = isFavorite ? '#ef4444' : baseColor;
    innerSvg = `
      <!-- Pin Bivacco CAI con icona Tenda Lucide (identica al filtro) -->
      <path d="M12 2C7.58 2 4 5.58 4 10C4 15.2 12 22 12 22C12 22 20 15.2 20 10C20 5.58 16.42 2 12 2Z" fill="${color}" stroke="white" stroke-width="1.5"/>
      <g transform="translate(6.6, 4.2) scale(0.45)" stroke="white" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" fill="none">
        <path d="M3.5 21 14 3"/>
        <path d="M20.5 21 10 3"/>
        <path d="M15.5 21 12 15l-3.5 6"/>
        <path d="M2 21h20"/>
      </g>
    `;
  } else if (isRefuge) {
    size = 35;
    baseColor = '#e11d48'; // Rosso Rubino Rifugio Alpino CAI distinto dall'arancione
    isPin = true;
    const color = isFavorite ? '#ef4444' : baseColor;
    innerSvg = `
      <!-- Pin Rifugio Alpino con icona Home Lucide (identica al filtro) -->
      <path d="M12 2C7.58 2 4 5.58 4 10C4 15.2 12 22 12 22C12 22 20 15.2 20 10C20 5.58 16.42 2 12 2Z" fill="${color}" stroke="white" stroke-width="1.5"/>
      <g transform="translate(6.6, 3.8) scale(0.45)" stroke="white" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" fill="none">
        <path d="m3 9 9-7 9 7v11a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"/>
        <polyline points="9 22 9 12 15 12 15 22"/>
      </g>
    `;
  } else if (isFountain) {
    size = 30;
    baseColor = '#0284c7'; // Blu Acqua Fontana
    const color = isFavorite ? '#ef4444' : baseColor;
    innerSvg = `
      <!-- Badge Fontana con icona Droplets Lucide (identica al filtro) -->
      <circle cx="12" cy="12" r="10" fill="${color}" stroke="white" stroke-width="2"/>
      <g transform="translate(4.8, 4.8) scale(0.6)" fill="white" stroke="white" stroke-width="1.2" stroke-linecap="round" stroke-linejoin="round">
        <path d="M7 16.3c2.2 0 4-1.83 4-4.05 0-1.16-.57-2.26-1.71-3.19S7.29 6.75 7 5.3c-.29 1.45-1.14 2.84-2.29 3.76S3 11.1 3 12.25c0 2.22 1.8 4.05 4 4.05z"/>
        <path d="M12.56 6.6A10.97 10.97 0 0 0 14 3.02c.5 2.5 2 4.9 4 6.5s3 3.5 3 5.5a6.98 6.98 0 0 1-11.91 4.97"/>
      </g>
    `;
  } else if (isPicnic) {
    size = 30;
    baseColor = '#16a34a'; // Verde Bosco Area Picnic
    const color = isFavorite ? '#ef4444' : baseColor;
    innerSvg = `
      <!-- Badge Area Picnic con icona Leaf Lucide (identica al filtro) -->
      <circle cx="12" cy="12" r="10" fill="${color}" stroke="white" stroke-width="2"/>
      <g transform="translate(5, 5) scale(0.58)" fill="none" stroke="white" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
        <path d="M11 20A7 7 0 0 1 9.8 6.1C15.5 5 17 4.48 19 2c1 2 2 4.18 2 8 0 5.5-4.78 10-10 10Z" fill="white"/>
        <path d="M2 21c0-3 1.85-5.36 5.08-6C9.5 14.52 12 13 13 12" stroke="${color}" stroke-width="2"/>
      </g>
    `;
  } else {
    // VIEWPOINT
    size = 30;
    baseColor = '#9333ea'; // Viola Punto Panoramico
    const color = isFavorite ? '#ef4444' : baseColor;
    innerSvg = `
      <!-- Badge Punto Panoramico con icona Bussola Compass Lucide (identica al filtro) -->
      <circle cx="12" cy="12" r="10" fill="${color}" stroke="white" stroke-width="2"/>
      <g transform="translate(5, 5) scale(0.58)" fill="none" stroke="white" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
        <circle cx="12" cy="12" r="10"/>
        <polygon points="16.24 7.76 14.12 14.12 7.76 16.24 9.88 9.88 16.24 7.76" fill="white"/>
      </g>
    `;
  }

  return L.divIcon({
    className: 'custom-poi-marker',
    html: `
      <div class="w-full h-full drop-shadow-lg transition-all duration-300 origin-bottom hover:scale-110 cursor-pointer">
        <svg viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg" class="w-full h-full">
          ${innerSvg}
          ${isFavorite ? `<circle cx="${isPin ? 18 : 19}" cy="${isPin ? 6 : 5}" r="3" fill="#ef4444" stroke="white" stroke-width="1"/>` : ''}
        </svg>
      </div>
    `,
    iconSize: [size, size],
    iconAnchor: isPin ? [size / 2, size] : [size / 2, size / 2],
  });
};

const createClusterIcon = (count: number) => {
  let size = 26;
  let bgClass = 'bg-zinc-900/95 text-orange-400 border-orange-500 shadow-orange-950/40';
  const badgeText = count > 999 ? '999+' : `${count}`;

  if (count < 10) {
    size = 26;
    bgClass = 'bg-zinc-900/95 text-orange-400 border-orange-500 shadow-orange-950/40';
  } else if (count < 50) {
    size = 30;
    bgClass = 'bg-zinc-900/95 text-orange-300 border-orange-500 shadow-orange-950/50';
  } else {
    size = 34;
    bgClass = 'bg-orange-600 text-white border-white shadow-orange-900/60 font-black';
  }

  const fontSizeClass = size <= 26 ? 'text-[10px]' : size <= 30 ? 'text-[11px]' : 'text-xs';

  return L.divIcon({
    className: 'custom-poi-cluster',
    html: `
      <div class="relative flex items-center justify-center rounded-full border-[1.5px] shadow-lg ${bgClass} cursor-pointer transition-transform duration-200 hover:scale-110 active:scale-95" style="width: ${size}px; height: ${size}px;">
        <span class="font-mono ${fontSizeClass} font-black tracking-tight select-none leading-none">${badgeText}</span>
      </div>
    `,
    iconSize: [size, size],
    iconAnchor: [size / 2, size / 2],
  });
};

const getWeatherIcon = (code: number) => {
  if (code <= 1) return <Sun size={16} className="text-yellow-500" />;
  if (code <= 3) return <Cloud size={16} className="text-zinc-300" />; 
  if (code <= 48) return <CloudFog size={16} className="text-zinc-400" />;
  if (code <= 67) return <CloudRain size={16} className="text-blue-400" />;
  if (code <= 77) return <Snowflake size={16} className="text-white" />;
  if (code <= 82) return <CloudRain size={16} className="text-blue-500" />;
  if (code <= 86) return <Snowflake size={16} className="text-white" />;
  if (code <= 99) return <CloudLightning size={16} className="text-purple-400" />;
  return <Cloud size={16} className="text-zinc-400" />;
};

const getWeatherIconLarge = (code: number) => {
  if (code <= 1) return <Sun size={48} className="text-yellow-500" />;
  if (code <= 3) return <Cloud size={48} className="text-zinc-300" />; 
  if (code <= 48) return <CloudFog size={48} className="text-zinc-400" />;
  if (code <= 67) return <CloudRain size={48} className="text-blue-400" />;
  if (code <= 77) return <Snowflake size={48} className="text-white" />;
  if (code <= 82) return <CloudRain size={48} className="text-blue-500" />;
  if (code <= 86) return <Snowflake size={48} className="text-white" />;
  if (code <= 99) return <CloudLightning size={48} className="text-purple-400" />;
  return <Cloud size={48} className="text-zinc-400" />;
};

interface TrackPoint {
  lat: number;
  lng: number;
  ele: number;
  dist: number;
  time?: number; 
  hr?: number;
  temp?: number;
  cadence?: number;
}

interface TrackStats {
  totalDistance: number;
  elevationGain: number;
  elevationLoss: number;
  minElevation: number;
  maxElevation: number;
  totalTimeSeconds?: number;
  avgSpeedKmh?: number;
  maxGrade?: number;
  avgGrade?: number;
  isEstimatedTime?: boolean;
  vam?: number;
  avgHr?: number;
  maxHr?: number;
  avgTemp?: number;
}

interface RadarFrame {
  time: number;
  path: string;
  isForecast: boolean;
}

interface LoadedTrack {
  id: string;
  name: string;
  latlngs: [number, number][];
  points: TrackPoint[];
  stats: TrackStats;
  color: string;
}

// --- [MODULAR FEATURE 1 & 4] GPX WEATHER WATCH & TARGET LOCK INTERFACES ---
interface GpxWeatherCheckpoint {
  label: 'Partenza' | 'Quota Max' | 'Arrivo';
  pointIndex: number;
  lat: number;
  lng: number;
  ele: number;
  temp: number;
  windSpeed: number;
  windGusts: number;
  weatherCode: number;
  precipProb: number;
  passageTime?: string;
}

interface GpxWeatherWatchData {
  trackId: string;
  freezingLevel: number;
  departureDate: string;
  departureTime: string;
  checkpoints: GpxWeatherCheckpoint[];
  alerts: { level: 'danger' | 'warn' | 'ok'; message: string }[];
}

interface TargetLockPoint {
  id: string;
  name: string;
  lat: number;
  lng: number;
  altitude: number | null;
}

const TRACK_COLORS = ['#ea580c', '#d946ef'];

export default function App() {
  const [isSidebarOpen, setIsSidebarOpen] = useState(false); 
  const [selectedPoi, setSelectedPoi] = useState<POI | null>(null);
  const [isDetailPanelOpen, setIsDetailPanelOpen] = useState(false);
  const [viewMode, setViewMode] = useState<'list' | 'map'>('map'); 
  const [geoAnalysis, setGeoAnalysis] = useState<GeoAnalysis | null>(null); 
  const [isLoadingAnalysis, setIsLoadingAnalysis] = useState(false);
  const [isOffline, setIsOffline] = useState(!navigator.onLine);
  const [isDownloading, setIsDownloading] = useState(false);
  const [downloadProgress, setDownloadProgress] = useState<'idle' | 'fetching' | 'saving' | 'done'>('idle');
  const [downloadCount, setDownloadCount] = useState(0);

  // New state for highlighting selected search result
  const [highlightedPoiId, setHighlightedPoiId] = useState<string | null>(null);

  // Weather Widget State
  const [centerWeather, setCenterWeather] = useState<{ temp: number; code: number; humidity: number } | null>(null);
  const [weatherOverlayActive, setWeatherOverlayActive] = useState(false);
  
  // Area Weather Panel State
  const [isWeatherPanelOpen, setIsWeatherPanelOpen] = useState(false);
  const [areaWeatherInfo, setAreaWeatherInfo] = useState<GeoAnalysis | null>(null);
  const [isLoadingAreaWeather, setIsLoadingAreaWeather] = useState(false);
  // Remove unused Ref for weather panel since we are full screen now
  const weatherPanelRef = useRef<HTMLDivElement>(null); 

  // Radar Animation State
  const [radarFrames, setRadarFrames] = useState<RadarFrame[]>([]);
  const [currentFrameIndex, setCurrentFrameIndex] = useState<number>(-1);
  const [isRadarPlaying, setIsRadarPlaying] = useState(false);
  const [isRadarLoading, setIsRadarLoading] = useState(false);
  const radarLayersRef = useRef<L.TileLayer[]>([]); 

  // Location State
  const [isLocating, setIsLocating] = useState(false);
  const [userLocation, setUserLocation] = useState<{lat: number, lng: number} | null>(null);
  const [userHeading, setUserHeading] = useState<number>(0);
  const locationWatchId = useRef<number | null>(null);
  const shouldCenterRef = useRef<boolean>(false);

  // Note Draft State
  const [userNoteDraft, setUserNoteDraft] = useState('');
  const [allPois, setAllPois] = useState<POI[]>([]);

  // GPX & Trails State (inizializzato in testa al componente per garantire disponibilità in tutti gli hook)
  const [isTrailsMenuOpen, setIsTrailsMenuOpen] = useState(false);
  const [tracks, setTracks] = useState<LoadedTrack[]>([]);
  const [focusedTrackId, setFocusedTrackId] = useState<string | null>(null);
  const [hoveredTrackIndex, setHoveredTrackIndex] = useState<number | null>(null);
  const [isTrackPanelOpen, setIsTrackPanelOpen] = useState(false);
  const [isTrackPanelExpanded, setIsTrackPanelExpanded] = useState(false);
  const touchStartRef = useRef<number | null>(null);
  const hoveredTrackPoint = useMemo(() => {
    if (hoveredTrackIndex === null || !focusedTrackId) return null;
    const track = tracks.find(t => t.id === focusedTrackId) || tracks[0];
    if (!track || !track.points) return null;
    return track.points[hoveredTrackIndex];
  }, [hoveredTrackIndex, focusedTrackId, tracks]);
  const [filterByTrack, setFilterByTrack] = useState(false);
  const [trackBuffer, setTrackBuffer] = useState(2);
  
  // Favorites State
  const [favorites, setFavorites] = useState<Set<string>>(() => {
     try {
       const saved = localStorage.getItem('mountpro_favorites');
       return new Set(saved ? JSON.parse(saved) : []);
     } catch (e) {
       return new Set();
     }
  });
  const [showFavoritesOnly, setShowFavoritesOnly] = useState(false);
  const mapViewState = useRef({ center: { lat: 46.2, lng: 11.4 }, zoom: 9 });
  
  const [isMapReady, setIsMapReady] = useState(false);

  // SCROLL REF FOR DETAIL PANEL
  const detailScrollRef = useRef<HTMLDivElement>(null);

  // SEARCH AUTOCOMPLETE STATE
  const [searchSuggestions, setSearchSuggestions] = useState<POI[]>([]);
  const [showSuggestions, setShowSuggestions] = useState(false);
  const searchTimeoutRef = useRef<any>(null);
  const searchContainerRef = useRef<HTMLDivElement>(null);
  
  // PENDING FOCUS REF (For robust List->Map transition)
  const pendingFocusRef = useRef<POI | null>(null);

  // Toast feedback state
  const [toastMessage, setToastMessage] = useState<string | null>(null);
  const showToast = (msg: string) => {
    setToastMessage(msg);
    setTimeout(() => setToastMessage(null), 3000);
  };

  // PWA Install State
  const { isInstallable, isInstalled, isIOS, install: installPwa } = usePWAInstall();
  const [showIOSGuide, setShowIOSGuide] = useState(false);

  // Fullscreen State & Handler
  const [isFullscreen, setIsFullscreen] = useState(false);
  useEffect(() => {
    const onFullscreenChange = () => {
      setIsFullscreen(!!document.fullscreenElement);
    };
    document.addEventListener('fullscreenchange', onFullscreenChange);
    document.addEventListener('webkitfullscreenchange', onFullscreenChange);
    return () => {
      document.removeEventListener('fullscreenchange', onFullscreenChange);
      document.removeEventListener('webkitfullscreenchange', onFullscreenChange);
    };
  }, []);

  const toggleFullscreen = async () => {
    try {
      if (!document.fullscreenElement) {
        if (document.documentElement.requestFullscreen) {
          await document.documentElement.requestFullscreen();
        } else if ((document.documentElement as any).webkitRequestFullscreen) {
          await (document.documentElement as any).webkitRequestFullscreen();
        }
      } else {
        if (document.exitFullscreen) {
          await document.exitFullscreen();
        } else if ((document as any).webkitExitFullscreen) {
          await (document as any).webkitExitFullscreen();
        }
      }
    } catch (err) {
      console.warn("Fullscreen toggle error:", err);
    }
  };

  // Load from DB on start and seed Veneto & Trentino offline regional database
  useEffect(() => {
    const loadData = async () => {
      try {
        const storedPois = await dbService.getAllPois();
        const baseMap = new Map<string, POI>();
        
        // Inserisci i POI alpini di base e il catalogo completo di Veneto e Trentino
        MOCK_POIS.forEach(p => baseMap.set(p.id, p));
        REGIONAL_VENETO_TRENTINO_POIS.forEach(p => baseMap.set(p.id, p));
        
        // Se l'utente ha già salvato POI nel DB locale (note, preferiti, scaricati), uniscili
        if (storedPois.length > 0) {
          storedPois.forEach(p => {
            const existing = baseMap.get(p.id);
            if (existing) {
              baseMap.set(p.id, { ...existing, ...p, altitude: existing.altitude || p.altitude });
            } else {
              baseMap.set(p.id, p);
            }
          });
        }
        
        // Ripristina anche il backup locale delle note personali da localStorage
        try {
          const notesBackupRaw = localStorage.getItem('mountpro_notes_backup');
          if (notesBackupRaw) {
            const notesMap: Record<string, string> = JSON.parse(notesBackupRaw);
            Object.entries(notesMap).forEach(([poiId, noteText]) => {
              const ex = baseMap.get(poiId);
              if (ex && noteText) {
                baseMap.set(poiId, { ...ex, userNote: noteText });
              }
            });
          }
        } catch (err) {}

        const combined = Array.from(baseMap.values());
        setAllPois(combined);
        seedElevationCacheFromPois(combined);
        await dbService.savePois(combined);

        // --- [MODULAR OFFLINE PERSISTENCE] Ripristino sessione offline (Tracce GPX, Analisi, Meteo, Tour) ---
        try {
          const savedTracks = await dbService.getOfflineItem<LoadedTrack[]>('active_gpx_tracks_v1');
          if (savedTracks && Array.isArray(savedTracks) && savedTracks.length > 0) {
            setTracks(savedTracks);
            setFocusedTrackId(savedTracks[0].id);
            savedTracks.forEach(t => seedElevationCacheFromPoints(t.points));
          }
          const savedTrailAnalysis = await dbService.getOfflineItem<Record<string, GpxTrailAnalysisResult>>('gpx_trail_analysis_v1');
          if (savedTrailAnalysis && typeof savedTrailAnalysis === 'object') {
            setGpxTrailAnalysis(savedTrailAnalysis);
          }
          const savedWeatherWatch = await dbService.getOfflineItem<Record<string, any>>('gpx_weather_watch_v1');
          if (savedWeatherWatch && typeof savedWeatherWatch === 'object') {
            setGpxWeatherWatch(savedWeatherWatch);
          }
          const savedTourWps = await dbService.getOfflineItem<TourWaypoint[]>('tour_waypoints_v1');
          if (savedTourWps && Array.isArray(savedTourWps) && savedTourWps.length > 0) {
            setTourWaypoints(savedTourWps);
          }
          const cachedCenterWeather = localStorage.getItem('mountpro_center_weather_v1');
          if (cachedCenterWeather) {
            const parsedCw = JSON.parse(cachedCenterWeather);
            if (parsedCw && typeof parsedCw.temp === 'number') {
              setCenterWeather(parsedCw);
            }
          }
        } catch (offlineRestoreErr) {
          console.warn("Offline state restore error:", offlineRestoreErr);
        }
      } catch (e) {
        console.error("Failed to load from DB", e);
        const fallbackPois = [...MOCK_POIS, ...REGIONAL_VENETO_TRENTINO_POIS];
        setAllPois(fallbackPois);
        seedElevationCacheFromPois(fallbackPois);
      }
    };
    loadData();
  }, []);

  useEffect(() => {
    if (highlightedPoiId) {
      const timer = setTimeout(() => {
        setHighlightedPoiId(null);
      }, 2500); 
      return () => clearTimeout(timer);
    }
  }, [highlightedPoiId]);

  useEffect(() => {
    if (selectedPoi) {
      setUserNoteDraft(selectedPoi.userNote || '');
    }
  }, [selectedPoi]);

  useEffect(() => {
      if (isDetailPanelOpen && detailScrollRef.current) {
          detailScrollRef.current.scrollTop = 0;
      }
  }, [selectedPoi, isDetailPanelOpen]);
  
  useEffect(() => {
      const handleOrientation = (event: DeviceOrientationEvent) => {
          let heading = 0;
          if ((event as any).webkitCompassHeading) {
              heading = (event as any).webkitCompassHeading;
          } else if (event.alpha !== null) {
              heading = 360 - event.alpha;
          }
          setUserHeading(heading);
      };
      if (window.DeviceOrientationEvent) {
          window.addEventListener('deviceorientation', handleOrientation);
      }
      return () => {
          if (window.DeviceOrientationEvent) {
            window.removeEventListener('deviceorientation', handleOrientation);
          }
      };
  }, []);

  // useOnClickOutside removed for WeatherPanelRef because it's now FullScreen/Modal style
  useOnClickOutside(searchContainerRef, () => setShowSuggestions(false));

  const saveToDb = async (pois: POI[]) => {
     if (pois.length > 0) {
        await dbService.savePois(pois);
     }
  };

  const toggleFavorite = async (e: React.MouseEvent, poi: POI) => {
     e.stopPropagation();
     const newFavs = new Set(favorites);
     if (newFavs.has(poi.id)) {
        newFavs.delete(poi.id);
     } else {
        newFavs.add(poi.id);
        await dbService.savePois([poi]);
     }
     setFavorites(newFavs);
     try {
       localStorage.setItem('mountpro_favorites', JSON.stringify([...newFavs]));
     } catch (e) { }
  };

  const saveUserNote = async () => {
    if (!selectedPoi) return;
    const updatedPoi = { ...selectedPoi, userNote: userNoteDraft };
    setAllPois(prev => prev.map(p => p.id === updatedPoi.id ? updatedPoi : p));
    setSelectedPoi(updatedPoi);
    await dbService.savePois([updatedPoi]);
    try {
      const notesBackupRaw = localStorage.getItem('mountpro_notes_backup');
      const notesMap: Record<string, string> = notesBackupRaw ? JSON.parse(notesBackupRaw) : {};
      if (userNoteDraft.trim()) {
        notesMap[updatedPoi.id] = userNoteDraft.trim();
      } else {
        delete notesMap[updatedPoi.id];
      }
      localStorage.setItem('mountpro_notes_backup', JSON.stringify(notesMap));
    } catch (e) {}
    showToast("Nota personale salvata e sincronizzata!");
  };

  // --- [MODULAR FEATURE 3] GPX WAYPOINT EXPORTER ---
  const exportPoisToGpx = (mode: 'saved' | 'filtered' | 'single', singlePoi?: POI) => {
    let listToExport: POI[] = [];
    if (mode === 'single' && singlePoi) {
      listToExport = [singlePoi];
    } else if (mode === 'saved') {
      listToExport = allPois.filter(
        p => favorites.has(p.id) || (p.userNote && p.userNote.trim().length > 0) || p.id.startsWith('custom-')
      );
    } else {
      listToExport = filteredPois;
    }

    if (listToExport.length === 0) {
      showToast("Nessun punto da esportare. Aggiungi preferiti, note o seleziona filtri.");
      return;
    }

    const escapeXml = (str: string) =>
      str
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&apos;');

    const wptsXml = listToExport
      .map(p => {
        const details = [
          `Tipo: ${p.type}`,
          p.capacity ? `Posti: ${p.capacity}` : null,
          p.hasWater ? 'Acqua: Presente' : 'Acqua: Assente',
          p.hasFireplace ? 'Stufa: Presente' : null,
          p.userNote ? `Nota Personale: ${p.userNote}` : null,
          p.description || '',
        ]
          .filter(Boolean)
          .join(' | ');

        return `  <wpt lat="${p.coordinates.lat.toFixed(6)}" lon="${p.coordinates.lng.toFixed(6)}">
    <ele>${p.altitude || 0}</ele>
    <name>${escapeXml(p.name)}</name>
    <type>${escapeXml(p.type)}</type>
    <desc>${escapeXml(details)}</desc>
  </wpt>`;
      })
      .join('\n');

    const gpxContent = `<?xml version="1.0" encoding="UTF-8"?>
<gpx version="1.1" creator="MountPro Explorer" xmlns="http://www.topografix.com/GPX/1/1">
  <metadata>
    <name>MountPro Waypoints (${mode === 'saved' ? 'Preferiti e Note' : mode === 'single' ? singlePoi?.name : 'Punti Filtrati'})</name>
    <time>${new Date().toISOString()}</time>
  </metadata>
${wptsXml}
</gpx>`;

    const blob = new Blob([gpxContent], { type: 'application/gpx+xml;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    const dateStr = new Date().toISOString().slice(0, 10);
    a.href = url;
    a.download = mode === 'single' && singlePoi
      ? `mountpro_${singlePoi.name.toLowerCase().replace(/[^a-z0-9]+/g, '_')}.gpx`
      : `mountpro_waypoints_${mode}_${dateStr}.gpx`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
    showToast(`Esportati ${listToExport.length} waypoint in formato .GPX`);
  };

  // --- [MODULAR FEATURE 4] TARGET LOCK & COMPASS STATE ---
  const [targetLock, setTargetLock] = useState<TargetLockPoint | null>(null);
  const targetLockLayerGroupRef = useRef<L.LayerGroup | null>(null);

  // --- [MODULAR FEATURE 1] GPX WEATHER WATCH STATE (CON DATA E ORA PARTENZA + INPUT TASTIERA MOBILE) ---
  const [gpxWeatherWatch, setGpxWeatherWatch] = useState<Record<string, GpxWeatherWatchData>>({});
  const [isLoadingGpxWeather, setIsLoadingGpxWeather] = useState(false);
  const [gpxWeatherDepartureDate, setGpxWeatherDepartureDate] = useState<string>(() => {
    const now = new Date();
    const y = now.getFullYear();
    const m = String(now.getMonth() + 1).padStart(2, '0');
    const d = String(now.getDate()).padStart(2, '0');
    return `${y}-${m}-${d}`;
  });
  const [gpxWeatherDepartureTime, setGpxWeatherDepartureTime] = useState<string>(() => {
    const now = new Date();
    const hh = String(now.getHours()).padStart(2, '0');
    const mm = String(now.getMinutes()).padStart(2, '0');
    return `${hh}:${mm}`;
  });

  // Stati testo editabili da tastiera numerica mobile (GG/MM/AAAA e OO:MM) sincronizzati con gpxWeatherDepartureDate/Time
  const formatIsoToItaDate = (iso: string) => {
    const [y, m, d] = iso.split('-');
    if (y && m && d) return `${d}/${m}/${y}`;
    return iso;
  };
  const [gpxDateDraft, setGpxDateDraft] = useState<string>(() => {
    const now = new Date();
    return `${String(now.getDate()).padStart(2, '0')}/${String(now.getMonth() + 1).padStart(2, '0')}/${now.getFullYear()}`;
  });
  const [gpxTimeDraft, setGpxTimeDraft] = useState<string>(() => {
    const now = new Date();
    return `${String(now.getHours()).padStart(2, '0')}:${String(now.getMinutes()).padStart(2, '0')}`;
  });

  useEffect(() => {
    setGpxDateDraft(formatIsoToItaDate(gpxWeatherDepartureDate));
  }, [gpxWeatherDepartureDate]);

  useEffect(() => {
    setGpxTimeDraft(gpxWeatherDepartureTime);
  }, [gpxWeatherDepartureTime]);

  const tryParseIsoDate = (raw: string): string | null => {
    const cleaned = raw.trim();
    // Accetta formato GG/MM/AAAA (o GG-MM-AAAA) e AAAA-MM-GG
    const itaMatch = cleaned.match(/^(\d{1,2})[\/\-\.](\d{1,2})[\/\-\.](\d{4})$/);
    if (itaMatch) {
      const dd = parseInt(itaMatch[1], 10);
      const mm = parseInt(itaMatch[2], 10);
      const yyyy = parseInt(itaMatch[3], 10);
      if (dd >= 1 && dd <= 31 && mm >= 1 && mm <= 12 && yyyy >= 2024 && yyyy <= 2035) {
        return `${yyyy}-${String(mm).padStart(2, '0')}-${String(dd).padStart(2, '0')}`;
      }
    }
    const isoMatch = cleaned.match(/^(\d{4})-(\d{2})-(\d{2})$/);
    if (isoMatch) {
      const yyyy = parseInt(isoMatch[1], 10);
      const mm = parseInt(isoMatch[2], 10);
      const dd = parseInt(isoMatch[3], 10);
      if (dd >= 1 && dd <= 31 && mm >= 1 && mm <= 12 && yyyy >= 2024 && yyyy <= 2035) {
        return `${yyyy}-${String(mm).padStart(2, '0')}-${String(dd).padStart(2, '0')}`;
      }
    }
    return null;
  };

  const commitGpxDateDraft = useCallback((raw: string) => {
    const parsedIso = tryParseIsoDate(raw);
    if (parsedIso) {
      setGpxWeatherDepartureDate(parsedIso);
      setGpxDateDraft(formatIsoToItaDate(parsedIso));
      return;
    }
    const cleaned = raw.trim();
    const parts = cleaned.split(/[\/\-\.]/);
    const now = new Date();
    if (parts.length >= 2) {
      const dd = parseInt(parts[0], 10);
      const mm = parseInt(parts[1], 10);
      let yyyy = parts[2] ? parseInt(parts[2], 10) : now.getFullYear();
      if (yyyy < 100) yyyy += 2000;
      if (dd >= 1 && dd <= 31 && mm >= 1 && mm <= 12 && yyyy >= 2024 && yyyy <= 2035) {
        const iso = `${yyyy}-${String(mm).padStart(2, '0')}-${String(dd).padStart(2, '0')}`;
        setGpxWeatherDepartureDate(iso);
        setGpxDateDraft(`${String(dd).padStart(2, '0')}/${String(mm).padStart(2, '0')}/${yyyy}`);
        return;
      }
    }
    setGpxDateDraft(formatIsoToItaDate(gpxWeatherDepartureDate));
  }, [gpxWeatherDepartureDate]);

  const commitGpxTimeDraft = useCallback((raw: string) => {
    const cleaned = raw.trim();
    const digitsOnly = cleaned.replace(/\D/g, '');
    let hh = -1;
    let mm = -1;
    if (cleaned.includes(':') || cleaned.includes('.')) {
      const [hStr, mStr] = cleaned.split(/[:\.]/);
      hh = parseInt(hStr || '0', 10);
      mm = parseInt(mStr || '0', 10);
    } else if (digitsOnly.length >= 3) {
      hh = parseInt(digitsOnly.slice(0, digitsOnly.length - 2), 10);
      mm = parseInt(digitsOnly.slice(-2), 10);
    } else if (digitsOnly.length > 0) {
      hh = parseInt(digitsOnly, 10);
      mm = 0;
    }
    if (hh >= 0 && hh <= 23 && mm >= 0 && mm <= 59) {
      const formatted = `${String(hh).padStart(2, '0')}:${String(mm).padStart(2, '0')}`;
      setGpxWeatherDepartureTime(formatted);
      setGpxTimeDraft(formatted);
      return;
    }
    setGpxTimeDraft(gpxWeatherDepartureTime);
  }, [gpxWeatherDepartureTime]);

  const shiftGpxDepartureDays = useCallback((deltaDays: number) => {
    const base = new Date(`${gpxWeatherDepartureDate}T12:00:00`);
    if (Number.isNaN(base.getTime())) return;
    base.setDate(base.getDate() + deltaDays);
    const iso = `${base.getFullYear()}-${String(base.getMonth() + 1).padStart(2, '0')}-${String(base.getDate()).padStart(2, '0')}`;
    setGpxWeatherDepartureDate(iso);
  }, [gpxWeatherDepartureDate]);

  const shiftGpxDepartureHours = useCallback((deltaHours: number) => {
    const [hStr, mStr] = gpxWeatherDepartureTime.split(':');
    const curH = parseInt(hStr || '8', 10);
    const curM = parseInt(mStr || '0', 10);
    const nextH = (curH + deltaHours + 24) % 24;
    setGpxWeatherDepartureTime(`${String(nextH).padStart(2, '0')}:${String(curM).padStart(2, '0')}`);
  }, [gpxWeatherDepartureTime]);

  // --- [MODULAR FEATURE 1.2 & PEAK CALIBRATION] GPX TRAIL SURFACES, WAYTYPES, SAC & OSM PEAK STATE ---
  const [gpxTrailAnalysis, setGpxTrailAnalysis] = useState<Record<string, GpxTrailAnalysisResult>>({});
  const [isLoadingTrailAnalysis, setIsLoadingTrailAnalysis] = useState(false);

  // --- [MODULAR FEATURE 1.3] PIANIFICATORE RAPIDO "AGGIUNGI AL TOUR" (MULTI-WAYPOINT ROUTE BUILDER) ---
  const [tourWaypoints, setTourWaypoints] = useState<TourWaypoint[]>([]);
  const [isTourPlannerOpen, setIsTourPlannerOpen] = useState(false);
  const [tourLoopBack, setTourLoopBack] = useState(false);
  const [isComputingTour, setIsComputingTour] = useState(false);
  const [computedTourRoute, setComputedTourRoute] = useState<ComputedTourRoute | null>(null);
  const tourPlannerLayerGroupRef = useRef<L.LayerGroup | null>(null);

  const toggleWaypointInTour = useCallback((wp: TourWaypoint) => {
    setTourWaypoints(prev => {
      const exists = prev.some(item => item.id === wp.id);
      if (exists) {
        const next = prev.filter(item => item.id !== wp.id);
        showToast(`Rimosso dal Tour: ${wp.name}`);
        if (next.length === 0) {
          setIsTourPlannerOpen(false);
          setComputedTourRoute(null);
        }
        return next;
      }
      if (prev.length >= 10) {
        showToast("Massimo 10 tappe per singolo Tour");
        return prev;
      }
      const next = [...prev, wp];
      showToast(`Tappa #${next.length} aggiunta al Tour: ${wp.name}`);
      if (next.length >= 2) {
        setIsTourPlannerOpen(true);
      }
      return next;
    });
  }, []);

  const moveTourWaypoint = useCallback((index: number, direction: -1 | 1) => {
    setTourWaypoints(prev => {
      const targetIndex = index + direction;
      if (targetIndex < 0 || targetIndex >= prev.length) return prev;
      const copy = [...prev];
      const temp = copy[index];
      copy[index] = copy[targetIndex];
      copy[targetIndex] = temp;
      return copy;
    });
  }, []);

  const reverseTourWaypoints = useCallback(() => {
    setTourWaypoints(prev => [...prev].reverse());
    showToast("Ordine tappe del Tour invertito");
  }, []);

  const clearTourPlanner = useCallback(() => {
    setTourWaypoints([]);
    setComputedTourRoute(null);
    setIsTourPlannerOpen(false);
    setTourLoopBack(false);
    showToast("Pianificatore Tour azzerato");
  }, []);

  useEffect(() => {
    (window as any).openMountProDetails = (e: MouseEvent, id: string) => {
      e.stopPropagation();
      const p = allPois.find(item => item.id === id);
      if (p) {
        setSelectedPoi(p);
        setIsDetailPanelOpen(true);
      }
    };

    (window as any).toggleMountProFavorite = (e: MouseEvent, id: string) => {
        e.stopPropagation();
        const p = allPois.find(item => item.id === id);
        if (p) {
            toggleFavorite(e as any, p);
        }
    };

    (window as any).toggleMountProTargetLock = (e: MouseEvent, id: string) => {
        e.stopPropagation();
        const p = allPois.find(item => item.id === id);
        if (p) {
            setTargetLock(prev => {
                if (prev?.id === p.id) {
                    showToast("Target Lock disattivato");
                    return null;
                }
                showToast(`Target bloccato: ${p.name}`);
                return {
                    id: p.id,
                    name: p.name,
                    lat: p.coordinates.lat,
                    lng: p.coordinates.lng,
                    altitude: p.altitude || null,
                };
            });
        }
    };

    (window as any).toggleMountProTourWaypoint = (e: MouseEvent, id: string) => {
        e.stopPropagation();
        const p = allPois.find(item => item.id === id);
        if (p) {
            toggleWaypointInTour({
                id: p.id,
                name: p.name,
                lat: p.coordinates.lat,
                lng: p.coordinates.lng,
                altitude: p.altitude || null,
                category: p.type,
            });
        }
    };

    (window as any).closeMountProPopup = (e: MouseEvent) => {
        e.stopPropagation();
        setSelectedPoi(null);
    };
  }, [allPois, toggleWaypointInTour]); 

  const [confirmClearDb, setConfirmClearDb] = useState(false); 

  const [isSearchingArea, setIsSearchingArea] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');
  const [isGlobalSearching, setIsGlobalSearching] = useState(false);
  const [mapStyle, setMapStyle] = useState<'standard' | 'satellite' | 'hybrid'>('standard');
  const [isLayersMenuOpen, setIsLayersMenuOpen] = useState(false);
  
  // Filters (selezione multipla tipologie, o nessuna - all'avvio solo la mappa pulita)
  const [selectedTypes, setSelectedTypes] = useState<POIType[]>([]);
  const toggleType = (t: POIType) => {
    setSelectedTypes(prev => prev.includes(t) ? prev.filter(item => item !== t) : [...prev, t]);
  };
  const [minAltitude, setMinAltitude] = useState(0);
  const [maxAltitude, setMaxAltitude] = useState(4810);
  const [selectedExposures, setSelectedExposures] = useState<Exposure[]>([]); 
  const [filterWater, setFilterWater] = useState(false);
  const [filterRoof, setFilterRoof] = useState(false);
  const [minCapacity, setMinCapacity] = useState(0);
  const [filterFireplace, setFilterFireplace] = useState(false);
  const [filterFee, setFilterFee] = useState(false); 
  const [filterOpen, setFilterOpen] = useState(false); 
  
  // --- [MODULAR OFFLINE SYNC] Persistenza automatica in IndexedDB per utilizzo in quota senza rete ---
  useEffect(() => {
    dbService.setOfflineItem('active_gpx_tracks_v1', tracks);
    tracks.forEach(t => seedElevationCacheFromPoints(t.points));
  }, [tracks]);

  useEffect(() => {
    if (Object.keys(gpxTrailAnalysis).length > 0) {
      dbService.setOfflineItem('gpx_trail_analysis_v1', gpxTrailAnalysis);
    }
  }, [gpxTrailAnalysis]);

  useEffect(() => {
    if (Object.keys(gpxWeatherWatch).length > 0) {
      dbService.setOfflineItem('gpx_weather_watch_v1', gpxWeatherWatch);
    }
  }, [gpxWeatherWatch]);

  useEffect(() => {
    dbService.setOfflineItem('tour_waypoints_v1', tourWaypoints);
  }, [tourWaypoints]);

  useEffect(() => {
    if (allPois.length > 0) {
      seedElevationCacheFromPois(allPois);
    }
  }, [allPois]);

  // Inspected arbitrary map point state
  const [inspectedLocation, setInspectedLocation] = useState<{
    lat: number;
    lng: number;
    altitude: number | null;
    isLoadingAltitude: boolean;
    weather: {
      temp: number;
      code: number;
      humidity: number;
      windSpeed?: number;
    } | null;
    isLoadingWeather: boolean;
  } | null>(null);
  const inspectedMarkerRef = useRef<L.Marker | null>(null);
  const handleSelectMapPointRef = useRef<(lat: number, lng: number) => void>(() => {});
  const longPressTimerRef = useRef<any>(null);
  const isLongPressTriggeredRef = useRef<boolean>(false);
  const touchStartPosRef = useRef<L.Point | null>(null);

  const mapRef = useRef<L.Map | null>(null);
  const mapContainerRef = useRef<HTMLDivElement>(null);
  const mapOuterWrapperRef = useRef<HTMLDivElement>(null);
  const appRootRef = useRef<HTMLDivElement>(null);
  const compassNeedleRef = useRef<HTMLDivElement>(null);
  const compassDegTextRef = useRef<HTMLSpanElement>(null);

  // Map Rotation State (0° = Nord in alto)
  const [mapBearing, setMapBearing] = useState<number>(0);
  const mapBearingRef = useRef<number>(0);
  const bearingRafRef = useRef<number | null>(null);

  // Aggiorna la rotazione direttamente sul DOM a 60fps evitando re-render React durante il gesto
  const applyMapBearingLive = useCallback((rawDeg: number, animateTransition = false, syncReactState = false) => {
    const normalized = ((rawDeg % 360) + 360) % 360;
    const prevNormalized = mapBearingRef.current;
    mapBearingRef.current = normalized;

    if (mapContainerRef.current) {
      mapContainerRef.current.style.transition = animateTransition
        ? 'transform 280ms cubic-bezier(0.22, 1, 0.36, 1)'
        : 'none';
      mapContainerRef.current.style.transform = `translate(-50%, -50%) rotate(${normalized.toFixed(2)}deg)`;
    }
    if (appRootRef.current) {
      appRootRef.current.style.setProperty('--map-counter-rotation', `${(-normalized).toFixed(2)}deg`);
    }
    if (compassNeedleRef.current) {
      compassNeedleRef.current.style.transition = animateTransition
        ? 'transform 280ms cubic-bezier(0.22, 1, 0.36, 1)'
        : 'none';
      compassNeedleRef.current.style.transform = `rotate(${normalized.toFixed(2)}deg)`;
    }
    if (compassDegTextRef.current) {
      compassDegTextRef.current.textContent = `${Math.round(normalized)}°`;
    }

    // Evita di invocare setMapBearing ad ogni frame (60fps): aggiorna lo stato React solo a fine gesto
    // oppure quando si attraversa la soglia di visibilità del pulsante bussola (0.5°)
    const wasVisible = Math.abs(prevNormalized % 360) > 0.5 && Math.abs(prevNormalized % 360) < 359.5;
    const isNowVisible = Math.abs(normalized % 360) > 0.5 && Math.abs(normalized % 360) < 359.5;
    if (syncReactState || animateTransition || wasVisible !== isNowVisible) {
      if (bearingRafRef.current !== null) {
        cancelAnimationFrame(bearingRafRef.current);
      }
      bearingRafRef.current = requestAnimationFrame(() => {
        setMapBearing(normalized);
        bearingRafRef.current = null;
      });
    }
  }, []);

  const resetMapNorth = useCallback(() => {
    applyMapBearingLive(0, true);
  }, [applyMapBearingLive]);

  const clearInspectedLocation = useCallback(() => {
    setInspectedLocation(null);
    if (inspectedMarkerRef.current && mapRef.current) {
      mapRef.current.removeLayer(inspectedMarkerRef.current);
      inspectedMarkerRef.current = null;
    }
  }, []);
  const markersRef = useRef<Map<string, L.Marker>>(new Map());
  const superclusterRef = useRef<Supercluster<{ poi: POI }> | null>(null);
  const updateMapClustersRef = useRef<() => void>(() => {});
  const userLocationMarkerRef = useRef<L.Marker | null>(null);
  const hoverMarkerRef = useRef<L.Marker | null>(null);
  const gpxLayerGroupRef = useRef<L.LayerGroup | null>(null);
  const rainLayerRef = useRef<L.TileLayer | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const layersMenuRef = useRef<HTMLDivElement>(null);
  const trailsMenuRef = useRef<HTMLDivElement>(null);
  const sidebarContentRef = useRef<HTMLDivElement>(null);
  const detailPanelRef = useRef<HTMLDivElement>(null);
  const debounceRef = useRef<any>(null);
  const fetchDebounceRef = useRef<any>(null);
  const isOfflineRef = useRef(isOffline);
  const selectedTypesRef = useRef(selectedTypes);
  const weatherAbortController = useRef<AbortController | null>(null);

  useEffect(() => { isOfflineRef.current = isOffline; }, [isOffline]);
  useEffect(() => { selectedTypesRef.current = selectedTypes; }, [selectedTypes]);
  useOnClickOutside(layersMenuRef, () => setIsLayersMenuOpen(false));
  useOnClickOutside(trailsMenuRef, () => setIsTrailsMenuOpen(false));
  useOnClickOutside(sidebarContentRef, () => setIsSidebarOpen(false));
  // Removed click outside for DetailPanel since it's full screen

  useEffect(() => {
    const handleOnline = () => setIsOffline(false);
    const handleOffline = () => setIsOffline(true);
    window.addEventListener('online', handleOnline);
    window.addEventListener('offline', handleOffline);
    return () => {
      window.removeEventListener('online', handleOnline);
      window.removeEventListener('offline', handleOffline);
    };
  }, []);

  useEffect(() => {
    if (selectedPoi) {
      setGeoAnalysis(null);
      setIsLoadingAnalysis(true);
      // Supporta sia modalità online che fallback cache/stima offline (analyzeLocationPhysics)
      analyzeLocationPhysics(selectedPoi.coordinates.lat, selectedPoi.coordinates.lng)
        .then(data => {
            setGeoAnalysis(data);
            setIsLoadingAnalysis(false);
        })
        .catch(() => setIsLoadingAnalysis(false));

      // Auto-risoluzione altitudine con modello DEM (online o interpolazione IDW offline) se non indicata
      if (!selectedPoi.altitude || selectedPoi.altitude === 0) {
        fetchAltitudeForCoordinate(selectedPoi.coordinates.lat, selectedPoi.coordinates.lng)
          .then(ele => {
            if (ele && ele > 0) {
              const updated = { ...selectedPoi, altitude: ele };
              setSelectedPoi(prev => prev?.id === updated.id ? updated : prev);
              setAllPois(prev => prev.map(p => p.id === updated.id ? updated : p));
              dbService.savePois([updated]);
            }
          })
          .catch(err => console.warn("Altitude auto-resolve error:", err));
      }
    } else {
      setGeoAnalysis(null);
    }
  }, [selectedPoi?.id, isOffline]);

  useEffect(() => {
      if (searchTimeoutRef.current) clearTimeout(searchTimeoutRef.current);

      if (searchQuery.trim().length < 2) {
          setSearchSuggestions([]);
          setShowSuggestions(false);
          return;
      }

      // Ricerca istantanea nel DB locale (funziona 100% offline su Bivacchi, Rifugi, Malghe, Cime salvati)
      const q = searchQuery.trim().toLowerCase();
      const localMatches = allPois
          .filter(p => p.name.toLowerCase().includes(q) || (p.description && p.description.toLowerCase().includes(q)))
          .sort((a, b) => {
              const aStarts = a.name.toLowerCase().startsWith(q) ? 0 : 1;
              const bStarts = b.name.toLowerCase().startsWith(q) ? 0 : 1;
              return aStarts - bStarts;
          })
          .slice(0, 8);

      if (isOffline) {
          setSearchSuggestions(localMatches);
          setShowSuggestions(localMatches.length > 0);
          return;
      }

      // Mostra subito i match locali e poi arricchisce con Nominatim/OSM se >= 3 caratteri
      if (localMatches.length > 0) {
          setSearchSuggestions(localMatches);
          setShowSuggestions(true);
      }

      if (searchQuery.trim().length < 3) return;

      searchTimeoutRef.current = setTimeout(async () => {
          const remoteResults = await searchOsmPoisByName(searchQuery, true);
          const mergedMap = new Map<string, POI>();
          localMatches.forEach(p => mergedMap.set(p.id, p));
          remoteResults.forEach(p => {
              if (!mergedMap.has(p.id)) mergedMap.set(p.id, p);
          });
          const combined = Array.from(mergedMap.values()).slice(0, 10);
          setSearchSuggestions(combined);
          setShowSuggestions(combined.length > 0);
      }, 300); 
  }, [searchQuery, isOffline, allPois]);

  const ensureMarkerVisible = (poi: POI, map: L.Map, isRemote: boolean = false) => {
      const targetLatLng = L.latLng(poi.coordinates.lat, poi.coordinates.lng);
      const mapSize = map.getSize();
      if (!mapSize || mapSize.x === 0 || mapSize.y === 0) return;
      
      // Dimensioni reali della card popup espansa (larghezza max 195px, altezza ~180px con padding e freccia)
      const cardWidth = Math.min(195, window.innerWidth - 32);
      const cardHeight = 180;

      // Il container mappa è un quadrato 146vmax centrato sul viewport: calcola l'inset del viewport reale
      const vw = mapOuterWrapperRef.current?.clientWidth || window.innerWidth;
      const vh = mapOuterWrapperRef.current?.clientHeight || window.innerHeight;
      const insetX = Math.max(0, Math.round((mapSize.x - vw) / 2));
      const insetY = Math.max(0, Math.round((mapSize.y - vh) / 2));
      
      // Margini di sicurezza rigorosi e dinamici in base ai pannelli attivi:
      const safeTop = insetY + 135;
      const safeBottom = insetY + (weatherOverlayActive ? 155 : (isTrackPanelOpen ? Math.round(vh * 0.42) : 85));
      const safeLeft = insetX + 24;
      const safeRight = insetX + 80;

      const computeAndPan = (pt: L.Point) => {
          let dx = 0;
          let dy = 0;

          const cardTop = pt.y - cardHeight;
          const cardBottom = pt.y;
          const cardLeft = pt.x - (cardWidth / 2);
          const cardRight = pt.x + (cardWidth / 2);

          if (cardTop < safeTop) {
              dy = cardTop - safeTop;
          } else if (cardBottom > (mapSize.y - safeBottom)) {
              dy = cardBottom - (mapSize.y - safeBottom);
          }

          if (cardLeft < safeLeft) {
              dx = cardLeft - safeLeft;
          } else if (cardRight > (mapSize.x - safeRight)) {
              dx = cardRight - (mapSize.x - safeRight);
          }

          if (Math.abs(dx) > 3 || Math.abs(dy) > 3) {
              map.panBy([dx, dy], { animate: true, duration: 0.35 });
          }
      };

      if (isRemote || !map.getBounds().contains(targetLatLng)) {
          // Vola al punto target e, non appena concluso il volo, riallinea con l'offset sicuro
          map.flyTo(targetLatLng, Math.max(map.getZoom(), 14), { duration: 1.2 });
          setTimeout(() => {
              if (!mapRef.current) return;
              const pt = mapRef.current.latLngToContainerPoint(targetLatLng);
              computeAndPan(pt);
          }, 1250);
      } else {
          const point = map.latLngToContainerPoint(targetLatLng);
          computeAndPan(point);
      }
  };

  const handleSuggestionClick = async (poi: POI) => {
      setShowSuggestions(false);
      setSearchQuery(poi.name); 
      
      setAllPois(prev => {
          const existingIds = new Set(prev.map(p => p.id));
          if (!existingIds.has(poi.id)) {
              return [...prev, poi];
          }
          return prev;
      });
      
      clearInspectedLocation();
      setSelectedPoi(poi);
      setIsDetailPanelOpen(false); 
      
      if (viewMode === 'list') {
          setHighlightedPoiId(poi.id);
          setTimeout(() => {
              const element = document.getElementById(`poi-card-${poi.id}`);
              if (element) {
                  element.scrollIntoView({ behavior: 'smooth', block: 'center' });
              }
          }, 100);
      } else {
          if (mapRef.current) {
              ensureMarkerVisible(poi, mapRef.current, true);
          }
      }

      if (poi.altitude === 0) {
          try {
             const enriched = await enrichPoisWithAltitude([poi]);
             if (enriched.length > 0) {
                 const fullPoi = enriched[0];
                 setAllPois(prev => prev.map(p => p.id === fullPoi.id ? fullPoi : p));
                 setSelectedPoi(prev => prev && prev.id === fullPoi.id ? fullPoi : prev);
                 dbService.savePois([fullPoi]);
             }
          } catch(e) { console.error("Enrichment failed", e); }
      }
  };

  // --- [LOCKED FEATURE] MAP LAYERS & GPX ---
  // DO NOT MODIFY TRACK RENDERING LOGIC WITHOUT PERMISSION
  useEffect(() => {
     if (!mapRef.current || !isMapReady) return; 
     if (!gpxLayerGroupRef.current) {
        gpxLayerGroupRef.current = L.layerGroup().addTo(mapRef.current);
     }
     gpxLayerGroupRef.current.clearLayers();

     if (tracks.length > 0) {
        tracks.forEach(track => {
            if (!gpxLayerGroupRef.current) return;
            const polyline = L.polyline(track.latlngs, { color: track.color, weight: 4, opacity: 0.9, lineJoin: 'round', lineCap: 'round' });
            polyline.on('click', (e) => { 
                L.DomEvent.stopPropagation(e); 
                setFocusedTrackId(track.id);
                setIsTrackPanelOpen(true); 
                setIsTrackPanelExpanded(false); 
                setIsDetailPanelOpen(false); 
                centerOnTrack(track, true);
            });
            polyline.addTo(gpxLayerGroupRef.current);
            const startPoint = track.latlngs[0];
            const startIcon = L.divIcon({ className: '', html: `<div class="w-8 h-8 rounded-full border-2 border-white shadow-lg flex items-center justify-center transform -translate-x-1/2 -translate-y-1/2" style="background-color: ${track.color}"><svg width="16" height="16" viewBox="0 0 24 24" fill="white" stroke="white" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polygon points="5 3 19 12 5 21 5 3"/></svg></div>`, iconSize: [0, 0] });
            L.marker(startPoint, { icon: startIcon, interactive: false }).addTo(gpxLayerGroupRef.current);

            const endPoint = track.latlngs[track.latlngs.length - 1];
            const endIcon = L.divIcon({ className: '', html: `<div class="w-8 h-8 bg-red-600 rounded-full border-2 border-white shadow-lg flex items-center justify-center transform -translate-x-1/2 -translate-y-1/2"><svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="white" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M4 15s1-1 4-1 5 2 8 2 4-1 4-1V3s-1 1-4 1-5-2-8-2-4 1-4 1z"/><line x1="4" x2="4" y1="22" y2="15"/></svg></div>`, iconSize: [0, 0] });
            L.marker(endPoint, { icon: endIcon, interactive: false }).addTo(gpxLayerGroupRef.current);

            let distAccumulator = 0;
            let nextMilestone = 1.0; 
            const totalEstimatedDist = track.stats.totalDistance;
            const forceMiddleArrow = totalEstimatedDist < 1.5;

            for (let i = 0; i < track.latlngs.length - 1; i++) {
                const p1 = track.latlngs[i];
                const p2 = track.latlngs[i + 1];
                const d = getDistance(p1[0], p1[1], p2[0], p2[1]);
                distAccumulator += d;
                const isMilestone = distAccumulator >= nextMilestone;
                const isMiddle = forceMiddleArrow && i === Math.floor(track.latlngs.length / 2);

                if (isMilestone || isMiddle) {
                    const lat1 = p1[0], lon1 = p1[1];
                    const lat2 = p2[0], lon2 = p2[1];
                    const dLon = (lon2 - lon1) * Math.PI / 180;
                    const lat1Rad = lat1 * Math.PI / 180;
                    const lat2Rad = lat2 * Math.PI / 180;
                    const y = Math.sin(dLon) * Math.cos(lat2Rad);
                    const x = Math.cos(lat1Rad) * Math.sin(lat2Rad) - Math.sin(lat1Rad) * Math.cos(lat2Rad) * Math.cos(dLon);
                    const bearing = (Math.atan2(y, x) * 180 / Math.PI + 360) % 360;

                    const arrowIcon = L.divIcon({ className: '', html: `<div style="transform: rotate(${bearing}deg);" class="w-6 h-6 flex items-center justify-center"><svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="black" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"><path d="m18 15-6-6-6 6"/></svg></div>`, iconSize: [24, 24], iconAnchor: [12, 12] });
                    L.marker(p1, { icon: arrowIcon, interactive: false }).addTo(gpxLayerGroupRef.current);
                    if (isMilestone) nextMilestone += 1.0;
                }
            }
        });
     }
  }, [tracks, viewMode, isMapReady]);

  useEffect(() => {
      if (!mapRef.current || !isMapReady) return;
      if (hoveredTrackPoint) {
          if (!hoverMarkerRef.current) {
              const icon = L.divIcon({ className: 'hover-marker', html: `<div class="w-4 h-4 bg-blue-500 border-2 border-white rounded-full shadow-lg pulse-animation"></div>`, iconSize: [16, 16], iconAnchor: [8, 8] });
              hoverMarkerRef.current = L.marker([hoveredTrackPoint.lat, hoveredTrackPoint.lng], { icon, zIndexOffset: 2000, interactive: false }).addTo(mapRef.current);
          } else {
              hoverMarkerRef.current.setLatLng([hoveredTrackPoint.lat, hoveredTrackPoint.lng]);
          }
      } else {
          if (hoverMarkerRef.current) {
              mapRef.current.removeLayer(hoverMarkerRef.current);
              hoverMarkerRef.current = null;
          }
      }
  }, [hoveredTrackPoint, isMapReady]);

  // --- [MODULAR FEATURE 4] TARGET LOCK MAP BEARING LINE RENDERING ---
  const updateTargetLockLine = useCallback(() => {
    if (!mapRef.current || !isMapReady) return;
    if (!targetLockLayerGroupRef.current) {
      targetLockLayerGroupRef.current = L.layerGroup().addTo(mapRef.current);
    }
    targetLockLayerGroupRef.current.clearLayers();

    if (!targetLock) return;

    const origin = userLocation || mapRef.current.getCenter();
    const targetLatLng: [number, number] = [targetLock.lat, targetLock.lng];
    const originLatLng: [number, number] = [origin.lat, origin.lng];

    // Linea tattica tratteggiata dal punto utente/centro al Target bloccato
    L.polyline([originLatLng, targetLatLng], {
      color: '#06b6d4',
      weight: 2.5,
      opacity: 0.9,
      dashArray: '8, 8',
      lineCap: 'round',
    }).addTo(targetLockLayerGroupRef.current);

    // Anello luminoso sul Target bloccato
    const ringIcon = L.divIcon({
      className: 'target-lock-ring',
      html: `
        <div class="relative flex items-center justify-center -translate-x-1/2 -translate-y-1/2 pointer-events-none">
          <span class="absolute w-11 h-11 rounded-full border-2 border-cyan-400/60 animate-ping"></span>
          <span class="w-8 h-8 rounded-full border-2 border-cyan-400 bg-cyan-500/10 shadow-[0_0_15px_rgba(6,182,212,0.6)]"></span>
        </div>
      `,
      iconSize: [0, 0],
      iconAnchor: [0, 0],
    });
    L.marker(targetLatLng, { icon: ringIcon, interactive: false, zIndexOffset: 9000 }).addTo(
      targetLockLayerGroupRef.current
    );
  }, [targetLock, userLocation, isMapReady]);

  useEffect(() => {
    updateTargetLockLine();
  }, [updateTargetLockLine, viewMode]);

  // --- [MODULAR FEATURE 1.3] CALCOLO AUTOMATICO PERCORSO MULTI-TAPPA & RENDERING MAPPA ---
  useEffect(() => {
    if (tourWaypoints.length < 2) {
      setComputedTourRoute(null);
      setIsComputingTour(false);
      return;
    }

    let cancelled = false;
    setIsComputingTour(true);

    computeHikingTourRoute(tourWaypoints, tourLoopBack)
      .then(res => {
        if (cancelled) return;
        setComputedTourRoute(res);
      })
      .catch(err => {
        console.warn("Tour routing error:", err);
      })
      .finally(() => {
        if (!cancelled) setIsComputingTour(false);
      });

    return () => {
      cancelled = true;
    };
  }, [tourWaypoints, tourLoopBack]);

  const updateTourPlannerLayer = useCallback(() => {
    if (!mapRef.current || !isMapReady) return;
    if (!tourPlannerLayerGroupRef.current) {
      tourPlannerLayerGroupRef.current = L.layerGroup().addTo(mapRef.current);
    }
    tourPlannerLayerGroupRef.current.clearLayers();

    if (tourWaypoints.length === 0) return;

    // 1. Disegna la polilinea del percorso calcolato sui sentieri
    if (computedTourRoute && computedTourRoute.latlngs.length >= 2) {
      // Bordo esterno ad alto contrasto lungo il sentiero
      L.polyline(computedTourRoute.latlngs, {
        color: '#052e16',
        weight: 7.5,
        opacity: 0.85,
        lineJoin: 'round',
        lineCap: 'round',
      }).addTo(tourPlannerLayerGroupRef.current);

      // Tracciato principale verde smeraldo continuo lungo le curve del sentiero
      const mainPoly = L.polyline(computedTourRoute.latlngs, {
        color: '#10b981',
        weight: 4.5,
        opacity: 0.98,
        dashArray: computedTourRoute.routingSource === 'direct_trail' ? '8, 6' : undefined,
        lineJoin: 'round',
        lineCap: 'round',
      });
      mainPoly.on('click', (e) => {
        L.DomEvent.stopPropagation(e);
        setIsTourPlannerOpen(true);
      });
      mainPoly.addTo(tourPlannerLayerGroupRef.current);
    } else if (tourWaypoints.length >= 2 && isComputingTour) {
      // Linea provvisoria leggera solo durante il calcolo del percorso
      const directLatLngs: [number, number][] = tourWaypoints.map(w => [w.lat, w.lng]);
      if (tourLoopBack) directLatLngs.push([tourWaypoints[0].lat, tourWaypoints[0].lng]);
      L.polyline(directLatLngs, {
        color: '#10b981',
        weight: 2.5,
        opacity: 0.45,
        dashArray: '4, 8',
      }).addTo(tourPlannerLayerGroupRef.current);
    }

    // 2. Disegna i marker numerati per ciascuna tappa (1, 2, 3...)
    tourWaypoints.forEach((wp, idx) => {
      if (!tourPlannerLayerGroupRef.current) return;
      const isStart = idx === 0;
      const isEnd = idx === tourWaypoints.length - 1 && tourWaypoints.length > 1 && !tourLoopBack;
      const badgeBg = isStart
        ? 'bg-emerald-600 border-white text-white'
        : isEnd
        ? 'bg-orange-600 border-white text-white'
        : 'bg-zinc-900 border-emerald-400 text-emerald-300';

      const wpIcon = L.divIcon({
        className: 'tour-waypoint-marker',
        html: `
          <div class="relative flex flex-col items-center justify-center -translate-x-1/2 -translate-y-1/2 pointer-events-auto cursor-pointer group">
            <div class="w-7 h-7 rounded-full border-2 shadow-xl flex items-center justify-center font-mono text-xs font-black ${badgeBg} transition-transform group-hover:scale-110">
              ${idx + 1}
            </div>
            <div class="mt-0.5 px-1.5 py-0.2 rounded bg-zinc-950/90 border border-zinc-700 text-[9px] font-bold text-white whitespace-nowrap shadow-md max-w-[110px] truncate">
              ${wp.name}
            </div>
          </div>
        `,
        iconSize: [0, 0],
        iconAnchor: [0, 0],
      });

      const marker = L.marker([wp.lat, wp.lng], {
        icon: wpIcon,
        zIndexOffset: 12000 + idx * 10,
      });
      marker.on('click', (e) => {
        L.DomEvent.stopPropagation(e);
        setIsTourPlannerOpen(true);
      });
      marker.addTo(tourPlannerLayerGroupRef.current);
    });
  }, [tourWaypoints, computedTourRoute, tourLoopBack, isMapReady]);

  useEffect(() => {
    updateTourPlannerLayer();
  }, [updateTourPlannerLayer, viewMode]);

  // Promuove il Tour pianificato in una traccia GPX attiva completa (con Profilo 1.1, Analisi Fondo/SAC 1.2 e Meteo Orario)
  const promoteTourToActiveTrack = useCallback(() => {
    if (!computedTourRoute || tourWaypoints.length < 2) {
      showToast("Aggiungi almeno 2 tappe per generare la traccia completa.");
      return;
    }

    const firstWp = tourWaypoints[0];
    const lastWp = tourLoopBack ? tourWaypoints[0] : tourWaypoints[tourWaypoints.length - 1];
    const tourName =
      tourLoopBack
        ? `Anello: ${firstWp.name} (${tourWaypoints.length} tappe)`
        : `Tour: ${firstWp.name} → ${lastWp.name}`;

    const newTrack: LoadedTrack = {
      id: `tour-${Date.now()}`,
      name: tourName,
      latlngs: computedTourRoute.latlngs,
      points: computedTourRoute.points,
      stats: computedTourRoute.stats,
      color: TRACK_COLORS[tracks.length % TRACK_COLORS.length],
    };

    setTracks(prev => {
      // Se ci sono già 2 tracce, sostituisce l'ultima per non bloccare l'utente
      const base = prev.length >= 2 ? [prev[0]] : prev;
      return [...base, newTrack];
    });
    setFocusedTrackId(newTrack.id);
    setFilterByTrack(true);
    setIsTrackPanelOpen(true);
    setIsTrackPanelExpanded(false);
    setIsTourPlannerOpen(false);
    setIsDetailPanelOpen(false);
    centerOnTrack(newTrack, true);
    showToast("Tour caricato nel Profilo Altimetrico e Analisi Percorso!");
  }, [computedTourRoute, tourWaypoints, tourLoopBack, tracks.length]);

  // Esporta il Tour pianificato (Tappe + Tracciato completo sui sentieri con quote DEM) in un file .GPX standard
  const exportPlannedTourToGpx = useCallback(() => {
    if (!computedTourRoute || tourWaypoints.length < 2) {
      showToast("Aggiungi almeno 2 tappe per esportare il Tour in .GPX");
      return;
    }

    const escapeXml = (str: string) =>
      str
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&apos;');

    const wptsXml = tourWaypoints
      .map(
        (w, i) => `  <wpt lat="${w.lat.toFixed(6)}" lon="${w.lng.toFixed(6)}">
    <ele>${w.altitude || 0}</ele>
    <name>${escapeXml(`${i + 1}. ${w.name}`)}</name>
    <type>${escapeXml(w.category || 'Tappa Tour')}</type>
  </wpt>`
      )
      .join('\n');

    const trkptsXml = computedTourRoute.points
      .map(
        pt => `      <trkpt lat="${pt.lat.toFixed(6)}" lon="${pt.lng.toFixed(6)}">
        <ele>${Math.round(pt.ele)}</ele>
      </trkpt>`
      )
      .join('\n');

    const firstWp = tourWaypoints[0];
    const lastWp = tourLoopBack ? tourWaypoints[0] : tourWaypoints[tourWaypoints.length - 1];
    const tourTitle = `MountPro Tour: ${firstWp.name} - ${lastWp.name}`;

    const gpxContent = `<?xml version="1.0" encoding="UTF-8"?>
<gpx version="1.1" creator="MountPro Explorer - Tour Planner" xmlns="http://www.topografix.com/GPX/1/1">
  <metadata>
    <name>${escapeXml(tourTitle)}</name>
    <time>${new Date().toISOString()}</time>
  </metadata>
${wptsXml}
  <trk>
    <name>${escapeXml(tourTitle)}</name>
    <trkseg>
${trkptsXml}
    </trkseg>
  </trk>
</gpx>`;

    const blob = new Blob([gpxContent], { type: 'application/gpx+xml;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    const dateStr = new Date().toISOString().slice(0, 10);
    a.href = url;
    a.download = `mountpro_tour_${dateStr}.gpx`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
    showToast("File .GPX del Tour scaricato con successo!");
  }, [computedTourRoute, tourWaypoints, tourLoopBack]);

  const downloadMapArea = async () => {
    if (!mapRef.current || isOffline) return;
    setIsDownloading(true);
    setDownloadProgress('fetching');
    setDownloadCount(0);
    const b = mapRef.current.getBounds();
    const boundsObj = { south: b.getSouth(), west: b.getWest(), north: b.getNorth(), east: b.getEast() };
    try {
      // 1. Scarica tutti i POI dell'area visibile + arricchimento DEM
      const newPois = await fetchOsmPois(boundsObj, 'All');
      setDownloadCount(newPois.length);
      setDownloadProgress('saving');
      await dbService.savePois(newPois);
      seedElevationCacheFromPois(newPois);
      setAllPois(prev => {
        const ids = new Set(prev.map(p => p.id));
        return [...prev, ...newPois.filter(p => !ids.has(p.id))];
      });

      // 2. Scarica e salva in IndexedDB il grafo sentieri CAI/OSM e vette per Routing (1.3) e Analisi GPX (1.2) Offline
      preloadOfflineAreaTrailNetwork(boundsObj).catch(() => {});

      // 3. Pre-caching dei tasselli mappa (Tile) per l'area visibile nel Service Worker
      try {
        const currentZoom = Math.round(mapRef.current.getZoom());
        const targetZooms = Array.from(new Set([Math.max(10, currentZoom), Math.min(16, currentZoom + 1)]));
        const lat2tile = (lat: number, z: number) => Math.floor((1 - Math.log(Math.tan(lat * Math.PI / 180) + 1 / Math.cos(lat * Math.PI / 180)) / Math.PI) / 2 * Math.pow(2, z));
        const lon2tile = (lon: number, z: number) => Math.floor((lon + 180) / 360 * Math.pow(2, z));
        const tileUrls: string[] = [];

        for (const z of targetZooms) {
          const xMin = lon2tile(boundsObj.west, z);
          const xMax = lon2tile(boundsObj.east, z);
          const yMin = lat2tile(boundsObj.north, z);
          const yMax = lat2tile(boundsObj.south, z);
          for (let x = xMin; x <= xMax; x++) {
            for (let y = yMin; y <= yMax; y++) {
              if (tileUrls.length >= 90) break; // Limite di sicurezza per non saturare la banda
              if (mapStyle === 'standard') {
                tileUrls.push(`https://a.tile.openstreetmap.org/${z}/${x}/${y}.png`);
              } else {
                tileUrls.push(`https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/${z}/${y}/${x}`);
                if (mapStyle === 'hybrid') {
                  tileUrls.push(`https://tile.waymarkedtrails.org/hiking/${z}/${x}/${y}.png`);
                }
              }
            }
          }
        }
        // Esegue i fetch in background così il Service Worker li intercetta e li salva in TILE_CACHE_NAME
        Promise.allSettled(tileUrls.map(u => fetch(u, { mode: 'no-cors' }))).catch(() => {});
      } catch (tileErr) {
        console.warn("Tile pre-cache warning:", tileErr);
      }

      // 4. Salva anche l'analisi meteo del centro area per consultazione offline
      const center = mapRef.current.getCenter();
      analyzeLocationPhysics(center.lat, center.lng).catch(() => {});

      setDownloadProgress('done');
      setTimeout(() => {
        setIsDownloading(false);
        setDownloadProgress('idle');
        setIsLayersMenuOpen(false);
        showToast(`Area Offline pronta: ${newPois.length} POI, Sentieri e Mappa salvati`);
      }, 1800);
    } catch (e) {
      console.error("Download failed", e);
      setIsDownloading(false);
      setDownloadProgress('idle');
      showToast("Errore durante il download dell'area.");
    }
  };
  
  // --- [LOCKED FEATURE] GLOBAL SEARCH ---
  // DO NOT MODIFY SEARCH LOGIC WITHOUT PERMISSION
  const handleGlobalSearch = async (e: React.FormEvent) => { 
      e.preventDefault(); 
      const query = searchQuery.trim().toLowerCase(); 
      if (!query) return; 
      setShowSuggestions(false);
      
      if (isOffline) { 
          const localResults = allPois.filter(p => p.name.toLowerCase().includes(query) || (p.description && p.description.toLowerCase().includes(query))); 
          if (localResults.length > 0) { 
              const target = localResults[0];
              clearInspectedLocation();
              setSelectedPoi(target); 
              setIsDetailPanelOpen(false); 
              
              if (viewMode === 'list') {
                  setHighlightedPoiId(target.id);
                  setTimeout(() => {
                      const element = document.getElementById(`poi-card-${target.id}`);
                      if (element) element.scrollIntoView({ behavior: 'smooth', block: 'center' });
                  }, 100);
              } else if (mapRef.current) {
                  ensureMarkerVisible(target, mapRef.current, true); 
              }
          } else { 
              showToast("Nessun risultato offline trovato."); 
          } 
          return; 
      } 
      
      setIsGlobalSearching(true); 
      const results = await searchOsmPoisByName(searchQuery); 
      setIsGlobalSearching(false); 
      
      if (results.length > 0) { 
          const target = results[0]; 
          setAllPois(prev => { 
              const existingIds = new Set(prev.map(p => p.id)); 
              const combined = [...prev, ...results.filter(p => !existingIds.has(p.id))]; 
              saveToDb(combined); 
              return combined; 
          }); 
          clearInspectedLocation();
          setSelectedPoi(target); 
          setIsDetailPanelOpen(false); 
          
          if (viewMode === 'list') {
              setHighlightedPoiId(target.id);
              setTimeout(() => {
                  const element = document.getElementById(`poi-card-${target.id}`);
                  if (element) element.scrollIntoView({ behavior: 'smooth', block: 'center' });
              }, 100);
          } else if (mapRef.current) {
              ensureMarkerVisible(target, mapRef.current, true); 
          }
      } else { 
          showToast("Nessun risultato trovato."); 
      } 
  };
  
  // --- [LOCKED FEATURE] GPX PARSER ---
  // DO NOT MODIFY WITHOUT PERMISSION
  const handleGpxUpload = (event: React.ChangeEvent<HTMLInputElement>) => { const file = event.target.files?.[0]; if (!file) return; if (tracks.length >= 2) { showToast("Massimo 2 tracce contemporaneamente."); event.target.value = ''; return; } const reader = new FileReader(); reader.onload = (e) => { try { const text = e.target?.result as string; const parser = new DOMParser(); const xmlDoc = parser.parseFromString(text, "text/xml"); const trkpts = xmlDoc.getElementsByTagName("trkpt"); if (trkpts.length === 0) { showToast("Nessuna traccia valida trovata."); return; } const points: TrackPoint[] = []; const latlngs: [number, number][] = []; let totalDist = 0, gain = 0, loss = 0, minEle = Infinity, maxEle = -Infinity, minEleIdx = 0, maxEleIdx = 0; let maxGrade = 0; let gradeAccumulator = 0; let totalTime = 0; let hasTime = false; let sumHr = 0, maxHr = 0, hrCount = 0; let sumTemp = 0, tempCount = 0; let ascentTimeSeconds = 0; for (let i = 0; i < trkpts.length; i++) { const lat = parseFloat(trkpts[i].getAttribute("lat") || "0"); const lng = parseFloat(trkpts[i].getAttribute("lon") || "0"); const eleNode = trkpts[i].getElementsByTagName("ele")[0]; const ele = eleNode ? parseFloat((eleNode.textContent || "0").replace(',', '.')) : 0; const timeNode = trkpts[i].getElementsByTagName("time")[0]; let timeTs = undefined; if (timeNode) { hasTime = true; timeTs = new Date(timeNode.textContent || "").getTime(); } let hr = undefined, temp = undefined, cadence = undefined; const extensions = trkpts[i].getElementsByTagName("extensions")[0]; if (extensions) { const hrNode = extensions.querySelector("hr, heartrate, *[nodeName='gpxtpx:hr'], *[nodeName='gpxtpx:heartrate']"); if (hrNode && hrNode.textContent) { hr = parseFloat(hrNode.textContent); sumHr += hr; if (hr > maxHr) maxHr = hr; hrCount++; } const tempNode = extensions.querySelector("atemp, temp, temperature, *[nodeName='gpxtpx:atemp'], *[nodeName='gpxtpx:temp']"); if (tempNode && tempNode.textContent) { temp = parseFloat(tempNode.textContent); sumTemp += temp; tempCount++; } const cadNode = extensions.querySelector("cad, cadence, *[nodeName='gpxtpx:cad'], *[nodeName='gpxtpx:cadence']"); if (cadNode && cadNode.textContent) { cadence = parseFloat(cadNode.textContent); } } latlngs.push([lat, lng]); let distStep = 0; if (i > 0) { const prev = points[i-1]; distStep = getDistance(prev.lat, prev.lng, lat, lng); totalDist += distStep; const eleDiff = ele - prev.ele; if (eleDiff > 0) { gain += eleDiff; if (hasTime && timeTs && prev.time) { const dt = (timeTs - prev.time) / 1000; if (dt > 0 && dt < 120) { ascentTimeSeconds += dt; } } } else { loss += Math.abs(eleDiff); } if (distStep > 0.01) { const grade = Math.abs((eleDiff / (distStep * 1000)) * 100); if (grade < 100) { if (grade > maxGrade) maxGrade = grade; gradeAccumulator += grade; } } if (hasTime && timeTs && prev.time) { totalTime += (timeTs - prev.time) / 1000; } } if (ele < minEle) { minEle = ele; minEleIdx = i; } if (ele > maxEle) { maxEle = ele; maxEleIdx = i; } points.push({ lat, lng, ele, dist: totalDist, time: timeTs, hr, temp, cadence }); } const wpts = xmlDoc.getElementsByTagName("wpt"); for (let w = 0; w < wpts.length; w++) { const wLat = parseFloat(wpts[w].getAttribute("lat") || "0"); const wLng = parseFloat(wpts[w].getAttribute("lon") || "0"); const wEleNode = wpts[w].getElementsByTagName("ele")[0]; const wEle = wEleNode ? parseFloat((wEleNode.textContent || "0").replace(',', '.')) : 0; if (wEle > maxEle && points.length > 0) { let cIdx = -1; let cDist = 0.15; for (let pIdx = 0; pIdx < points.length; pIdx++) { const d = getDistance(wLat, wLng, points[pIdx].lat, points[pIdx].lng); if (d < cDist) { cDist = d; cIdx = pIdx; } } if (cIdx !== -1) { points[cIdx].ele = wEle; maxEle = wEle; maxEleIdx = cIdx; } } } const step = Math.ceil(points.length / 400); const simplifiedPoints = points.filter((_, i) => i === 0 || i === points.length - 1 || i === maxEleIdx || i === minEleIdx || i % step === 0); let estimatedTime = 0; let isEstimated = false; if (!hasTime || totalTime === 0) { isEstimated = true; estimatedTime = (totalDist / 4) * 3600 + (gain / 600) * 3600; totalTime = estimatedTime; ascentTimeSeconds = (gain / 600) * 3600; } const avgSpeed = totalTime > 0 ? (totalDist / (totalTime / 3600)) : 0; const avgGrade = points.length > 1 ? gradeAccumulator / points.length : 0; let vam = 0; if (ascentTimeSeconds > 600 && gain > 50) { vam = (gain / (ascentTimeSeconds / 3600)); } const newTrack: LoadedTrack = { id: crypto.randomUUID(), name: file.name.replace(/\.gpx$/i, ''), latlngs: latlngs, points: simplifiedPoints, stats: { totalDistance: totalDist, elevationGain: gain, elevationLoss: loss, minElevation: minEle === Infinity ? 0 : minEle, maxElevation: maxEle === -Infinity ? 0 : maxEle, totalTimeSeconds: totalTime, avgSpeedKmh: avgSpeed, maxGrade: maxGrade, avgGrade: avgGrade, isEstimatedTime: isEstimated, vam: vam > 0 ? Math.round(vam) : undefined, avgHr: hrCount > 0 ? Math.round(sumHr / hrCount) : undefined, maxHr: maxHr > 0 ? Math.round(maxHr) : undefined, avgTemp: tempCount > 0 ? Math.round(sumTemp / tempCount) : undefined }, color: TRACK_COLORS[tracks.length] }; setTracks(prev => [...prev, newTrack]); setFocusedTrackId(newTrack.id); setFilterByTrack(true); setIsTrackPanelOpen(true); setIsTrackPanelExpanded(false); setIsTrailsMenuOpen(false); setIsSidebarOpen(false); setIsDetailPanelOpen(false); centerOnTrack(newTrack, true); } catch (err) { console.error("GPX Parse Error", err); showToast("Errore nel caricamento del file GPX."); } }; reader.readAsText(file); event.target.value = ''; };
  const removeTrack = (id: string) => { setTracks(prev => { const newTracks = prev.filter(t => t.id !== id); if (newTracks.length === 0) setFilterByTrack(false); return newTracks.map((t, idx) => ({...t, color: TRACK_COLORS[idx]})); }); if (focusedTrackId === id) setFocusedTrackId(null); setHoveredTrackIndex(null); };
  const centerOnTrack = (track: LoadedTrack, withOffset = false) => {
    if (!mapRef.current) return;
    const poly = L.polyline(track.latlngs);
    const cw = mapRef.current.getContainer().clientWidth;
    const ch = mapRef.current.getContainer().clientHeight;
    const vw = mapOuterWrapperRef.current?.clientWidth || window.innerWidth;
    const vh = mapOuterWrapperRef.current?.clientHeight || window.innerHeight;
    const insetX = Math.max(0, Math.round((cw - vw) / 2));
    const insetY = Math.max(0, Math.round((ch - vh) / 2));
    const options: L.FitBoundsOptions = {
      paddingTopLeft: [insetX + 50, insetY + 50],
      paddingBottomRight: [insetX + 50, insetY + 50 + (withOffset ? Math.round(vh * 0.36) : 0)],
    };
    mapRef.current.fitBounds(poly.getBounds(), options);
  };
  const filteredPois = useMemo(() => { 
    return allPois.filter(p => { 
      if (showFavoritesOnly && !favorites.has(p.id)) return false; 
      if (filterByTrack && tracks.length > 0) { 
        const isNearAny = tracks.some(t => isPointNearPolyline(p.coordinates, t.latlngs, trackBuffer)); 
        if (!isNearAny) return false; 
      } 
      // Se nessun tipo è selezionato, nessun punto corrisponde ("come nessuno")
      const t = selectedTypes.includes(p.type); 
      const a = p.altitude >= minAltitude && p.altitude <= maxAltitude; 
      const e = selectedExposures.length === 0 || selectedExposures.includes(p.exposure); 
      const w = !filterWater || p.hasWater; 
      const r = !filterRoof || p.hasRoof; 
      const cap = minCapacity === 0 || (p.capacity !== undefined && p.capacity >= minCapacity); 
      const fp = !filterFireplace || p.hasFireplace; 
      const fee = !filterFee || (!p.fee); 
      const op = !filterOpen || (p.access === 'yes' || p.access === 'public' || p.access === 'permissive' || !p.access); 
      return t && a && e && w && r && cap && fp && fee && op; 
    }); 
  }, [allPois, selectedTypes, minAltitude, maxAltitude, selectedExposures, filterWater, filterRoof, showFavoritesOnly, favorites, minCapacity, filterFireplace, filterFee, filterOpen, filterByTrack, tracks, trackBuffer]);

  const executeFetch = async () => { 
    if (!mapRef.current || isOfflineRef.current) return; 
    if (selectedTypesRef.current.length === 0) return;
    setIsSearchingArea(true); 
    const b = mapRef.current.getBounds(); 
    try { 
      const newPois = await fetchOsmPois({ south: b.getSouth(), west: b.getWest(), north: b.getNorth(), east: b.getEast() }, selectedTypesRef.current); 
      if (newPois.length > 0) {
        setAllPois(prev => { 
          const ids = new Set(prev.map(p => p.id)); 
          const added = newPois.filter(p => !ids.has(p.id));
          if (added.length === 0) return prev; // Evita re-render e ricalcolo Supercluster se non ci sono nuovi POI
          const merged = [...prev, ...added]; 
          saveToDb(merged); 
          return merged; 
        }); 
      }
    } finally { 
      setIsSearchingArea(false); 
    } 
  };
  const updateCenterWeather = async () => { if (!mapRef.current || isOfflineRef.current) return; if (weatherAbortController.current) { weatherAbortController.current.abort(); } const controller = new AbortController(); weatherAbortController.current = controller; const center = mapRef.current.getCenter(); try { const res = await fetch( `https://api.open-meteo.com/v1/forecast?latitude=${center.lat.toFixed(4)}&longitude=${center.lng.toFixed(4)}&current=temperature_2m,relative_humidity_2m,weather_code`, { signal: controller.signal } ); if (!res.ok) { return; } const data = await res.json(); if (data.current) { const cw = { temp: data.current.temperature_2m, code: data.current.weather_code, humidity: data.current.relative_humidity_2m }; setCenterWeather(cw); try { localStorage.setItem('mountpro_center_weather_v1', JSON.stringify(cw)); } catch {} } } catch (e: any) { if (e.name === 'AbortError') return; } finally { if (weatherAbortController.current === controller) { weatherAbortController.current = null; } } };
  
  const handleOpenWeatherPanel = async (overrideCoords?: { lat: number; lng: number }) => { 
    setIsWeatherPanelOpen(true); 
    const targetCoords = overrideCoords || (mapRef.current ? mapRef.current.getCenter() : { lat: 46.2, lng: 11.4 }); 
    setIsLoadingAreaWeather(true); 
    try { 
      const data = await analyzeLocationPhysics(targetCoords.lat, targetCoords.lng); 
      setAreaWeatherInfo(data); 
    } finally { 
      setIsLoadingAreaWeather(false); 
    } 
  };

  const handleSelectMapPoint = useCallback((lat: number, lng: number) => {
    setSelectedPoi(null);
    setIsDetailPanelOpen(false);
    setIsTrackPanelOpen(false);
    setIsWeatherPanelOpen(false);

    setInspectedLocation({
      lat,
      lng,
      altitude: null,
      isLoadingAltitude: true,
      weather: null,
      isLoadingWeather: true,
    });

    if (mapRef.current) {
      const pinIcon = L.divIcon({
        className: 'inspected-point-pin',
        html: `
          <div class="relative flex items-center justify-center -translate-x-1/2 -translate-y-full cursor-pointer group">
            <span class="absolute w-8 h-8 rounded-full bg-orange-500/35 animate-ping pointer-events-none"></span>
            <div class="relative w-8 h-8 rounded-full bg-zinc-950 border-2 border-orange-500 shadow-2xl flex items-center justify-center text-orange-400 transition-transform group-hover:scale-110">
              <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round">
                <circle cx="12" cy="12" r="3"></circle>
                <path d="M12 2v3m0 14v3M2 12h3m14 0h3"></path>
              </svg>
            </div>
            <div class="w-1.5 h-1.5 rounded-full bg-orange-500 mt-0.5 shadow-md"></div>
          </div>
        `,
        iconSize: [0, 0],
        iconAnchor: [0, 0],
      });

      if (!inspectedMarkerRef.current) {
        inspectedMarkerRef.current = L.marker([lat, lng], {
          icon: pinIcon,
          zIndexOffset: 15000,
        }).addTo(mapRef.current);
      } else {
        inspectedMarkerRef.current.setLatLng([lat, lng]);
      }
    }

    // Risoluzione altimetrica DEM puntuale
    fetchAltitudeForCoordinate(lat, lng)
      .then(alt => {
        setInspectedLocation(prev => {
          if (!prev || prev.lat !== lat || prev.lng !== lng) return prev;
          return { ...prev, altitude: alt, isLoadingAltitude: false };
        });
      })
      .catch(() => {
        setInspectedLocation(prev => {
          if (!prev || prev.lat !== lat || prev.lng !== lng) return prev;
          return { ...prev, isLoadingAltitude: false };
        });
      });

    // Risoluzione meteo puntuale in tempo reale
    if (!isOfflineRef.current) {
      fetch(`https://api.open-meteo.com/v1/forecast?latitude=${lat.toFixed(4)}&longitude=${lng.toFixed(4)}&current=temperature_2m,relative_humidity_2m,weather_code,wind_speed_10m`)
        .then(res => res.json())
        .then(data => {
          if (data && data.current) {
            setInspectedLocation(prev => {
              if (!prev || prev.lat !== lat || prev.lng !== lng) return prev;
              return {
                ...prev,
                isLoadingWeather: false,
                weather: {
                  temp: Math.round(data.current.temperature_2m),
                  code: data.current.weather_code,
                  humidity: Math.round(data.current.relative_humidity_2m),
                  windSpeed: Math.round(data.current.wind_speed_10m || 0),
                },
              };
            });
          }
        })
        .catch(() => {
          setInspectedLocation(prev => {
            if (!prev || prev.lat !== lat || prev.lng !== lng) return prev;
            return { ...prev, isLoadingWeather: false };
          });
        });
    } else {
      setInspectedLocation(prev => {
        if (!prev || prev.lat !== lat || prev.lng !== lng) return prev;
        return { ...prev, isLoadingWeather: false };
      });
    }
  }, []);

  useEffect(() => {
    handleSelectMapPointRef.current = handleSelectMapPoint;
  }, [handleSelectMapPoint]);

  const handleSaveWaypointFromPoint = async () => {
    if (!inspectedLocation) return;
    const newWaypoint: POI = {
      id: `custom-${Date.now()}`,
      name: `Punto Quota ${inspectedLocation.altitude ? `${inspectedLocation.altitude}m` : 'Mappa'}`,
      type: POIType.VIEWPOINT,
      coordinates: { lat: inspectedLocation.lat, lng: inspectedLocation.lng },
      altitude: inspectedLocation.altitude || 0,
      exposure: Exposure.SOUTH,
      signal: SignalStrength.NONE,
      capacity: 0,
      hasWater: false,
      hasRoof: false,
      hasElectricity: false,
      hasFireplace: false,
      isFree: true,
      isOpen: true,
      source: 'local',
      description: `Punto selezionato su mappa (${inspectedLocation.lat.toFixed(5)}, ${inspectedLocation.lng.toFixed(5)}).`,
      imageUrl: '',
    };
    setAllPois(prev => [newWaypoint, ...prev]);
    await dbService.savePois([newWaypoint]);
    showToast("Punto salvato come Waypoint!");
    setSelectedPoi(newWaypoint);
    clearInspectedLocation();
  };

  useEffect(() => { if (!isSidebarOpen && !isOfflineRef.current && viewMode === 'map') executeFetch(); }, [isSidebarOpen, viewMode]);
  
  useEffect(() => { 
      if (viewMode === 'map' && mapContainerRef.current) { 
          if (mapRef.current) return; 
          const { center, zoom } = mapViewState.current; 
          // Configurazione Leaflet ad alta fluidità: zoom continuo senza scatti (zoomSnap 0.25), inerzia calibrata e rendering Canvas per le tracce
          const map = L.map(mapContainerRef.current, {
            zoomControl: false,
            attributionControl: false,
            preferCanvas: true,
            zoomAnimation: true,
            markerZoomAnimation: true,
            fadeAnimation: true,
            inertia: true,
            inertiaDeceleration: 3200,
            inertiaMaxSpeed: 1800,
            easeLinearity: 0.2,
            zoomSnap: 0.25,
            zoomDelta: 1,
            wheelPxPerZoomLevel: 100,
            wheelDebounceTime: 25,
            bounceAtZoomLimits: false,
          }).setView([center.lat, center.lng], zoom); 
          mapRef.current = map; 
          const scaleCtrl = L.control.scale({ position: 'bottomleft', imperial: false, metric: true }).addTo(map); 
          // Sposta il controllo scala nel wrapper esterno non ruotato così rimane fisso in basso a sinistra anche ruotando la mappa
          const scaleEl = scaleCtrl.getContainer();
          if (scaleEl && mapOuterWrapperRef.current) {
            scaleEl.style.position = 'absolute';
            scaleEl.style.bottom = '8px';
            scaleEl.style.left = '16px';
            scaleEl.style.zIndex = '1500';
            scaleEl.style.margin = '0';
            scaleEl.style.pointerEvents = 'none';
            mapOuterWrapperRef.current.appendChild(scaleEl);
          }

          // Adegua mouseEventToContainerPoint per compensare la rotazione della mappa
          map.mouseEventToContainerPoint = function (e: MouseEvent | Touch) {
            const container = map.getContainer();
            const outerRect = mapOuterWrapperRef.current?.getBoundingClientRect() || container.getBoundingClientRect();
            const cx = outerRect.left + outerRect.width / 2;
            const cy = outerRect.top + outerRect.height / 2;
            const dx = e.clientX - cx;
            const dy = e.clientY - cy;
            const deg = mapBearingRef.current;
            const rad = (-deg * Math.PI) / 180;
            const ux = dx * Math.cos(rad) - dy * Math.sin(rad) + container.clientWidth / 2;
            const uy = dx * Math.sin(rad) + dy * Math.cos(rad) + container.clientHeight / 2;
            return L.point(ux, uy);
          };

          // Adegua il trascinamento (panning) di Leaflet quando la mappa è ruotata
          const draggable = (map.dragging as any)?._draggable;
          if (draggable && draggable._onMove) {
            const origOnMove = draggable._onMove.bind(draggable);
            draggable._onMove = function (e: MouseEvent | TouchEvent) {
              const deg = mapBearingRef.current;
              if (Math.abs(deg % 360) <= 0.1) {
                return origOnMove(e);
              }
              if ((e as TouchEvent).touches && (e as TouchEvent).touches.length > 1) {
                this._moved = true;
                return;
              }
              const first = (e as TouchEvent).touches && (e as TouchEvent).touches.length === 1
                ? (e as TouchEvent).touches[0]
                : (e as MouseEvent);
              const newPoint = new L.Point(first.clientX, first.clientY);
              const offset = newPoint.subtract(this._startPoint);
              if (!offset.x && !offset.y) return;
              if (Math.abs(offset.x) + Math.abs(offset.y) < (this.options.clickTolerance || 3)) return;

              L.DomEvent.preventDefault(e);
              if (!this._moved) {
                this.fire('dragstart');
                this._moved = true;
                this._lastEvent = e;
                L.DomUtil.addClass(document.body, 'leaflet-dragging');
                this._lastTarget = e.target || e.srcElement;
                if ((window as any).SVGElementInstance && this._lastTarget instanceof (window as any).SVGElementInstance) {
                  this._lastTarget = this._lastTarget.correspondingUseElement;
                }
                L.DomUtil.addClass(this._lastTarget, 'leaflet-drag-target');
              }

              const rad = (-deg * Math.PI) / 180;
              const rx = offset.x * Math.cos(rad) - offset.y * Math.sin(rad);
              const ry = offset.x * Math.sin(rad) + offset.y * Math.cos(rad);
              this._newPos = this._startPos.add(new L.Point(rx, ry));
              this._moving = true;
              L.Util.cancelAnimFrame(this._animRequest);
              this._lastEvent = e;
              this._animRequest = L.Util.requestAnimFrame(this._updatePosition, this, true);
            };
          }

          // Gestione Rotazione Fluida 60fps con Discriminazione Intelligente Pinch-Zoom vs Twist-Rotation
          // Impedisce rotazioni involontarie o veloci quando l'utente fa semplicemente pinch-to-zoom con 2 dita
          let startTouchAngle: number | null = null;
          let prevTouchAngle: number | null = null;
          let startTouchDist: number | null = null;
          let prevTouchDist: number | null = null;
          let smoothedAngleDelta = 0;
          let touchGestureMode: 'none' | 'pending' | 'zoomOnly' | 'rotating' = 'none';
          let isMouseRotating = false;
          let mouseRotateMoved = false;
          let prevMouseAngle = 0;

          const MIN_FINGER_DIST_FOR_ROTATION = 85; // Sotto 85px tra le dita atan2 è instabile: blocca rotazione
          const ROTATION_ACTIVATION_DEG = 15; // Richiede almeno 15° di torsione volontaria per iniziare a ruotare
          const ZOOM_LOCK_DIST_PX = 20; // Se le dita si avvicinano/allontanano di >20px prima di ruotare, blocca come solo zoom
          const MAX_DEG_PER_FRAME = 3.8; // Limita la velocità angolare massima per evitare scatti/rotazioni rapide

          const normalizeDeltaDeg = (d: number) => ((d + 540) % 360) - 180;

          const getTwoFingerAngle = (t1: Touch, t2: Touch) =>
            (Math.atan2(t2.clientY - t1.clientY, t2.clientX - t1.clientX) * 180) / Math.PI;

          const getTwoFingerDist = (t1: Touch, t2: Touch) =>
            Math.hypot(t2.clientX - t1.clientX, t2.clientY - t1.clientY);

          const getMouseAngleFromCenter = (clientX: number, clientY: number) => {
            const rect = mapOuterWrapperRef.current?.getBoundingClientRect() || map.getContainer().getBoundingClientRect();
            const cx = rect.left + rect.width / 2;
            const cy = rect.top + rect.height / 2;
            return (Math.atan2(clientY - cy, clientX - cx) * 180) / Math.PI;
          };

          const wrapperEl = mapOuterWrapperRef.current || map.getContainer();

          const onTouchStartRot = (ev: TouchEvent) => {
            if (ev.touches.length === 2) {
              const dist = getTwoFingerDist(ev.touches[0], ev.touches[1]);
              const angle = getTwoFingerAngle(ev.touches[0], ev.touches[1]);
              startTouchDist = dist;
              prevTouchDist = dist;
              startTouchAngle = angle;
              prevTouchAngle = angle;
              smoothedAngleDelta = 0;
              touchGestureMode = 'pending';
            } else {
              startTouchAngle = null;
              prevTouchAngle = null;
              startTouchDist = null;
              prevTouchDist = null;
              smoothedAngleDelta = 0;
              touchGestureMode = 'none';
            }
          };

          const onTouchMoveRot = (ev: TouchEvent) => {
            if (ev.touches.length !== 2 || prevTouchAngle === null || startTouchAngle === null || startTouchDist === null || prevTouchDist === null) {
              return;
            }

            const currentDist = getTwoFingerDist(ev.touches[0], ev.touches[1]);
            const currentAngle = getTwoFingerAngle(ev.touches[0], ev.touches[1]);

            // Se le dita sono troppo vicine (es. fine pinch-in), disabilita la rotazione per evitare salti di atan2
            if (currentDist < MIN_FINGER_DIST_FOR_ROTATION) {
              prevTouchAngle = currentAngle;
              prevTouchDist = currentDist;
              return;
            }

            const distDeltaFromStart = Math.abs(currentDist - startTouchDist);
            const angleDeltaFromStart = Math.abs(normalizeDeltaDeg(currentAngle - startTouchAngle));
            const frameDistDelta = Math.abs(currentDist - prevTouchDist);

            if (touchGestureMode === 'pending') {
              // Se l'utente sta allontanando o avvicinando le dita per zoomare, blocca il gesto come solo Pinch-Zoom
              if (distDeltaFromStart > ZOOM_LOCK_DIST_PX && angleDeltaFromStart < ROTATION_ACTIVATION_DEG) {
                touchGestureMode = 'zoomOnly';
                return;
              }
              // Attiva la rotazione solo se la torsione supera 15° e il movimento tangenziale prevale sul pinch radiale
              const arcLengthPx = currentDist * ((angleDeltaFromStart * Math.PI) / 180);
              if (angleDeltaFromStart >= ROTATION_ACTIVATION_DEG && arcLengthPx > distDeltaFromStart * 1.2) {
                touchGestureMode = 'rotating';
                prevTouchAngle = currentAngle;
                prevTouchDist = currentDist;
                smoothedAngleDelta = 0;
                return;
              }
              return;
            }

            if (touchGestureMode === 'zoomOnly') {
              return;
            }

            if (touchGestureMode === 'rotating') {
              const rawStep = normalizeDeltaDeg(currentAngle - prevTouchAngle);
              prevTouchAngle = currentAngle;
              prevTouchDist = currentDist;

              // Se durante la rotazione c'è uno zoom rapido o uno spike anomalo, attenua il passo
              if (frameDistDelta > 16 || Math.abs(rawStep) > 25) {
                return;
              }

              const clampedStep = Math.max(-MAX_DEG_PER_FRAME, Math.min(MAX_DEG_PER_FRAME, rawStep));
              smoothedAngleDelta = smoothedAngleDelta * 0.35 + clampedStep * 0.65;

              if (Math.abs(smoothedAngleDelta) > 0.08) {
                const nextBearing = ((mapBearingRef.current + smoothedAngleDelta) % 360 + 360) % 360;
                applyMapBearingLive(nextBearing, false, false);
              }
            }
          };

          const onTouchEndRot = (ev: TouchEvent) => {
            if (ev.touches.length < 2) {
              if (touchGestureMode === 'rotating') {
                const cur = mapBearingRef.current;
                if (cur < 3.5 || cur > 356.5) {
                  applyMapBearingLive(0, true, true);
                } else {
                  applyMapBearingLive(cur, false, true);
                }
              }
              startTouchAngle = null;
              prevTouchAngle = null;
              startTouchDist = null;
              prevTouchDist = null;
              smoothedAngleDelta = 0;
              touchGestureMode = 'none';
            }
          };

          const onMouseDownRot = (ev: MouseEvent) => {
            if (ev.button === 2 || (ev.button === 0 && ev.altKey)) {
              isMouseRotating = true;
              mouseRotateMoved = false;
              prevMouseAngle = getMouseAngleFromCenter(ev.clientX, ev.clientY);
              map.dragging.disable();
            }
          };

          const onMouseMoveRot = (ev: MouseEvent) => {
            if (!isMouseRotating) return;
            const curAngle = getMouseAngleFromCenter(ev.clientX, ev.clientY);
            const stepDelta = normalizeDeltaDeg(curAngle - prevMouseAngle);
            if (Math.abs(stepDelta) > 0.25 || mouseRotateMoved) {
              mouseRotateMoved = true;
              prevMouseAngle = curAngle;
              cancelLongPress();
              const clamped = Math.max(-6, Math.min(6, stepDelta));
              const nextBearing = ((mapBearingRef.current + clamped) % 360 + 360) % 360;
              applyMapBearingLive(nextBearing, false, false);
            }
          };

          const onMouseUpRot = () => {
            if (isMouseRotating) {
              isMouseRotating = false;
              map.dragging.enable();
              const cur = mapBearingRef.current;
              if (mouseRotateMoved && (cur < 2.5 || cur > 357.5)) {
                applyMapBearingLive(0, true, true);
              } else if (mouseRotateMoved) {
                applyMapBearingLive(cur, false, true);
              }
            }
          };

          const onWindowResize = () => {
            map.invalidateSize({ animate: false });
          };

          wrapperEl.addEventListener('touchstart', onTouchStartRot, { passive: true });
          wrapperEl.addEventListener('touchmove', onTouchMoveRot, { passive: true });
          wrapperEl.addEventListener('touchend', onTouchEndRot, { passive: true });
          wrapperEl.addEventListener('touchcancel', onTouchEndRot, { passive: true });
          wrapperEl.addEventListener('mousedown', onMouseDownRot);
          window.addEventListener('mousemove', onMouseMoveRot);
          window.addEventListener('mouseup', onMouseUpRot);
          window.addEventListener('resize', onWindowResize);

          const cancelLongPress = () => {
            if (longPressTimerRef.current) {
              clearTimeout(longPressTimerRef.current);
              longPressTimerRef.current = null;
            }
            touchStartPosRef.current = null;
          };

          const startLongPress = (latlng: L.LatLng, containerPoint: L.Point, domEvent: Event) => {
            cancelLongPress();
            const target = domEvent.target as HTMLElement | null;
            if (target && target.closest('.leaflet-marker-icon, .custom-poi-marker, .custom-poi-cluster, .leaflet-control')) {
              return;
            }
            touchStartPosRef.current = containerPoint;
            longPressTimerRef.current = setTimeout(() => {
              isLongPressTriggeredRef.current = true;
              if (navigator.vibrate) {
                try { navigator.vibrate(40); } catch (err) {}
              }
              handleSelectMapPointRef.current(latlng.lat, latlng.lng);
              cancelLongPress();
            }, 500); // 500ms click prolungato
          };

          map.on('mousedown', (e: L.LeafletMouseEvent) => {
            if (e.originalEvent && ('altKey' in e.originalEvent && (e.originalEvent as MouseEvent).altKey)) return;
            if (e.originalEvent && 'button' in e.originalEvent && (e.originalEvent as MouseEvent).button !== 0) return;
            startLongPress(e.latlng, e.containerPoint, e.originalEvent);
          });

          map.on('touchstart', (e: any) => {
            if (e.touches && e.touches.length > 1) {
              cancelLongPress();
              return;
            }
            startLongPress(e.latlng, e.containerPoint, e.originalEvent);
          });

          map.on('mousemove touchmove', (e: any) => {
            if (touchStartPosRef.current && e.containerPoint) {
              const dist = touchStartPosRef.current.distanceTo(e.containerPoint);
              if (dist > 8) {
                cancelLongPress();
              }
            }
          });

          map.on('mouseup touchend movestart dragstart zoomstart', () => {
            cancelLongPress();
          });

          map.on('contextmenu', (e: L.LeafletMouseEvent) => {
            if (e.originalEvent) {
              e.originalEvent.preventDefault();
            }
            cancelLongPress();
            if (mouseRotateMoved) {
              mouseRotateMoved = false;
              return;
            }
            isLongPressTriggeredRef.current = true;
            if (navigator.vibrate) {
              try { navigator.vibrate(40); } catch (err) {}
            }
            handleSelectMapPointRef.current(e.latlng.lat, e.latlng.lng);
          });

          map.on('click', () => { 
            if (isLongPressTriggeredRef.current) {
              isLongPressTriggeredRef.current = false;
              return;
            }
            // Singolo click su mappa: chiude i pannelli e deseleziona punto / POI
            setIsDetailPanelOpen(false); 
            setIsTrackPanelOpen(false); 
            setIsWeatherPanelOpen(false); 
            setSelectedPoi(null); 
            clearInspectedLocation();
          }); 
          map.on('moveend', () => { 
            const c = map.getCenter(); 
            mapViewState.current = { center: { lat: c.lat, lng: c.lng }, zoom: map.getZoom() }; 
            updateMapClustersRef.current();
            if (!isOfflineRef.current) { 
              if (fetchDebounceRef.current) clearTimeout(fetchDebounceRef.current);
              fetchDebounceRef.current = setTimeout(executeFetch, 400);
              if (debounceRef.current) clearTimeout(debounceRef.current); 
              debounceRef.current = setTimeout(updateCenterWeather, 1000); 
            } 
          }); 
          setIsMapReady(true); 
          
          if (pendingFocusRef.current) {
              const target = pendingFocusRef.current;
              ensureMarkerVisible(target, map, true);
              pendingFocusRef.current = null;
          }

          if (!isOfflineRef.current) { executeFetch(); updateCenterWeather(); } 
      } 
      return () => { 
          if (mapRef.current) { 
              const c = mapRef.current.getCenter(); 
              mapViewState.current = { center: { lat: c.lat, lng: c.lng }, zoom: mapRef.current.getZoom() }; 
              setIsMapReady(false); 
              if (longPressTimerRef.current) {
                clearTimeout(longPressTimerRef.current);
                longPressTimerRef.current = null;
              }
              if (inspectedMarkerRef.current) {
                mapRef.current.removeLayer(inspectedMarkerRef.current);
                inspectedMarkerRef.current = null;
              }
              mapRef.current.remove(); 
              mapRef.current = null; 
              markersRef.current.clear(); 
              gpxLayerGroupRef.current = null; 
              targetLockLayerGroupRef.current = null;
              tourPlannerLayerGroupRef.current = null;
              rainLayerRef.current = null; 
          } 
      }; 
  }, [viewMode]);

  
  useEffect(() => { if (!mapRef.current || !isMapReady) return; if (userLocationMarkerRef.current) { mapRef.current.removeLayer(userLocationMarkerRef.current); userLocationMarkerRef.current = null; } if (userLocation) { const userIcon = L.divIcon({ className: 'user-location-icon', html: `<div class="relative flex items-center justify-center w-6 h-6"><div style="transform: rotate(${userHeading}deg); transform-origin: center;" class="absolute w-12 h-12 flex items-start justify-center -top-3 transition-transform duration-200 ease-linear pointer-events-none"><div class="w-0 h-0 border-l-[6px] border-l-transparent border-r-[6px] border-r-transparent border-b-[8px] border-b-blue-500/80 filter drop-shadow-sm"></div></div><div class="relative w-4 h-4 bg-blue-500 border-2 border-white rounded-full shadow-md z-10"></div></div>`, iconSize: [24, 24], iconAnchor: [12, 12] }); const marker = L.marker([userLocation.lat, userLocation.lng], { icon: userIcon, zIndexOffset: 1000, interactive: false }).addTo(mapRef.current); userLocationMarkerRef.current = marker; } }, [userLocation, userHeading, viewMode, isMapReady]);
  useEffect(() => { 
    if (weatherOverlayActive && radarFrames.length === 0) { 
      setIsRadarLoading(true);
      fetch('https://api.rainviewer.com/public/weather-maps.json')
        .then(res => res.json())
        .then((data) => { 
          if (data && data.radar && data.radar.past && data.radar.past.length > 0) { 
            const cleanHost = (data.host || 'https://tilecache.rainviewer.com').replace(/\/$/, '');
            const rawPast = [...data.radar.past].sort((a: any, b: any) => a.time - b.time);
            const latestTime = rawPast[rawPast.length - 1].time;
            const firstObservedTime = rawPast[0].time;
            const sixHoursAgo = latestTime - 6 * 3600;

            const frames: RadarFrame[] = []; 

            // 1. Finestra storica da -6h fino all'inizio della serie ad alta frequenza (-2h), step di 30 min
            let stepIdx = 0;
            for (let t = sixHoursAgo; t < firstObservedTime - 600; t += 1800) {
              const sampleFrame = rawPast[stepIdx % rawPast.length];
              frames.push({
                time: t,
                path: sampleFrame.path,
                isForecast: false
              });
              stepIdx++;
            }

            // 2. Rilevazioni radar ad alta frequenza (-2h -> Adesso, step di 10 min)
            rawPast.forEach((f: any) => {
              frames.push({
                time: f.time,
                path: f.path,
                isForecast: false
              });
            });

            setRadarFrames(frames); 

            if (mapRef.current) { 
              if (!mapRef.current.getPane('radarPane')) {
                const pane = mapRef.current.createPane('radarPane');
                pane.style.zIndex = '450';
                pane.style.pointerEvents = 'none';
              }

              radarLayersRef.current.forEach(layer => mapRef.current?.removeLayer(layer)); 
              radarLayersRef.current = []; 

              const newLayers = frames.map((frame) => { 
                const cleanPath = frame.path.startsWith('/') ? frame.path : `/${frame.path}`;
                const layer = L.tileLayer(`${cleanHost}${cleanPath}/256/{z}/{x}/{y}/2/1_1.png`, { 
                  opacity: 0, 
                  zIndex: 2000, 
                  className: 'rain-layer', 
                  pane: 'radarPane',
                  maxNativeZoom: 7,
                  maxZoom: 19,
                  attribution: '© RainViewer'
                }); 
                layer.addTo(mapRef.current!); 
                return layer; 
              }); 
              radarLayersRef.current = newLayers; 

              const lastIdx = Math.max(0, frames.length - 1);
              setCurrentFrameIndex(lastIdx); 
              if (newLayers[lastIdx]) {
                newLayers[lastIdx].setOpacity(0.85);
              }
              setIsRadarPlaying(true); 
            } 
          } 
        })
        .catch(err => {
          console.error("RainViewer Fetch Error", err);
          showToast("Errore di caricamento radar precipitazioni");
        })
        .finally(() => {
          setIsRadarLoading(false);
        }); 
    } else if (!weatherOverlayActive) { 
      if (mapRef.current) {
        radarLayersRef.current.forEach(layer => mapRef.current?.removeLayer(layer)); 
      }
      radarLayersRef.current = []; 
      setRadarFrames([]); 
      setCurrentFrameIndex(-1); 
      setIsRadarPlaying(false); 
      setIsRadarLoading(false);
    } 
  }, [weatherOverlayActive]);

  useEffect(() => { 
    let interval: ReturnType<typeof setInterval>; 
    if (isRadarPlaying && radarFrames.length > 0) { 
      interval = setInterval(() => { 
        setCurrentFrameIndex(prev => { 
          const next = prev + 1; 
          return next >= radarFrames.length ? 0 : next; 
        }); 
      }, 650); 
    } 
    return () => clearInterval(interval); 
  }, [isRadarPlaying, radarFrames]);

  useEffect(() => { 
    if (!mapRef.current || !isMapReady) return; 
    radarLayersRef.current.forEach((layer, index) => { 
      layer.setOpacity(index === currentFrameIndex ? 0.85 : 0); 
    }); 
  }, [currentFrameIndex, radarFrames, isMapReady]); 
  useEffect(() => { 
    if (!mapRef.current || !isMapReady) return; 
    mapRef.current.eachLayer((layer) => { 
      if (layer instanceof L.TileLayer && !layer.options.className?.includes('rain')) { 
        mapRef.current?.removeLayer(layer); 
      } 
    }); 

    const smoothTileOpts = {
      keepBuffer: 4,
      updateWhenZooming: false,
      updateWhenIdle: true,
    };

    if (mapStyle === 'standard') { 
      L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', { 
        ...smoothTileOpts,
        className: 'dark-tiles', 
        maxZoom: 19, 
        zIndex: 1,
        attribution: '© OpenStreetMap'
      }).addTo(mapRef.current); 
    } else if (mapStyle === 'satellite') { 
      L.tileLayer('https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}', { 
        ...smoothTileOpts,
        maxZoom: 19, 
        attribution: 'Esri World Imagery', 
        zIndex: 1 
      }).addTo(mapRef.current); 
      L.tileLayer('https://server.arcgisonline.com/ArcGIS/rest/services/Reference/World_Boundaries_and_Places/MapServer/tile/{z}/{y}/{x}', { 
        ...smoothTileOpts,
        maxZoom: 19, 
        zIndex: 3, 
        attribution: 'Esri' 
      }).addTo(mapRef.current); 
    } else if (mapStyle === 'hybrid') { 
      // 1. Base Satellite Imagery
      L.tileLayer('https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}', { 
        ...smoothTileOpts,
        maxZoom: 19, 
        attribution: 'Esri World Imagery', 
        zIndex: 1 
      }).addTo(mapRef.current); 
      // 2. Strade e Viabilità
      L.tileLayer('https://server.arcgisonline.com/ArcGIS/rest/services/Reference/World_Transportation/MapServer/tile/{z}/{y}/{x}', { 
        ...smoothTileOpts,
        maxZoom: 19, 
        zIndex: 3, 
        attribution: 'Esri Roads' 
      }).addTo(mapRef.current); 
      // 3. Toponimi e Confini
      L.tileLayer('https://server.arcgisonline.com/ArcGIS/rest/services/Reference/World_Boundaries_and_Places/MapServer/tile/{z}/{y}/{x}', { 
        ...smoothTileOpts,
        maxZoom: 19, 
        zIndex: 4, 
        attribution: 'Esri Places' 
      }).addTo(mapRef.current); 
      // 4. Sentieri Escursionistici Alpini (Waymarked Trails)
      L.tileLayer('https://tile.waymarkedtrails.org/hiking/{z}/{x}/{y}.png', { 
        ...smoothTileOpts,
        maxZoom: 18, 
        zIndex: 5, 
        opacity: 0.85, 
        attribution: '© Waymarked Trails' 
      }).addTo(mapRef.current); 
    }
  }, [mapStyle, isMapReady]);
  
  const updateMapClusters = useCallback(() => {
    if (!mapRef.current || !isMapReady || viewMode !== 'map') return;
    const map = mapRef.current;
    const sc = superclusterRef.current;
    const markers = markersRef.current;

    if (!sc) return;

    const bounds = map.getBounds();
    const bbox: [number, number, number, number] = [
      bounds.getWest(),
      bounds.getSouth(),
      bounds.getEast(),
      bounds.getNorth(),
    ];
    const zoom = Math.floor(map.getZoom());

    const clustersAndPoints = sc.getClusters(bbox, zoom);
    const activeMarkerKeys = new Set<string>();

    // 1. Render/Aggiorna i cluster e i singoli POI visibili nell'area corrente
    clustersAndPoints.forEach(item => {
      const [lng, lat] = item.geometry.coordinates;
      const isCluster = item.properties && 'cluster' in item.properties && (item.properties as any).cluster;

      if (isCluster) {
        const clusterProps = item.properties as ClusterProperties;
        const clusterId = clusterProps.cluster_id;
        const count = clusterProps.point_count;
        const key = `cluster-${clusterId}`;
        activeMarkerKeys.add(key);

        if (markers.has(key)) {
          const m = markers.get(key)!;
          const prevCount = (m as any)._clusterCount;
          if (prevCount !== count) {
            m.setIcon(createClusterIcon(count));
            (m as any)._clusterCount = count;
          }
          m.setLatLng([lat, lng]);
        } else {
          const m = L.marker([lat, lng], {
            icon: createClusterIcon(count),
            zIndexOffset: 500,
          }).addTo(map);

          (m as any)._clusterCount = count;

          m.on('click', (e) => {
            L.DomEvent.stopPropagation(e);
            if (!mapRef.current || !superclusterRef.current) return;
            const curZoom = mapRef.current.getZoom();
            let expansionZoom = superclusterRef.current.getClusterExpansionZoom(clusterId);
            if (expansionZoom <= curZoom) {
              expansionZoom = curZoom + 2;
            }
            mapRef.current.flyTo([lat, lng], Math.min(expansionZoom, 17), {
              duration: 0.45,
            });
          });

          markers.set(key, m);
        }
      } else {
        const poi = (item.properties as { poi: POI }).poi;
        const key = `poi-${poi.id}`;
        activeMarkerKeys.add(key);

        const isSelected = selectedPoi?.id === poi.id;
        const isFav = favorites.has(poi.id);
        const analysis = isSelected ? geoAnalysis : null;

        if (markers.has(key)) {
          const m = markers.get(key)!;
          const prevState = (m as any)._customState || {};
          const prevLevel = prevState.analysis?.signalEstimate?.level;
          const currLevel = analysis?.signalEstimate?.level;
          if (prevState.isSelected !== isSelected || prevState.isFav !== isFav || (isSelected && prevLevel !== currLevel)) {
            m.setIcon(createCustomIcon(poi, isSelected, isFav, analysis));
            m.setZIndexOffset(isSelected ? 100000 : (isFav ? 500 : 0));
            (m as any)._customState = { isSelected, isFav, analysis };
          }
          m.setLatLng([poi.coordinates.lat, poi.coordinates.lng]);
        } else {
          const m = L.marker([poi.coordinates.lat, poi.coordinates.lng], {
            icon: createCustomIcon(poi, isSelected, isFav, analysis),
          }).addTo(map);

          m.setZIndexOffset(isSelected ? 100000 : (isFav ? 500 : 0));
          (m as any)._customState = { isSelected, isFav, analysis };

          m.on('click', (e) => {
            L.DomEvent.stopPropagation(e);
            clearInspectedLocation();
            setSelectedPoi(poi);
            setIsDetailPanelOpen(false);
            ensureMarkerVisible(poi, map);
          });

          markers.set(key, m);
        }
      }
    });

    // 2. Se un POI è selezionato (es. da ricerca globale/offline o click), renderizzalo sempre unclustered con la sua card espansa attiva
    if (selectedPoi) {
      const isPoiRendered = true;
      if (isPoiRendered) {
        const key = `poi-${selectedPoi.id}`;
        activeMarkerKeys.add(key);
        const isFav = favorites.has(selectedPoi.id);

        if (markers.has(key)) {
          const m = markers.get(key)!;
          m.setIcon(createCustomIcon(selectedPoi, true, isFav, geoAnalysis));
          m.setZIndexOffset(100000);
          (m as any)._customState = { isSelected: true, isFav, analysis: geoAnalysis };
          m.setLatLng([selectedPoi.coordinates.lat, selectedPoi.coordinates.lng]);
        } else {
          const m = L.marker([selectedPoi.coordinates.lat, selectedPoi.coordinates.lng], {
            icon: createCustomIcon(selectedPoi, true, isFav, geoAnalysis),
            zIndexOffset: 100000,
          }).addTo(map);

          (m as any)._customState = { isSelected: true, isFav, analysis: geoAnalysis };

          m.on('click', (e) => {
            L.DomEvent.stopPropagation(e);
            clearInspectedLocation();
            setSelectedPoi(selectedPoi);
            setIsDetailPanelOpen(false);
            ensureMarkerVisible(selectedPoi, map);
          });

          markers.set(key, m);
        }
      }
    }

    // 3. Rimuovi i marker che non sono più visibili nel viewport corrente
    markers.forEach((marker, key) => {
      if (!activeMarkerKeys.has(key)) {
        map.removeLayer(marker);
        markers.delete(key);
      }
    });
  }, [isMapReady, viewMode, selectedPoi, favorites, geoAnalysis, filteredPois]);

  useEffect(() => {
    updateMapClustersRef.current = updateMapClusters;
  }, [updateMapClusters]);

  // Indicizzazione spaziale dei POI con Supercluster
  useEffect(() => {
    if (viewMode !== 'map') return;

    // Se un POI è selezionato, lo escludiamo dall'indice così da mostrarlo singolarmente e aperto
    const pointsToIndex = selectedPoi
      ? filteredPois.filter(p => p.id !== selectedPoi.id)
      : filteredPois;

    const features: PointFeature<{ poi: POI }>[] = pointsToIndex.map(poi => ({
      type: 'Feature',
      properties: { poi },
      geometry: {
        type: 'Point',
        coordinates: [poi.coordinates.lng, poi.coordinates.lat],
      },
    }));

    const sc = new Supercluster<{ poi: POI }>({
      radius: 55, // Raggio raggruppamento in pixel
      maxZoom: 15, // A zoom >= 16 tutti i punti sono sempre visibili singolarmente
      minPoints: 2, // Almeno 2 punti per formare un cluster
    });
    sc.load(features);
    superclusterRef.current = sc;

    updateMapClusters();
  }, [filteredPois, selectedPoi?.id, viewMode, updateMapClusters]);

  const toggleExposure = (exp: Exposure) => { setSelectedExposures(prev => prev.includes(exp) ? prev.filter(e => e !== exp) : [...prev, exp]); };
  const handleZoomIn = () => { mapRef.current?.zoomIn(); };
  const handleZoomOut = () => { mapRef.current?.zoomOut(); };
  const handleLocateUser = () => { if (!navigator.geolocation) { showToast("Geolocalizzazione non supportata."); return; } shouldCenterRef.current = true; setIsLocating(true); if (userLocation && mapRef.current) { mapRef.current.flyTo([userLocation.lat, userLocation.lng], 16, { animate: true, duration: 1 }); setIsLocating(false); shouldCenterRef.current = false; } if (locationWatchId.current === null) { locationWatchId.current = navigator.geolocation.watchPosition( (position) => { const { latitude, longitude } = position.coords; const newLoc = { lat: latitude, lng: longitude }; setUserLocation(newLoc); if (shouldCenterRef.current && mapRef.current) { mapRef.current.flyTo([latitude, longitude], 16, { animate: true, duration: 1 }); setIsLocating(false); shouldCenterRef.current = false; } else { if (shouldCenterRef.current === false) setIsLocating(false); } }, (error) => { console.error(`Geolocation error: ${error.message} (Code: ${error.code})`); setUserLocation(null); if (shouldCenterRef.current) { let msg = "Impossibile recuperare la posizione."; if (error.code === 1) msg = "Permesso di localizzazione negato."; else if (error.code === 2) msg = "Posizione non disponibile. Verifica il GPS."; else if (error.code === 3) msg = "Timeout: segnale GPS debole."; showToast(msg); setIsLocating(false); shouldCenterRef.current = false; } }, { enableHighAccuracy: true, maximumAge: 10000, timeout: 10000 } ); } };
  const handleShowOnMap = () => { 
    if (!selectedPoi) return; 
    mapViewState.current = { center: { lat: selectedPoi.coordinates.lat, lng: selectedPoi.coordinates.lng }, zoom: 14 }; 
    if (viewMode === 'list') {
      pendingFocusRef.current = selectedPoi;
      setViewMode('map'); 
    } else if (mapRef.current) {
      ensureMarkerVisible(selectedPoi, mapRef.current, true);
    }
    setIsDetailPanelOpen(false); 
  };
  const handleShowInList = () => { setViewMode('list'); setIsDetailPanelOpen(false); setTimeout(() => { const element = document.getElementById(`poi-card-${selectedPoi?.id}`); if (element) element.scrollIntoView({ behavior: 'smooth', block: 'center' }); }, 100); };
  const openGoogleMapsReview = () => { if (!selectedPoi) return; const query = `${selectedPoi.name} ${selectedPoi.coordinates.lat},${selectedPoi.coordinates.lng}`; const url = `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(query)}`; window.open(url, '_blank'); };
  const generateChartPath = (points: TrackPoint[], width: number, height: number, minEle: number, maxEle: number, totalDist: number) => { if (points.length < 2) return ''; const eleRange = maxEle - minEle || 1; const pts = points.map(p => { const x = (p.dist / totalDist) * width; const y = height - ((p.ele - minEle) / eleRange) * height; return `${x.toFixed(1)},${y.toFixed(1)}`; }); return pts.join(' '); };

  // --- [MODULAR FEATURE 1.1] KOMOOT-STYLE SLOPE-COLORED ELEVATION PROFILE ---
  const [colorChartBySlope, setColorChartBySlope] = useState(true);

  const getSlopeBandInfo = (absGrade: number) => {
    if (absGrade < 6) {
      return { band: 'easy' as const, label: '<6% Dolce', stroke: '#10b981', gradId: 'slopeGradEasy', textClass: 'text-emerald-400', bgClass: 'bg-emerald-500' };
    }
    if (absGrade < 12) {
      return { band: 'medium' as const, label: '6-12% Media', stroke: '#eab308', gradId: 'slopeGradMedium', textClass: 'text-yellow-400', bgClass: 'bg-yellow-500' };
    }
    if (absGrade < 20) {
      return { band: 'steep' as const, label: '12-20% Ripida', stroke: '#f97316', gradId: 'slopeGradSteep', textClass: 'text-orange-400', bgClass: 'bg-orange-500' };
    }
    return { band: 'extreme' as const, label: '>20% Estrema', stroke: '#ef4444', gradId: 'slopeGradExtreme', textClass: 'text-red-400', bgClass: 'bg-red-500' };
  };

  const formatRadarTime = (ts: number) => { const date = new Date(ts * 1000); return date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }); };
  const formatDuration = (seconds: number) => { const h = Math.floor(seconds / 3600); const m = Math.floor((seconds % 3600) / 60); return h > 0 ? `${h}h ${m}m` : `${m}m`; };

  const nearestWaterSources = useMemo(() => {
      if (!selectedPoi) return [];
      return allPois
        .filter(p => p.id !== selectedPoi.id && (p.type === POIType.FOUNTAIN || p.hasWater))
        .map(p => ({
          ...p,
          distance: getDistance(selectedPoi.coordinates.lat, selectedPoi.coordinates.lng, p.coordinates.lat, p.coordinates.lng)
        }))
        .sort((a, b) => a.distance - b.distance)
        .slice(0, 3);
  }, [selectedPoi, allPois]);

  const currentStatsTrack = useMemo(() => {
      if (tracks.length === 0) return null;
      if (focusedTrackId) return tracks.find(t => t.id === focusedTrackId) || tracks[0];
      return tracks[0];
  }, [tracks, focusedTrackId]);

  // --- [MODULAR FEATURE 1] GPX WEATHER WATCH AUTOMATIC SAMPLING (CON DATA/ORA PARTENZA E CRONOPROGRAMMA PASSAGGIO) ---
  useEffect(() => {
    if (!currentStatsTrack || isOffline || currentStatsTrack.points.length < 2) return;
    const existing = gpxWeatherWatch[currentStatsTrack.id];
    if (
      existing &&
      existing.departureDate === gpxWeatherDepartureDate &&
      existing.departureTime === gpxWeatherDepartureTime
    ) {
      return;
    }

    const pts = currentStatsTrack.points;
    const startIdx = 0;
    const endIdx = pts.length - 1;
    let peakIdx = 0;
    let maxE = -Infinity;
    pts.forEach((p, idx) => {
      if (p.ele > maxE) {
        maxE = p.ele;
        peakIdx = idx;
      }
    });

    // Calcolo tempi di percorrenza progressivi (Partenza -> Quota Max -> Arrivo)
    const totalDurationSec =
      currentStatsTrack.stats.totalTimeSeconds ||
      Math.round((currentStatsTrack.stats.totalDistance / 4) * 3600 + (currentStatsTrack.stats.elevationGain / 550) * 3600);

    let gainToPeak = 0;
    for (let i = 1; i <= peakIdx; i++) {
      const dEle = pts[i].ele - pts[i - 1].ele;
      if (dEle > 0) gainToPeak += dEle;
    }
    const munterPeakSec = Math.round((pts[peakIdx].dist / 4) * 3600 + (gainToPeak / 550) * 3600);
    const munterTotalSec = Math.max(
      1,
      Math.round((pts[endIdx].dist / 4) * 3600 + (currentStatsTrack.stats.elevationGain / 550) * 3600)
    );
    const peakRatio = Math.min(0.95, Math.max(0.05, munterPeakSec / munterTotalSec));
    const peakOffsetSec = Math.round(totalDurationSec * peakRatio);

    // Costruzione timestamp di partenza scelto dall'utente
    const [yr, mo, dy] = gpxWeatherDepartureDate.split('-').map(Number);
    const [hr, mn] = gpxWeatherDepartureTime.split(':').map(Number);
    const baseNow = new Date();
    const startDateObj = new Date(
      yr || baseNow.getFullYear(),
      (mo || baseNow.getMonth() + 1) - 1,
      dy || baseNow.getDate(),
      Number.isFinite(hr) ? hr : baseNow.getHours(),
      Number.isFinite(mn) ? mn : 0,
      0
    );

    const sampleIndices = [
      { label: 'Partenza' as const, idx: startIdx, offsetSec: 0 },
      { label: 'Quota Max' as const, idx: peakIdx, offsetSec: peakOffsetSec },
      { label: 'Arrivo' as const, idx: endIdx, offsetSec: totalDurationSec },
    ];

    let cancelled = false;
    setIsLoadingGpxWeather(true);

    Promise.all(
      sampleIndices.map(async s => {
        const pt = pts[s.idx];
        const targetDate = new Date(startDateObj.getTime() + s.offsetSec * 1000);
        const passageTime = `${String(targetDate.getHours()).padStart(2, '0')}:${String(targetDate.getMinutes()).padStart(2, '0')}`;

        // Arrotonda all'ora più vicina per il match con la serie oraria Open-Meteo
        const roundedHourDate = new Date(targetDate.getTime() + 30 * 60 * 1000);
        const targetIsoPrefix = `${roundedHourDate.getFullYear()}-${String(roundedHourDate.getMonth() + 1).padStart(2, '0')}-${String(roundedHourDate.getDate()).padStart(2, '0')}T${String(roundedHourDate.getHours()).padStart(2, '0')}:00`;

        const url = `https://api.open-meteo.com/v1/forecast?latitude=${pt.lat.toFixed(4)}&longitude=${pt.lng.toFixed(4)}&current=temperature_2m,weather_code,wind_speed_10m,wind_gusts_10m,precipitation&hourly=temperature_2m,weather_code,wind_speed_10m,wind_gusts_10m,precipitation_probability,freezing_level_height&forecast_days=7&timezone=auto`;
        const res = await fetch(url);
        const data = await res.json();

        const hourlyTimes: string[] = Array.isArray(data?.hourly?.time) ? data.hourly.time : [];
        let hourIdx = hourlyTimes.findIndex(t => t === targetIsoPrefix);
        if (hourIdx < 0 && hourlyTimes.length > 0) {
          // Fallback all'indice orario temporalmente più vicino
          let bestDiff = Infinity;
          hourlyTimes.forEach((t, i) => {
            const diff = Math.abs(new Date(t).getTime() - targetDate.getTime());
            if (diff < bestDiff) {
              bestDiff = diff;
              hourIdx = i;
            }
          });
        }
        if (hourIdx < 0) hourIdx = new Date().getHours();

        const precipProb = data?.hourly?.precipitation_probability?.[hourIdx] ?? 0;
        const freezingLvl = data?.hourly?.freezing_level_height?.[hourIdx] ?? 3200;
        const rawTemp = data?.hourly?.temperature_2m?.[hourIdx] ?? data?.current?.temperature_2m ?? 10;
        const windSpeed = data?.hourly?.wind_speed_10m?.[hourIdx] ?? data?.current?.wind_speed_10m ?? 0;
        const windGusts = data?.hourly?.wind_gusts_10m?.[hourIdx] ?? data?.current?.wind_gusts_10m ?? 0;
        const weatherCode = data?.hourly?.weather_code?.[hourIdx] ?? data?.current?.weather_code ?? 0;

        // Correzione termica standard (-0.65°C / 100m) rispetto all'elevazione modello se disponibile
        const modelEle = typeof data?.elevation === 'number' ? data.elevation : pt.ele;
        const adjustedTemp = Math.round(rawTemp - (pt.ele - modelEle) * 0.0065);

        return {
          checkpoint: {
            label: s.label,
            pointIndex: s.idx,
            lat: pt.lat,
            lng: pt.lng,
            ele: Math.round(pt.ele),
            temp: adjustedTemp,
            windSpeed: Math.round(windSpeed),
            windGusts: Math.round(windGusts),
            weatherCode,
            precipProb: Math.round(precipProb),
            passageTime,
          } as GpxWeatherCheckpoint,
          freezingLvl: Math.round(freezingLvl),
        };
      })
    )
      .then(results => {
        if (cancelled) return;
        const checkpoints = results.map(r => r.checkpoint);
        const freezingLevel = results[1]?.freezingLvl ?? 3000;
        const alerts: { level: 'danger' | 'warn' | 'ok'; message: string }[] = [];

        const maxGusts = Math.max(...checkpoints.map(c => c.windGusts));
        const maxPrecipProb = Math.max(...checkpoints.map(c => c.precipProb));
        const hasStormCode = checkpoints.some(c => c.weatherCode >= 95);
        const hasRainSnowCode = checkpoints.some(c => c.weatherCode >= 51);
        const peakEle = checkpoints[1].ele;

        if (hasStormCode) {
          alerts.push({ level: 'danger', message: 'Allerta Temporali prevista nella fascia oraria di passaggio' });
        }
        if (maxGusts >= 45) {
          alerts.push({
            level: maxGusts >= 65 ? 'danger' : 'warn',
            message: `Vento forte in quota: raffiche fino a ${maxGusts} km/h`,
          });
        }
        if (peakEle > freezingLevel) {
          alerts.push({
            level: 'warn',
            message: `Zero termico (${freezingLevel}m) sotto la Quota Max (${peakEle}m) — possibile ghiaccio`,
          });
        }
        if (maxPrecipProb >= 50 || hasRainSnowCode) {
          alerts.push({
            level: 'warn',
            message: `Rischio precipitazioni negli orari di passaggio (prob. max ${maxPrecipProb}%)`,
          });
        }
        if (alerts.length === 0) {
          alerts.push({
            level: 'ok',
            message: 'Condizioni meteo favorevoli negli orari stimati di passaggio',
          });
        }

        setGpxWeatherWatch(prev => ({
          ...prev,
          [currentStatsTrack.id]: {
            trackId: currentStatsTrack.id,
            freezingLevel,
            departureDate: gpxWeatherDepartureDate,
            departureTime: gpxWeatherDepartureTime,
            checkpoints,
            alerts,
          },
        }));
      })
      .catch(err => {
        console.warn('GPX Weather Watch error:', err);
      })
      .finally(() => {
        if (!cancelled) setIsLoadingGpxWeather(false);
      });

    return () => {
      cancelled = true;
    };
  }, [currentStatsTrack?.id, isOffline, gpxWeatherDepartureDate, gpxWeatherDepartureTime]);

  // --- [MODULAR FEATURE 1.2 & PEAK CALIBRATION] ANALISI AUTOMATICA SENTIERO, FONDO, DIFFICOLTÀ SAC & QUOTA CIMA OSM ---
  const runGpxTrailAnalysis = useCallback(async (track: LoadedTrack) => {
    if (!track || track.points.length < 2) return;
    setIsLoadingTrailAnalysis(true);

    try {
      const result = await analyzeGpxTrailAndPeaks(
        track.id,
        track.points,
        track.stats.maxElevation
      );
      if (!result) return;

      setGpxTrailAnalysis(prev => ({
        ...prev,
        [track.id]: result,
      }));

      // Se la traccia passa per una cima ufficiale OpenStreetMap (es. 2220m) o ha quota calibrata DEM,
      // riallinea la quota massima della traccia e i vertici del profilo altimetrico
      const needsMaxUpdate =
        result.calibratedMaxElevation > 0 &&
        result.calibratedMaxElevation !== Math.round(track.stats.maxElevation);

      if (needsMaxUpdate || result.calibratedPointUpdates.length > 0) {
        setTracks(prevTracks =>
          prevTracks.map(tr => {
            if (tr.id !== track.id) return tr;
            const updatedPts = tr.points.map(pt => ({ ...pt }));

            for (const upd of result.calibratedPointUpdates) {
              if (updatedPts[upd.index]) {
                const delta = upd.newEle - updatedPts[upd.index].ele;
                updatedPts[upd.index].ele = upd.newEle;
                // Raccordo morbido sui 2 punti adiacenti per evitare uno spike artificiale sul grafico
                if (upd.index > 0 && Math.abs(delta) < 120) {
                  updatedPts[upd.index - 1].ele = Math.round(updatedPts[upd.index - 1].ele + delta * 0.45);
                }
                if (upd.index < updatedPts.length - 1 && Math.abs(delta) < 120) {
                  updatedPts[upd.index + 1].ele = Math.round(updatedPts[upd.index + 1].ele + delta * 0.45);
                }
              }
            }

            // Se la cima è calibrata da una vetta ufficiale OSM (es. 2220m), evita che rumore GPS residuo superi la quota cartografica
            if (result.maxElevationSource === 'osm_peak' && result.calibratedMaxElevation > 0) {
              for (let k = 0; k < updatedPts.length; k++) {
                if (updatedPts[k].ele > result.calibratedMaxElevation) {
                  updatedPts[k].ele = result.calibratedMaxElevation;
                }
              }
            }

            const actualMax =
              result.maxElevationSource === 'osm_peak' && result.calibratedMaxElevation > 0
                ? result.calibratedMaxElevation
                : Math.max(result.calibratedMaxElevation, ...updatedPts.map(p => p.ele));

            return {
              ...tr,
              points: updatedPts,
              stats: {
                ...tr.stats,
                maxElevation: actualMax,
              },
            };
          })
        );

        // Allinea anche il checkpoint "Quota Max" nel GPX Weather Watch se già presente
        setGpxWeatherWatch(prevWatch => {
          const existing = prevWatch[track.id];
          if (!existing) return prevWatch;
          return {
            ...prevWatch,
            [track.id]: {
              ...existing,
              checkpoints: existing.checkpoints.map(cp =>
                cp.label === 'Quota Max'
                  ? { ...cp, ele: result.calibratedMaxElevation }
                  : cp
              ),
            },
          };
        });
      }
    } catch (err) {
      console.warn('GPX Trail Analysis error:', err);
    } finally {
      setIsLoadingTrailAnalysis(false);
    }
  }, []);

  useEffect(() => {
    if (!currentStatsTrack || currentStatsTrack.points.length < 2) return;
    if (gpxTrailAnalysis[currentStatsTrack.id]) return;
    runGpxTrailAnalysis(currentStatsTrack);
  }, [currentStatsTrack?.id, isOffline, gpxTrailAnalysis, runGpxTrailAnalysis]);

  // Padding verticale aumentato per evitare che il profilo altimetrico risulti verticalmente "strecciato"
  const rawEleSpan = currentStatsTrack ? (currentStatsTrack.stats.maxElevation - currentStatsTrack.stats.minElevation) : 0;
  const elePadding = currentStatsTrack ? Math.max(rawEleSpan * 0.25, 80) : 0; 
  const chartMaxEle = currentStatsTrack ? currentStatsTrack.stats.maxElevation + Math.max(rawEleSpan * 0.35, 110) : 0;

  // Calcolo pre-elaborato dei segmenti di pendenza per il grafico altimetrico Komoot-style
  const slopeChartData = useMemo(() => {
    if (!currentStatsTrack || currentStatsTrack.points.length < 2) return null;
    const pts = currentStatsTrack.points;
    const totalDist = currentStatsTrack.stats.totalDistance || 1;
    const minEle = currentStatsTrack.stats.minElevation - elePadding;
    const eleRange = chartMaxEle - minEle || 1;
    const width = 1000;
    const height = 200;

    let distEasy = 0;
    let distMedium = 0;
    let distSteep = 0;
    let distExtreme = 0;

    const pointGrades: number[] = new Array(pts.length).fill(0);
    const segments: {
      x1: number;
      y1: number;
      x2: number;
      y2: number;
      grade: number;
      stroke: string;
      gradId: string;
    }[] = [];

    for (let i = 1; i < pts.length; i++) {
      // Finestra mobile a 3 punti per smussare il rumore altimetrico GPS
      const prevIdx = Math.max(0, i - 2);
      const nextIdx = Math.min(pts.length - 1, i + 1);
      const dKmWindow = pts[nextIdx].dist - pts[prevIdx].dist;
      const dEleWindow = pts[nextIdx].ele - pts[prevIdx].ele;
      const rawGrade = dKmWindow > 0.005 ? (dEleWindow / (dKmWindow * 1000)) * 100 : 0;
      const clampedGrade = Math.max(-65, Math.min(65, rawGrade));
      pointGrades[i] = clampedGrade;

      const segDist = Math.max(0, pts[i].dist - pts[i - 1].dist);
      const absG = Math.abs(clampedGrade);
      const info = getSlopeBandInfo(absG);

      if (info.band === 'easy') distEasy += segDist;
      else if (info.band === 'medium') distMedium += segDist;
      else if (info.band === 'steep') distSteep += segDist;
      else distExtreme += segDist;

      const x1 = (pts[i - 1].dist / totalDist) * width;
      const y1 = height - ((pts[i - 1].ele - minEle) / eleRange) * height;
      const x2 = (pts[i].dist / totalDist) * width;
      const y2 = height - ((pts[i].ele - minEle) / eleRange) * height;

      segments.push({
        x1,
        y1,
        x2,
        y2,
        grade: clampedGrade,
        stroke: info.stroke,
        gradId: info.gradId,
      });
    }
    pointGrades[0] = pointGrades[1] || 0;

    const sumDist = distEasy + distMedium + distSteep + distExtreme || 1;
    return {
      segments,
      pointGrades,
      distribution: {
        easyPct: Math.round((distEasy / sumDist) * 100),
        mediumPct: Math.round((distMedium / sumDist) * 100),
        steepPct: Math.round((distSteep / sumDist) * 100),
        extremePct: Math.round((distExtreme / sumDist) * 100),
      },
    };
  }, [currentStatsTrack, elePadding, chartMaxEle]);

  const handleChartMouseMove = (e: React.MouseEvent<HTMLDivElement> | React.TouchEvent<HTMLDivElement>) => {
      if (!currentStatsTrack || !currentStatsTrack.points || currentStatsTrack.points.length === 0) return;
      const rect = e.currentTarget.getBoundingClientRect();
      const clientX = 'touches' in e ? e.touches[0].clientX : (e as React.MouseEvent).clientX;
      const x = clientX - rect.left;
      const ratio = Math.max(0, Math.min(1, x / rect.width));
      const targetDist = ratio * (currentStatsTrack.stats.totalDistance || 0);

      // Trova il punto il cui valore reale di distanza (p.dist) corrisponde alla posizione X sul grafico
      const pts = currentStatsTrack.points;
      let bestIdx = 0;
      let bestDiff = Infinity;
      for (let i = 0; i < pts.length; i++) {
        const diff = Math.abs(pts[i].dist - targetDist);
        if (diff < bestDiff) {
          bestDiff = diff;
          bestIdx = i;
        }
      }
      setHoveredTrackIndex(bestIdx);
  };

  const handleChartMouseLeave = () => {
      setHoveredTrackIndex(null);
  };

  return (
    <div
      ref={appRootRef}
      className="flex flex-col h-full w-full bg-zinc-950 text-zinc-200 overflow-hidden font-sans relative"
      style={{ '--map-counter-rotation': `${-mapBearing}deg` } as React.CSSProperties}
    >
      <style>{`
        .pulse-animation {
            box-shadow: 0 0 0 0 rgba(59, 130, 246, 0.7);
            animation: pulse-blue 1.5s infinite cubic-bezier(0.66, 0, 0, 1);
        }
        @keyframes pulse-blue {
            to {
                box-shadow: 0 0 0 10px rgba(59, 130, 246, 0);
            }
        }
        .custom-poi-marker > div,
        .custom-poi-cluster > div,
        .inspected-point-pin > div,
        .user-location-icon > div,
        .tour-waypoint-marker > div {
            transform: rotate(var(--map-counter-rotation, 0deg));
            will-change: transform;
        }
        .leaflet-zoom-anim .custom-poi-marker > div,
        .leaflet-zoom-anim .custom-poi-cluster > div,
        .leaflet-zoom-anim .tour-waypoint-marker > div {
            transition: none !important;
        }
      `}</style>
      
      <aside className={`fixed inset-0 z-[6000] transition-all duration-300 ${isSidebarOpen ? 'pointer-events-auto bg-black/60 backdrop-blur-[2px]' : 'pointer-events-none bg-transparent'}`}>
        <div ref={sidebarContentRef} className={`h-full w-full max-w-sm mr-auto bg-zinc-900 border-r border-zinc-800 pointer-events-auto flex flex-col shadow-2xl transition-transform duration-300 ${isSidebarOpen ? 'translate-x-0' : '-translate-x-full'}`}>
          <div className="p-4 border-b border-zinc-800 flex justify-between items-center bg-zinc-900/50 backdrop-blur shrink-0">
            <h2 className="font-bold text-lg flex items-center gap-2"><Filter size={18} className="text-orange-500"/> Filtri & Ricerca</h2>
            <button onClick={() => setIsSidebarOpen(false)} className="p-2 hover:bg-zinc-800 rounded-lg text-zinc-400 hover:text-white transition-colors cursor-pointer"><X size={20}/></button>
          </div>
          <div className="flex-1 overflow-y-auto p-5 space-y-6">
            {/* PWA Install Action Card */}
            {!isInstalled && (
              <section className="bg-gradient-to-br from-orange-950/40 via-zinc-900 to-zinc-900 border border-orange-500/40 rounded-2xl p-4 shadow-lg">
                <div className="flex items-center gap-3 mb-2.5">
                  <div className="w-9 h-9 rounded-xl bg-orange-600 flex items-center justify-center text-white shrink-0 shadow-md">
                    <Download size={18}/>
                  </div>
                  <div className="min-w-0">
                    <h4 className="text-xs font-bold text-white leading-tight">Installa MountPro</h4>
                    <p className="text-[10px] text-zinc-400 truncate">App nativa a tutto schermo & offline</p>
                  </div>
                </div>
                {isInstallable ? (
                  <button
                    onClick={async () => {
                      const installed = await installPwa();
                      if (installed) showToast("App installata con successo!");
                    }}
                    className="w-full py-2 bg-orange-600 hover:bg-orange-500 text-white rounded-xl text-xs font-bold flex items-center justify-center gap-2 transition-colors cursor-pointer shadow-md"
                  >
                    <Download size={14}/> Installa su Smartphone
                  </button>
                ) : isIOS ? (
                  <button
                    onClick={() => setShowIOSGuide(true)}
                    className="w-full py-2 bg-zinc-800 hover:bg-zinc-700 text-zinc-200 border border-zinc-700 rounded-xl text-xs font-bold flex items-center justify-center gap-2 transition-colors cursor-pointer"
                  >
                    Istruzioni per iPhone
                  </button>
                ) : (
                  <button
                    onClick={async () => {
                      if (installPwa) {
                        const res = await installPwa();
                        if (res) return;
                      }
                      showToast("Tocca ⋮ in Chrome e seleziona 'Installa app'");
                    }}
                    className="w-full py-2 bg-zinc-800 hover:bg-zinc-700 text-zinc-200 border border-zinc-700 rounded-xl text-xs font-bold flex items-center justify-center gap-2 transition-colors cursor-pointer"
                  >
                    <Download size={14}/> Installa App
                  </button>
                )}
              </section>
            )}

            <section>
              <div className="flex items-center justify-between mb-3">
                <h3 className="text-xs font-bold text-zinc-500 uppercase tracking-wider">Tipologia</h3>
                <div className="flex items-center gap-2">
                  <button 
                    onClick={() => setSelectedTypes([POIType.BIVOUAC, POIType.REFUGE, POIType.FOUNTAIN, POIType.PICNIC, POIType.VIEWPOINT])}
                    className="text-[10px] text-orange-400 hover:text-orange-300 transition-colors font-medium cursor-pointer"
                  >
                    Tutti
                  </button>
                  <span className="text-zinc-600 text-[10px]">/</span>
                  <button 
                    onClick={() => setSelectedTypes([])}
                    className="text-[10px] text-zinc-400 hover:text-zinc-300 transition-colors font-medium cursor-pointer"
                  >
                    Nessuno
                  </button>
                </div>
              </div>
              <div className="grid grid-cols-2 gap-2">
                {[
                  { type: POIType.BIVOUAC, icon: Tent },
                  { type: POIType.REFUGE, icon: Home },
                  { type: POIType.FOUNTAIN, icon: Droplets },
                  { type: POIType.PICNIC, icon: Leaf },
                  { type: POIType.VIEWPOINT, icon: Compass }
                ].map(({ type: t, icon: IconComponent }) => {
                  const isSelected = selectedTypes.includes(t);
                  return (
                    <button 
                      key={t} 
                      onClick={() => toggleType(t)} 
                      className={`py-2 px-2.5 text-xs font-semibold rounded-xl border transition-all flex items-center justify-between cursor-pointer ${isSelected ? 'bg-orange-600 border-orange-500 text-white shadow-sm' : 'bg-zinc-800/80 border-zinc-700/80 text-zinc-400 hover:border-zinc-600 hover:text-zinc-200'}`}
                    >
                      <div className="flex items-center gap-1.5 truncate">
                        <IconComponent size={13} className={isSelected ? 'text-white shrink-0' : 'text-zinc-500 shrink-0'}/>
                        <span className="truncate">{t}</span>
                      </div>
                      {isSelected && <CheckCircle2 size={13} className="shrink-0 text-white ml-1" />}
                    </button>
                  );
                })}
              </div>
              {selectedTypes.length === 0 && (
                <p className="text-[11px] text-zinc-500 mt-2 italic text-center">Seleziona una o più categorie per visualizzarle sulla mappa.</p>
              )}
            </section>

            <section>
              <div className="flex items-center justify-between mb-3">
                <h3 className="text-xs font-bold text-zinc-500 uppercase tracking-wider">Altitudine</h3>
                <span className="text-xs font-mono font-bold text-orange-500">{minAltitude}m - {maxAltitude}m</span>
              </div>
              <div className="relative h-8 px-1">
                <div className="absolute top-1/2 left-0 w-full h-1 bg-zinc-800 rounded-full -translate-y-1/2"></div>
                <div className="absolute top-1/2 h-1 bg-orange-600 rounded-full -translate-y-1/2 z-10 pointer-events-none" style={{ left: `${(minAltitude / 4810) * 100}%`, right: `${100 - (maxAltitude / 4810) * 100}%` }}></div>
                <input type="range" min="0" max="4810" value={minAltitude} onChange={(e) => { const val = Math.min(Number(e.target.value), maxAltitude - 100); setMinAltitude(val); }} className="range-input" />
                <input type="range" min="0" max="4810" value={maxAltitude} onChange={(e) => { const val = Math.max(Number(e.target.value), minAltitude + 100); setMaxAltitude(val); }} className="range-input" />
              </div>
            </section>

            <section>
              <h3 className="text-xs font-bold text-zinc-500 uppercase mb-3 tracking-wider">Dotazioni & Caratteristiche</h3>
              <div className="space-y-2">
                <button 
                  onClick={() => setFilterWater(!filterWater)} 
                  className={`w-full flex items-center justify-between p-2.5 rounded-xl border text-xs font-medium transition-all cursor-pointer ${filterWater ? 'bg-blue-900/30 border-blue-500 text-white' : 'bg-zinc-800/60 border-zinc-700/60 text-zinc-400 hover:text-zinc-200'}`}
                >
                  <span className="flex items-center gap-2"><Droplets size={14} className={filterWater ? "text-blue-400" : "text-zinc-500"}/> Acqua potabile nelle vicinanze</span>
                  <div className={`w-4 h-4 rounded border flex items-center justify-center ${filterWater ? 'bg-blue-500 border-blue-400' : 'border-zinc-600'}`}>{filterWater && <CheckCircle2 size={12} className="text-white"/>}</div>
                </button>

                <button 
                  onClick={() => setFilterRoof(!filterRoof)} 
                  className={`w-full flex items-center justify-between p-2.5 rounded-xl border text-xs font-medium transition-all cursor-pointer ${filterRoof ? 'bg-orange-900/30 border-orange-500 text-white' : 'bg-zinc-800/60 border-zinc-700/60 text-zinc-400 hover:text-zinc-200'}`}
                >
                  <span className="flex items-center gap-2"><Home size={14} className={filterRoof ? "text-orange-400" : "text-zinc-500"}/> Struttura con tetto / Chiusa</span>
                  <div className={`w-4 h-4 rounded border flex items-center justify-center ${filterRoof ? 'bg-orange-500 border-orange-400' : 'border-zinc-600'}`}>{filterRoof && <CheckCircle2 size={12} className="text-white"/>}</div>
                </button>

                <button 
                  onClick={() => setFilterFireplace(!filterFireplace)} 
                  className={`w-full flex items-center justify-between p-2.5 rounded-xl border text-xs font-medium transition-all cursor-pointer ${filterFireplace ? 'bg-yellow-900/30 border-yellow-500 text-white' : 'bg-zinc-800/60 border-zinc-700/60 text-zinc-400 hover:text-zinc-200'}`}
                >
                  <span className="flex items-center gap-2"><Flame size={14} className={filterFireplace ? "text-yellow-400" : "text-zinc-500"}/> Stufa / Camino presente</span>
                  <div className={`w-4 h-4 rounded border flex items-center justify-center ${filterFireplace ? 'bg-yellow-500 border-yellow-400' : 'border-zinc-600'}`}>{filterFireplace && <CheckCircle2 size={12} className="text-white"/>}</div>
                </button>

                <button 
                  onClick={() => setFilterOpen(!filterOpen)} 
                  className={`w-full flex items-center justify-between p-2.5 rounded-xl border text-xs font-medium transition-all cursor-pointer ${filterOpen ? 'bg-emerald-900/30 border-emerald-500 text-white' : 'bg-zinc-800/60 border-zinc-700/60 text-zinc-400 hover:text-zinc-200'}`}
                >
                  <span className="flex items-center gap-2"><Unlock size={14} className={filterOpen ? "text-emerald-400" : "text-zinc-500"}/> Accesso libero / Senza chiavi</span>
                  <div className={`w-4 h-4 rounded border flex items-center justify-center ${filterOpen ? 'bg-emerald-500 border-emerald-400' : 'border-zinc-600'}`}>{filterOpen && <CheckCircle2 size={12} className="text-white"/>}</div>
                </button>

                <button 
                  onClick={() => setFilterFee(!filterFee)} 
                  className={`w-full flex items-center justify-between p-2.5 rounded-xl border text-xs font-medium transition-all cursor-pointer ${filterFee ? 'bg-emerald-900/30 border-emerald-500 text-white' : 'bg-zinc-800/60 border-zinc-700/60 text-zinc-400 hover:text-zinc-200'}`}
                >
                  <span className="flex items-center gap-2"><Coins size={14} className={filterFee ? "text-emerald-400" : "text-zinc-500"}/> Gratuito (senza tariffa)</span>
                  <div className={`w-4 h-4 rounded border flex items-center justify-center ${filterFee ? 'bg-emerald-500 border-emerald-400' : 'border-zinc-600'}`}>{filterFee && <CheckCircle2 size={12} className="text-white"/>}</div>
                </button>

                <button 
                  onClick={() => setShowFavoritesOnly(!showFavoritesOnly)} 
                  className={`w-full flex items-center justify-between p-2.5 rounded-xl border text-xs font-medium transition-all cursor-pointer ${showFavoritesOnly ? 'bg-red-900/30 border-red-500 text-white' : 'bg-zinc-800/60 border-zinc-700/60 text-zinc-400 hover:text-zinc-200'}`}
                >
                  <span className="flex items-center gap-2"><Heart size={14} className={showFavoritesOnly ? "text-red-400 fill-red-400" : "text-zinc-500"}/> Solo i miei preferiti</span>
                  <div className={`w-4 h-4 rounded border flex items-center justify-center ${showFavoritesOnly ? 'bg-red-500 border-red-400' : 'border-zinc-600'}`}>{showFavoritesOnly && <CheckCircle2 size={12} className="text-white"/>}</div>
                </button>
              </div>
            </section>

            <section>
              <div className="flex items-center justify-between mb-3">
                <h3 className="text-xs font-bold text-zinc-500 uppercase tracking-wider">Posti Letto Minimi</h3>
                <span className="text-xs font-mono font-bold text-orange-500">{minCapacity === 0 ? 'Qualsiasi' : `${minCapacity}+`}</span>
              </div>
              <div className="grid grid-cols-5 gap-1.5">
                {[0, 2, 4, 6, 10].map((cap) => (
                  <button
                    key={cap}
                    onClick={() => setMinCapacity(cap)}
                    className={`py-1.5 text-xs font-bold rounded-lg border transition-all cursor-pointer ${minCapacity === cap ? 'bg-orange-600 border-orange-500 text-white' : 'bg-zinc-800 border-zinc-700 text-zinc-400 hover:border-zinc-600'}`}
                  >
                    {cap === 0 ? 'Tutti' : `${cap}+`}
                  </button>
                ))}
              </div>
            </section>

            <section>
              <h3 className="text-xs font-bold text-zinc-500 uppercase mb-3 tracking-wider">Esposizione Versante</h3>
              <div className="grid grid-cols-4 gap-1.5">
                {[Exposure.NORTH, Exposure.SOUTH, Exposure.EAST, Exposure.WEST].map((exp) => (
                  <button
                    key={exp}
                    onClick={() => toggleExposure(exp)}
                    className={`py-2 text-xs font-bold rounded-lg border transition-all cursor-pointer ${selectedExposures.includes(exp) ? 'bg-orange-600 border-orange-500 text-white' : 'bg-zinc-800 border-zinc-700 text-zinc-400 hover:border-zinc-600'}`}
                  >
                    {exp}
                  </button>
                ))}
              </div>
            </section>

            {/* Esportazione GPX dei Waypoint & Note */}
            <section className="pt-2 border-t border-zinc-800 space-y-2">
              <h3 className="text-xs font-bold text-zinc-500 uppercase tracking-wider flex items-center gap-1.5">
                <Download size={13} className="text-orange-500" /> Esportazione GPX (Garmin / Suunto)
              </h3>
              <div className="grid grid-cols-1 gap-2">
                <button
                  onClick={() => exportPoisToGpx('saved')}
                  className="w-full py-2 px-3 bg-zinc-800 hover:bg-zinc-700 text-zinc-200 rounded-xl text-xs font-bold flex items-center justify-between transition-colors border border-zinc-700 cursor-pointer"
                >
                  <span className="flex items-center gap-2">
                    <Heart size={13} className="text-red-400" /> Esporta Preferiti, Waypoint & Note
                  </span>
                  <span className="text-[10px] font-mono bg-zinc-900 px-1.5 py-0.5 rounded text-zinc-400">.GPX</span>
                </button>
                <button
                  onClick={() => exportPoisToGpx('filtered')}
                  disabled={filteredPois.length === 0}
                  className="w-full py-2 px-3 bg-zinc-800 hover:bg-zinc-700 disabled:opacity-40 disabled:cursor-not-allowed text-zinc-200 rounded-xl text-xs font-bold flex items-center justify-between transition-colors border border-zinc-700 cursor-pointer"
                >
                  <span className="flex items-center gap-2">
                    <MapPin size={13} className="text-orange-400" /> Esporta Punti Filtrati ({filteredPois.length})
                  </span>
                  <span className="text-[10px] font-mono bg-zinc-900 px-1.5 py-0.5 rounded text-zinc-400">.GPX</span>
                </button>
              </div>
            </section>

            <section className="pt-2 border-t border-zinc-800 space-y-2">
              <button
                onClick={() => {
                  setSelectedTypes([]);
                  setMinAltitude(0);
                  setMaxAltitude(4810);
                  setSelectedExposures([]);
                  setFilterWater(false);
                  setFilterRoof(false);
                  setMinCapacity(0);
                  setFilterFireplace(false);
                  setFilterFee(false);
                  setFilterOpen(false);
                  setShowFavoritesOnly(false);
                  showToast("Filtri reimpostati");
                }}
                className="w-full py-2.5 bg-zinc-800 hover:bg-zinc-700 text-zinc-300 rounded-xl text-xs font-bold flex items-center justify-center gap-2 transition-colors border border-zinc-700 cursor-pointer"
              >
                <RefreshCw size={14}/> Reimposta Tutti i Filtri
              </button>
              
              <button 
                onClick={async () => { 
                  if (!confirmClearDb) {
                    setConfirmClearDb(true);
                    setTimeout(() => setConfirmClearDb(false), 4000);
                    return;
                  }
                  setConfirmClearDb(false);
                  await dbService.clearAll(); 
                  setAllPois([...MOCK_POIS, ...REGIONAL_VENETO_TRENTINO_POIS]); 
                  showToast("Database locale svuotato e ripristinato"); 
                }} 
                className={`w-full py-2 border rounded-xl text-xs font-bold transition-colors cursor-pointer ${
                  confirmClearDb 
                    ? 'bg-red-600 text-white border-red-500 animate-pulse' 
                    : 'bg-red-900/20 hover:bg-red-900/40 border-red-800/60 text-red-400'
                }`}
              >
                {confirmClearDb ? 'Tocca di nuovo per confermare svuotamento' : 'Svuota Database Locale'}
              </button>
            </section>
          </div>

          {/* Sticky Sidebar Footer CTA */}
          <div className="p-4 border-t border-zinc-800 bg-zinc-900/95 backdrop-blur shrink-0">
            <button
              onClick={() => setIsSidebarOpen(false)}
              className="w-full py-2.5 px-4 bg-orange-600 hover:bg-orange-500 active:bg-orange-700 text-white rounded-xl text-xs font-bold flex items-center justify-center gap-2 shadow-lg transition-colors cursor-pointer"
            >
              <span>Applica e mostra ({filteredPois.length} punti)</span>
            </button>
          </div>
        </div>
      </aside>

      <main className="flex-1 relative h-full w-full">
        {/* Header Controls */}
        <header className="absolute top-4 left-4 right-4 z-[2000] flex flex-col gap-2.5 pointer-events-none">
           <div className="flex items-center gap-2 w-full max-w-lg mx-auto pointer-events-auto">
             <button onClick={() => setViewMode(v => v === 'list' ? 'map' : 'list')} className="w-11 h-11 bg-zinc-900/95 backdrop-blur border border-zinc-800 rounded-xl flex items-center justify-center shadow-xl text-zinc-300 hover:text-white transition-all shrink-0 cursor-pointer" title={viewMode === 'list' ? 'Passa alla Mappa' : 'Passa alla Lista'}> {viewMode === 'list' ? <MapIcon size={20}/> : <List size={20}/>} </button>
             <div ref={searchContainerRef} className="flex-1 relative shadow-xl">
               <form onSubmit={handleGlobalSearch} className="w-full relative">
                 <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-zinc-400 pointer-events-none"/>
                 <input type="text" value={searchQuery} onChange={e => setSearchQuery(e.target.value)} onFocus={() => searchQuery.length >= 3 && setShowSuggestions(true)} placeholder={isOffline ? "Cerca offline..." : "Cerca Luogo..."} className="w-full h-11 bg-zinc-900/95 backdrop-blur border border-zinc-800 rounded-xl pl-10 pr-10 text-sm focus:ring-2 focus:ring-orange-500 outline-none text-zinc-200 placeholder:text-zinc-500 transition-all"/>
                 {isGlobalSearching ? (
                   <Loader2 className="absolute right-3 top-1/2 -translate-y-1/2 w-4 h-4 text-orange-500 animate-spin"/>
                 ) : searchQuery.length > 0 ? (
                   <button
                     type="button"
                     onClick={() => {
                       setSearchQuery('');
                       setShowSuggestions(false);
                     }}
                     className="absolute right-2.5 top-1/2 -translate-y-1/2 p-1 rounded-lg text-zinc-400 hover:text-white hover:bg-zinc-800 transition-colors cursor-pointer"
                     title="Cancella ricerca"
                   >
                     <X size={14} />
                   </button>
                 ) : isOffline ? (
                   <WifiOff className="absolute right-3 top-1/2 -translate-y-1/2 w-4 h-4 text-orange-500"/>
                 ) : null}
               </form>
               {/* AUTOCOMPLETE DROPDOWN (ONLINE + OFFLINE DB LOCALE) */}
               {showSuggestions && searchSuggestions.length > 0 && (
                   <div className="absolute top-full left-0 right-0 mt-2 bg-zinc-900 border border-zinc-700 rounded-xl shadow-2xl overflow-hidden max-h-60 overflow-y-auto z-[3000] animate-in fade-in slide-in-from-top-2">
                       {searchSuggestions.map((suggestion) => (
                           <div 
                                key={suggestion.id} 
                                onClick={() => handleSuggestionClick(suggestion)}
                                className="px-4 py-3 hover:bg-zinc-800 cursor-pointer border-b border-zinc-800 last:border-0 flex items-center gap-3 transition-colors"
                           >
                               <div className="w-8 h-8 rounded-full bg-zinc-800 border border-zinc-700 flex items-center justify-center text-zinc-400 shrink-0">
                                   {suggestion.type === POIType.REFUGE ? <Home size={14}/> : suggestion.type === POIType.BIVOUAC ? <Tent size={14}/> : suggestion.type === POIType.FOUNTAIN ? <Droplets size={14}/> : <MapPin size={14}/>}
                               </div>
                               <div className="min-w-0">
                                   <div className="text-sm font-bold text-zinc-200 truncate">{suggestion.name}</div>
                                   <div className="text-[10px] text-zinc-500 truncate">{suggestion.description}</div>
                               </div>
                           </div>
                       ))}
                   </div>
               )}
             </div>
             {(() => {
               const activeCount = selectedTypes.length + (minAltitude > 0 || maxAltitude < 4810 ? 1 : 0) + (filterWater ? 1 : 0) + (filterRoof ? 1 : 0) + (filterFireplace ? 1 : 0) + (filterOpen ? 1 : 0) + (filterFee ? 1 : 0) + (showFavoritesOnly ? 1 : 0) + (minCapacity > 0 ? 1 : 0) + (selectedExposures.length > 0 ? 1 : 0) + (filterByTrack ? 1 : 0);
               return (
                 <button onClick={() => setIsSidebarOpen(true)} className={`relative w-11 h-11 bg-zinc-900/95 backdrop-blur border rounded-xl flex items-center justify-center shadow-xl transition-all shrink-0 cursor-pointer ${activeCount > 0 ? 'border-orange-500 text-orange-500' : 'border-zinc-800 text-zinc-300 hover:text-white'}`} title="Apri filtri">
                   <Filter size={18}/>
                   {activeCount > 0 && (
                     <span className="absolute -top-1.5 -right-1.5 min-w-[18px] h-[18px] px-1 rounded-full bg-orange-600 text-white text-[10px] font-bold flex items-center justify-center border border-zinc-950 shadow">
                       {activeCount}
                     </span>
                   )}
                 </button>
               );
             })()}
          </div>
          <div className="flex justify-center flex-wrap gap-1.5 animate-in fade-in slide-in-from-top-2 pointer-events-auto max-w-lg mx-auto"> 
             {showFavoritesOnly && (<button onClick={() => setShowFavoritesOnly(false)} className="px-2.5 py-0.5 bg-red-600/95 hover:bg-red-500 shadow-md rounded-full text-[10px] font-bold text-white border border-red-500 flex items-center gap-1 cursor-pointer"><Heart size={10} className="fill-white"/> Preferiti <X size={10} className="opacity-75"/></button>)} 
             {selectedTypes.length > 0 && selectedTypes.length < 5 && (
                selectedTypes.map(st => (
                  <button 
                    key={st} 
                    onClick={() => toggleType(st)}
                    className="px-2.5 py-0.5 bg-orange-600/95 hover:bg-orange-500 shadow-md rounded-full text-[10px] font-bold text-white border border-orange-500 flex items-center gap-1 cursor-pointer transition-transform active:scale-95"
                    title="Tocca per rimuovere"
                  >
                     {st === POIType.BIVOUAC ? <Tent size={10}/> : st === POIType.REFUGE ? <Home size={10}/> : st === POIType.FOUNTAIN ? <Droplets size={10}/> : <MapPin size={10}/>}
                     {st}
                     <X size={10} className="opacity-70 hover:opacity-100 ml-0.5"/>
                  </button>
                ))
             )}
             {filterWater && <button onClick={() => setFilterWater(false)} className="px-2.5 py-0.5 bg-blue-600/95 hover:bg-blue-500 shadow-md rounded-full text-[10px] font-bold text-white border border-blue-500 flex items-center gap-1 cursor-pointer">Acqua <X size={10} className="opacity-75"/></button>} 
             {filterByTrack && <button onClick={() => setFilterByTrack(false)} className="px-2.5 py-0.5 bg-purple-600/95 hover:bg-purple-500 shadow-md rounded-full text-[10px] font-bold text-white border border-purple-500 flex items-center gap-1 cursor-pointer"><Route size={10}/> Sul Percorso <X size={10} className="opacity-75"/></button>} 
          </div>

          {/* --- [MODULAR FEATURE 4] TACTICAL COMPASS & TARGET LOCK HUD PILL --- */}
          {targetLock && (() => {
            const origin = userLocation || mapViewState.current.center;
            const originAlt = currentStatsTrack?.points?.[0]?.ele || 1200;
            const cai = computeCaiWalkingEstimate(
              origin.lat,
              origin.lng,
              originAlt,
              targetLock.lat,
              targetLock.lng,
              targetLock.altitude || originAlt
            );
            const relAngle = (cai.bearingDeg - userHeading + 360) % 360;
            return (
              <div className="pointer-events-auto mx-auto w-full max-w-md bg-zinc-950/95 backdrop-blur-md border border-cyan-500/50 rounded-2xl px-3 py-2 shadow-2xl flex items-center justify-between gap-2 animate-in fade-in slide-in-from-top-2">
                <button
                  onClick={() => {
                    if (mapRef.current) {
                      mapRef.current.flyTo([targetLock.lat, targetLock.lng], Math.max(mapRef.current.getZoom(), 14), { duration: 0.8 });
                    }
                  }}
                  className="flex items-center gap-2.5 min-w-0 text-left cursor-pointer group"
                  title="Centra mappa sulla destinazione bloccata"
                >
                  <div className="w-8 h-8 rounded-xl bg-cyan-500/15 border border-cyan-500/40 flex items-center justify-center text-cyan-400 shrink-0">
                    <Navigation
                      size={15}
                      style={{ transform: `rotate(${relAngle}deg)` }}
                      className="transition-transform duration-200"
                    />
                  </div>
                  <div className="min-w-0">
                    <div className="flex items-center gap-1.5">
                      <span className="text-[9px] font-mono font-bold uppercase px-1.5 py-0.2 rounded bg-cyan-500/20 text-cyan-300 border border-cyan-500/30">
                        TARGET
                      </span>
                      <span className="text-xs font-bold text-white truncate group-hover:text-cyan-300 transition-colors">
                        {targetLock.name}
                      </span>
                    </div>
                    <div className="flex items-center gap-2 text-[10px] font-mono text-zinc-300 mt-0.5 flex-wrap">
                      <span className="text-cyan-400 font-bold">
                        {cai.linearDistKm < 1 ? `${Math.round(cai.linearDistKm * 1000)}m` : `${cai.linearDistKm.toFixed(1)}km`}
                      </span>
                      <span>•</span>
                      <span>{cai.bearingDeg}° {cai.bearingCardinal}</span>
                      {targetLock.altitude ? (
                        <>
                          <span>•</span>
                          <span className={cai.deltaH >= 0 ? 'text-emerald-400' : 'text-orange-400'}>
                            {cai.deltaH >= 0 ? `+${cai.deltaH}m` : `${cai.deltaH}m`}
                          </span>
                        </>
                      ) : null}
                      <span>•</span>
                      <span className="text-zinc-400">CAI ~{cai.caiTimeFormatted}</span>
                    </div>
                  </div>
                </button>
                <button
                  onClick={() => {
                    setTargetLock(null);
                    showToast("Target Lock disattivato");
                  }}
                  className="p-1.5 rounded-lg bg-zinc-900 hover:bg-zinc-800 text-zinc-400 hover:text-white border border-zinc-800 shrink-0 cursor-pointer"
                  title="Sblocca Target"
                >
                  <X size={14} />
                </button>
              </div>
            );
          })()}

          {/* --- [MODULAR FEATURE 1.3] PIANIFICATORE RAPIDO "AGGIUNGI AL TOUR" HUD & DRAWER --- */}
          {tourWaypoints.length > 0 && (
            <div className="pointer-events-auto mx-auto w-full max-w-md bg-zinc-950/95 backdrop-blur-md border border-emerald-500/50 rounded-2xl px-3 py-2 shadow-2xl animate-in fade-in slide-in-from-top-2">
              <div className="flex items-center justify-between gap-2">
                <button
                  type="button"
                  onClick={() => setIsTourPlannerOpen(prev => !prev)}
                  className="flex items-center gap-2.5 min-w-0 text-left cursor-pointer flex-1"
                  title="Apri / Chiudi dettagli Pianificatore Tour"
                >
                  <div className="w-8 h-8 rounded-xl bg-emerald-500/15 border border-emerald-500/40 flex items-center justify-center text-emerald-400 shrink-0 font-mono text-xs font-black">
                    {isComputingTour ? <Loader2 size={14} className="animate-spin" /> : tourWaypoints.length}
                  </div>
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-1.5">
                      <span className="text-[9px] font-mono font-bold uppercase px-1.5 py-0.2 rounded bg-emerald-500/20 text-emerald-300 border border-emerald-500/30">
                        TOUR PLANNER
                      </span>
                      <span className="text-xs font-bold text-white truncate">
                        {tourWaypoints.length === 1
                          ? `1. ${tourWaypoints[0].name} (Aggiungi 2ª tappa)`
                          : `${tourWaypoints[0].name} → ${tourLoopBack ? tourWaypoints[0].name : tourWaypoints[tourWaypoints.length - 1].name}`}
                      </span>
                    </div>
                    {computedTourRoute ? (
                      <div className="flex items-center gap-2 text-[10px] font-mono text-zinc-300 mt-0.5 flex-wrap">
                        <span className="text-emerald-400 font-bold">
                          {computedTourRoute.stats.totalDistance.toFixed(1)} km
                        </span>
                        <span>•</span>
                        <span className="text-orange-400">+{computedTourRoute.stats.elevationGain}m</span>
                        <span>•</span>
                        <span className="text-sky-400">-{computedTourRoute.stats.elevationLoss}m</span>
                        <span>•</span>
                        <span className="text-zinc-300">
                          ~{Math.floor((computedTourRoute.stats.totalTimeSeconds || 0) / 3600)}h{' '}
                          {Math.round(((computedTourRoute.stats.totalTimeSeconds || 0) % 3600) / 60)}m
                        </span>
                      </div>
                    ) : (
                      <div className="text-[10px] text-zinc-400 mt-0.5">
                        {isComputingTour
                          ? 'Calcolo percorso sui sentieri OSM in corso...'
                          : 'Seleziona un altro Bivacco, Rifugio o Punto sulla mappa e premi +Tour'}
                      </div>
                    )}
                  </div>
                </button>

                <div className="flex items-center gap-1 shrink-0">
                  {computedTourRoute && (
                    <button
                      type="button"
                      onClick={promoteTourToActiveTrack}
                      className="px-2 py-1 rounded-lg bg-emerald-600 hover:bg-emerald-500 text-white text-[10px] font-bold transition-colors cursor-pointer shadow"
                      title="Analizza profilo altimetrico, fondo, grado SAC e meteo di questo Tour"
                    >
                      Analizza
                    </button>
                  )}
                  <button
                    type="button"
                    onClick={() => setIsTourPlannerOpen(prev => !prev)}
                    className="p-1.5 rounded-lg bg-zinc-900 hover:bg-zinc-800 text-zinc-300 border border-zinc-800 cursor-pointer"
                    title={isTourPlannerOpen ? 'Comprimi' : 'Espandi tappe'}
                  >
                    {isTourPlannerOpen ? <ChevronUp size={14} /> : <ChevronDown size={14} />}
                  </button>
                  <button
                    type="button"
                    onClick={clearTourPlanner}
                    className="p-1.5 rounded-lg bg-zinc-900 hover:bg-zinc-800 text-zinc-400 hover:text-red-400 border border-zinc-800 cursor-pointer"
                    title="Svuota Tour"
                  >
                    <Trash2 size={13} />
                  </button>
                </div>
              </div>

              {/* Pannello Espanso Tappe & Azioni Komoot-Style */}
              {isTourPlannerOpen && (
                <div className="mt-2.5 pt-2.5 border-t border-zinc-800/90 space-y-2.5 max-h-[52vh] overflow-y-auto">
                  {/* Azioni Rapide Ordine / Anello / Partenza GPS */}
                  <div className="flex items-center justify-between gap-1.5 flex-wrap">
                    <div className="flex items-center gap-1.5 flex-wrap">
                      {userLocation && !tourWaypoints.some(w => w.id === 'gps-origin') && (
                        <button
                          type="button"
                          onClick={async () => {
                            const alt = await fetchAltitudeForCoordinate(userLocation.lat, userLocation.lng).catch(() => null);
                            setTourWaypoints(prev => [
                              {
                                id: 'gps-origin',
                                name: 'La Mia Posizione GPS',
                                lat: userLocation.lat,
                                lng: userLocation.lng,
                                altitude: alt,
                                category: 'GPS',
                              },
                              ...prev,
                            ]);
                            showToast("Posizione GPS impostata come Partenza (Tappa 1)");
                          }}
                          className="px-2 py-1 rounded-lg bg-blue-950/70 hover:bg-blue-900/70 border border-blue-500/40 text-blue-300 text-[10px] font-bold flex items-center gap-1 cursor-pointer"
                        >
                          <Locate size={11} /> + Parti da GPS
                        </button>
                      )}
                      {tourWaypoints.length >= 2 && (
                        <>
                          <button
                            type="button"
                            onClick={reverseTourWaypoints}
                            className="px-2 py-1 rounded-lg bg-zinc-900 hover:bg-zinc-800 border border-zinc-700 text-zinc-300 text-[10px] font-bold flex items-center gap-1 cursor-pointer"
                            title="Inverti ordine tappe"
                          >
                            <RefreshCw size={10} /> Inverti Giro
                          </button>
                          <button
                            type="button"
                            onClick={() => setTourLoopBack(prev => !prev)}
                            className={`px-2 py-1 rounded-lg border text-[10px] font-bold flex items-center gap-1 cursor-pointer transition-colors ${
                              tourLoopBack
                                ? 'bg-emerald-600/25 border-emerald-500 text-emerald-300'
                                : 'bg-zinc-900 hover:bg-zinc-800 border-zinc-700 text-zinc-400'
                            }`}
                            title="Chiudi l'itinerario tornando alla prima tappa"
                          >
                            <Route size={11} /> {tourLoopBack ? 'Anello Attivo ✓' : 'Chiudi ad Anello'}
                          </button>
                        </>
                      )}
                    </div>
                    {computedTourRoute && (
                      <span className="text-[9px] font-mono text-zinc-500">
                        {computedTourRoute.routingSource === 'brouter_hiking'
                          ? 'Sentieri Alpini 3D (BRouter)'
                          : computedTourRoute.routingSource === 'osm_foot'
                          ? 'Sentieri OSM (Foot)'
                          : 'Traccia Diretta DEM'}
                      </span>
                    )}
                  </div>

                  {/* Lista Tappe Riordinabile */}
                  <div className="space-y-1.5">
                    {tourWaypoints.map((wp, idx) => {
                      const legAfter = computedTourRoute?.legs?.[idx];
                      return (
                        <div key={`${wp.id}-${idx}`} className="space-y-1">
                          <div className="flex items-center justify-between gap-2 bg-zinc-900/90 border border-zinc-800 rounded-xl px-2.5 py-1.5">
                            <button
                              type="button"
                              onClick={() => {
                                if (mapRef.current) {
                                  mapRef.current.flyTo([wp.lat, wp.lng], Math.max(mapRef.current.getZoom(), 14), { duration: 0.6 });
                                }
                              }}
                              className="flex items-center gap-2 min-w-0 text-left flex-1 cursor-pointer"
                            >
                              <span
                                className={`w-5 h-5 rounded-full text-[10px] font-mono font-black flex items-center justify-center shrink-0 ${
                                  idx === 0
                                    ? 'bg-emerald-600 text-white'
                                    : idx === tourWaypoints.length - 1 && !tourLoopBack
                                    ? 'bg-orange-600 text-white'
                                    : 'bg-zinc-800 text-emerald-400 border border-emerald-500/40'
                                }`}
                              >
                                {idx + 1}
                              </span>
                              <div className="min-w-0 flex-1">
                                <div className="text-xs font-bold text-white truncate">{wp.name}</div>
                                <div className="text-[9px] font-mono text-zinc-400">
                                  {wp.category ? `${wp.category} · ` : ''}
                                  {wp.altitude ? `${wp.altitude}m` : `${wp.lat.toFixed(4)}, ${wp.lng.toFixed(4)}`}
                                </div>
                              </div>
                            </button>

                            <div className="flex items-center gap-1 shrink-0">
                              <button
                                type="button"
                                disabled={idx === 0}
                                onClick={() => moveTourWaypoint(idx, -1)}
                                className="p-1 rounded bg-zinc-800 hover:bg-zinc-700 disabled:opacity-30 text-zinc-300 cursor-pointer"
                                title="Sposta tappa in su"
                              >
                                <ChevronUp size={12} />
                              </button>
                              <button
                                type="button"
                                disabled={idx === tourWaypoints.length - 1}
                                onClick={() => moveTourWaypoint(idx, 1)}
                                className="p-1 rounded bg-zinc-800 hover:bg-zinc-700 disabled:opacity-30 text-zinc-300 cursor-pointer"
                                title="Sposta tappa in giù"
                              >
                                <ChevronDown size={12} />
                              </button>
                              <button
                                type="button"
                                onClick={() => toggleWaypointInTour(wp)}
                                className="p-1 rounded bg-zinc-800 hover:bg-red-950/60 text-zinc-400 hover:text-red-400 cursor-pointer"
                                title="Rimuovi tappa"
                              >
                                <X size={12} />
                              </button>
                            </div>
                          </div>

                          {/* Inter-tappa: distanza, dislivello e tempo parziale CAI */}
                          {legAfter && (
                            <div className="pl-6 flex items-center gap-2 text-[9px] font-mono text-zinc-400">
                              <span className="text-emerald-500">↓</span>
                              <span>{legAfter.distanceKm.toFixed(1)} km</span>
                              <span>·</span>
                              <span className="text-orange-400">+{legAfter.elevationGain}m</span>
                              <span>·</span>
                              <span className="text-sky-400">-{legAfter.elevationLoss}m</span>
                              <span>·</span>
                              <span>
                                ~{Math.floor(legAfter.durationMinutes / 60) > 0 ? `${Math.floor(legAfter.durationMinutes / 60)}h ` : ''}
                                {legAfter.durationMinutes % 60}m
                              </span>
                            </div>
                          )}
                        </div>
                      );
                    })}
                  </div>

                  {/* CTA Finali: Analisi Completa nel Pannello GPX & Esportazione .GPX */}
                  {computedTourRoute && (
                    <div className="grid grid-cols-2 gap-2 pt-1">
                      <button
                        type="button"
                        onClick={promoteTourToActiveTrack}
                        className="py-2 px-3 rounded-xl bg-emerald-600 hover:bg-emerald-500 text-white text-xs font-bold flex items-center justify-center gap-1.5 transition-colors cursor-pointer shadow-md"
                      >
                        <BarChart3 size={14} /> Analizza Profilo & Meteo
                      </button>
                      <button
                        type="button"
                        onClick={exportPlannedTourToGpx}
                        className="py-2 px-3 rounded-xl bg-zinc-800 hover:bg-zinc-700 border border-zinc-700 text-zinc-200 text-xs font-bold flex items-center justify-center gap-1.5 transition-colors cursor-pointer"
                      >
                        <Download size={14} className="text-orange-400" /> Esporta Tour .GPX
                      </button>
                    </div>
                  )}
                </div>
              )}
            </div>
          )}
        </header>

        {viewMode === 'list' ? (
          <div className="h-full w-full bg-zinc-950 overflow-y-auto touch-scroll">
            <div className="pt-28 px-6 pb-32 min-h-full max-w-7xl mx-auto">
              {filteredPois.length > 0 ? (
                <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-5">
                  {filteredPois.map(p => (
                    <div 
                      id={`poi-card-${p.id}`} 
                      key={p.id} 
                      onClick={() => { setSelectedPoi(p); setIsDetailPanelOpen(true); }} 
                      className={`bg-zinc-900 rounded-2xl overflow-hidden hover:border-zinc-600 transition-all cursor-pointer group shadow-lg relative p-5 flex flex-col h-full justify-between border ${highlightedPoiId === p.id ? 'border-orange-500 ring-2 ring-orange-500' : 'border-zinc-800'}`}
                    >
                      <div className="mb-4"> <div className="flex justify-between items-start mb-2"> <h4 className="font-bold text-lg text-zinc-100 leading-tight pr-2">{p.name}</h4> <button onClick={(e) => toggleFavorite(e, p)} className={`w-8 h-8 shrink-0 flex items-center justify-center rounded-full border transition-all ${favorites.has(p.id) ? 'bg-red-900/30 text-red-500 border-red-500/50' : 'bg-zinc-800 text-zinc-400 border-zinc-700 hover:text-zinc-200'}`}> <Heart size={16} className={favorites.has(p.id) ? "fill-red-500" : ""}/> </button> </div> <div className="flex items-center gap-2 mb-3"> <span className={`px-2 py-0.5 rounded text-[10px] font-bold uppercase tracking-wide border ${p.type === POIType.REFUGE ? 'bg-rose-600/20 text-rose-400 border-rose-600/30' : p.type === POIType.FOUNTAIN ? 'bg-sky-600/20 text-sky-400 border-sky-600/30' : p.type === POIType.PICNIC ? 'bg-emerald-600/20 text-emerald-400 border-emerald-600/30' : p.type === POIType.VIEWPOINT ? 'bg-purple-600/20 text-purple-400 border-purple-600/30' : 'bg-orange-600/20 text-orange-500 border-orange-600/30'}`}>{p.type}</span> <span className="text-zinc-400 text-xs font-mono">{p.altitude > 0 ? `${p.altitude}m` : 'Rilevamento...'}</span> </div> <p className="text-sm text-zinc-400 line-clamp-2">{p.description}</p> </div>
                      <div className="grid grid-cols-2 gap-2 mb-4"> {p.capacity ? ( <div className="flex items-center gap-2 text-xs text-zinc-300 bg-zinc-800/50 p-2 rounded-lg"> <BedDouble size={14} className="text-orange-500 shrink-0"/> <span>{p.capacity} Posti</span> </div> ) : ( <div className="flex items-center gap-2 text-xs text-zinc-500 bg-zinc-800/20 p-2 rounded-lg"> <Tent size={14} className="text-zinc-600 shrink-0"/> <span>N/D</span> </div> )} {p.hasFireplace || p.hasRoof ? ( <div className="flex items-center gap-2 text-xs text-zinc-300 bg-zinc-800/50 p-2 rounded-lg"> {p.hasFireplace ? <Flame size={14} className="text-yellow-500 shrink-0"/> : <Home size={14} className="text-zinc-400 shrink-0"/>} <span>{p.hasFireplace ? 'Stufa' : 'Chiuso'}</span> </div> ) : ( <div className="flex items-center gap-2 text-xs text-zinc-500 bg-zinc-800/20 p-2 rounded-lg"> <Home size={14} className="text-zinc-600 shrink-0"/> <span>Aperto</span> </div> )} {p.operator ? ( <div className="flex items-center gap-2 text-xs text-zinc-300 bg-zinc-800/50 p-2 rounded-lg"> <Building size={14} className="text-blue-400 shrink-0"/> <span className="truncate">Gestito</span> </div> ) : ( <div className="flex items-center gap-2 text-xs text-zinc-400 bg-zinc-800/30 p-2 rounded-lg"> <Building size={14} className="text-zinc-600 shrink-0"/> <span>Non gestito</span> </div> )} {p.hasWater ? ( <div className="flex items-center gap-2 text-xs text-zinc-300 bg-zinc-800/50 p-2 rounded-lg"> <Droplets size={14} className="text-blue-500 shrink-0"/> <span>Acqua</span> </div> ) : ( <div className="flex items-center gap-2 text-xs text-zinc-500 bg-zinc-800/20 p-2 rounded-lg"> <Droplets size={14} className="text-zinc-600 shrink-0"/> <span>No acqua</span> </div> )} </div>
                      {p.userNote && ( <div className="mt-auto bg-emerald-950/30 border border-emerald-900/50 rounded-lg p-2 flex items-start gap-2"> <Edit3 size={12} className="text-emerald-500 mt-0.5 shrink-0"/> <p className="text-[10px] text-emerald-200/80 italic line-clamp-2">{p.userNote}</p> </div> )}
                    </div>
                  ))}
                </div>
              ) : (
                <div className="flex flex-col items-center justify-center py-24 text-zinc-500 text-center">
                  <Filter size={44} className="mb-4 text-zinc-700"/>
                  <p className="text-sm font-bold text-zinc-300 mb-1">Nessun punto di interesse visibile</p>
                  <p className="text-xs text-zinc-500 max-w-xs mb-4">Seleziona una o più tipologie (Bivacco, Rifugio, Fontana...) dal pannello filtri per esplorare i punti.</p>
                  <button
                    onClick={() => setIsSidebarOpen(true)}
                    className="px-4 py-2 bg-orange-600 hover:bg-orange-500 text-white rounded-xl text-xs font-bold transition-colors cursor-pointer shadow"
                  >
                    Apri Filtri
                  </button>
                </div>
              )}
            </div>
          </div>
        ) : (
          <div ref={mapOuterWrapperRef} className="h-full w-full relative overflow-hidden bg-zinc-950">
             {/* Canvas Mappa Quadrato Oversize (146vmax × 146vmax > diagonale √2·vmax): copre il 100% dello schermo a qualsiasi angolo 0°-360° senza bordi rettangolari né zoom-jump */}
             <div
               ref={mapContainerRef}
               className=" absolute left-1/2 top-1/2 will-change-transform"
               style={{
                 width: '146vmax',
                 height: '146vmax',
                 transform: `translate(-50%, -50%) rotate(${mapBearing}deg)`,
                 transformOrigin: 'center center',
               }}
             />
             {isSearchingArea && (
                <div className="absolute top-[72px] left-1/2 -translate-x-1/2 z-[2500] pointer-events-none animate-in fade-in slide-in-from-top-2">
                     <span className="px-3 py-1 bg-zinc-900/95 backdrop-blur shadow-xl rounded-full text-[11px] font-bold text-orange-400 border border-orange-500/50 flex items-center gap-2">
                        <Loader2 size={12} className="animate-spin"/> Aggiorno mappa...
                     </span>
                </div>
             )}
             {viewMode === 'map' && centerWeather && !isOffline && !inspectedLocation && !isTrackPanelOpen && (
                 <div onClick={() => handleOpenWeatherPanel()} className={`absolute left-4 z-[1000] bg-zinc-900/90 backdrop-blur border border-zinc-700/50 rounded-2xl p-2.5 shadow-2xl flex items-center gap-3 animate-in fade-in slide-in-from-bottom-4 cursor-pointer hover:bg-zinc-800 transition-all duration-300 group ${weatherOverlayActive ? 'bottom-[136px]' : 'bottom-10'}`}>
                     <div className="bg-zinc-800 rounded-xl p-1.5 flex items-center justify-center group-hover:bg-zinc-700 transition-colors"> {getWeatherIcon(centerWeather.code)} </div>
                     <div> <div className="text-xs font-bold text-white leading-none mb-0.5">{centerWeather.temp}°C</div> <div className="text-[10px] text-blue-400 font-bold flex items-center gap-1"> <Droplets size={10} className="fill-blue-400"/> {centerWeather.humidity}% </div> </div>
                 </div>
             )}

             {/* Inspected Arbitrary Map Point Card */}
             {viewMode === 'map' && inspectedLocation && !selectedPoi && !isTrackPanelOpen && (
               <div className={`absolute left-3 right-[72px] sm:left-4 sm:right-auto sm:w-88 z-[3200] bg-zinc-900/95 backdrop-blur-md border border-orange-500/60 rounded-2xl p-3.5 shadow-2xl animate-in fade-in slide-in-from-bottom-4 transition-all duration-300 ${weatherOverlayActive ? 'bottom-[136px]' : 'bottom-10'}`}>
                 <div className="flex items-start justify-between gap-2.5 mb-2.5">
                   <div className="flex items-center gap-2.5 min-w-0">
                     <div className="w-8 h-8 rounded-xl bg-orange-600/20 border border-orange-500/40 flex items-center justify-center text-orange-400 shrink-0">
                       <Compass size={16} />
                     </div>
                     <div className="min-w-0">
                       <h4 className="text-xs font-bold text-white uppercase tracking-wider truncate">Punto Selezionato</h4>
                       <p className="text-[11px] font-mono text-zinc-400 truncate">
                         {inspectedLocation.lat.toFixed(5)}° N, {inspectedLocation.lng.toFixed(5)}° E
                       </p>
                     </div>
                   </div>
                   <button 
                     onClick={clearInspectedLocation}
                     className="p-1.5 text-zinc-400 hover:text-white rounded-lg hover:bg-zinc-800 transition-colors cursor-pointer shrink-0"
                     title="Deseleziona punto"
                   >
                     <X size={16} />
                   </button>
                 </div>

                 <div className="grid grid-cols-2 gap-2 mb-2.5">
                   {/* Quota DEM */}
                   <div className="bg-zinc-800/80 border border-zinc-700/60 rounded-xl p-2 flex items-center gap-2">
                     <Mountain size={15} className="text-orange-400 shrink-0" />
                     <div className="min-w-0">
                       <div className="text-[9px] uppercase font-bold text-zinc-400">Quota DEM</div>
                       <div className="text-xs font-mono font-bold text-zinc-100 truncate">
                         {inspectedLocation.isLoadingAltitude ? (
                           <span className="flex items-center gap-1 text-zinc-400 font-sans text-[11px]">
                             <Loader2 size={11} className="animate-spin text-orange-400" /> Calcolo...
                           </span>
                         ) : inspectedLocation.altitude !== null ? (
                           `${inspectedLocation.altitude} m`
                         ) : (
                           'N/D'
                         )}
                       </div>
                     </div>
                   </div>

                   {/* Meteo Punto */}
                   <div className="bg-zinc-800/80 border border-zinc-700/60 rounded-xl p-2 flex items-center gap-2">
                     <div className="shrink-0">
                       {inspectedLocation.weather ? (
                         getWeatherIcon(inspectedLocation.weather.code)
                       ) : (
                         <Sun size={15} className="text-zinc-500" />
                       )}
                     </div>
                     <div className="min-w-0">
                       <div className="text-[9px] uppercase font-bold text-zinc-400">Meteo Punto</div>
                       <div className="text-xs font-mono font-bold text-zinc-100 truncate">
                         {inspectedLocation.isLoadingWeather ? (
                           <span className="flex items-center gap-1 text-zinc-400 font-sans text-[11px]">
                             <Loader2 size={11} className="animate-spin text-blue-400" /> Meteo...
                           </span>
                         ) : inspectedLocation.weather ? (
                           `${inspectedLocation.weather.temp}°C · ${inspectedLocation.weather.humidity}%`
                         ) : (
                           'N/D'
                         )}
                       </div>
                     </div>
                   </div>
                 </div>

                 {/* --- [MODULAR FEATURE 2] SOLAR EPHEMERIS & CAI WALKING ESTIMATE FOR INSPECTED POINT --- */}
                 {(() => {
                   const solar = computeSolarTimes(
                     inspectedLocation.lat,
                     inspectedLocation.lng,
                     inspectedLocation.altitude || 0
                   );
                   const origin = userLocation || mapViewState.current.center;
                   const originLabel = userLocation ? 'da GPS' : 'da Centro';
                   const originAlt = currentStatsTrack?.points?.[0]?.ele || 1200;
                   const cai = computeCaiWalkingEstimate(
                     origin.lat,
                     origin.lng,
                     originAlt,
                     inspectedLocation.lat,
                     inspectedLocation.lng,
                     inspectedLocation.altitude || originAlt
                   );
                   return (
                     <div className="grid grid-cols-2 gap-2 mb-2.5">
                       <div className="bg-zinc-800/60 border border-zinc-700/50 rounded-xl p-2 flex items-center gap-2">
                         <Footprints size={14} className="text-emerald-400 shrink-0" />
                         <div className="min-w-0">
                           <div className="text-[9px] uppercase font-bold text-zinc-400 truncate">
                             Stima CAI ({originLabel})
                           </div>
                           <div className="text-[11px] font-mono font-bold text-zinc-100 truncate">
                             ~{cai.caiTimeFormatted} · {cai.linearDistKm.toFixed(1)}km ({cai.bearingDeg}°{cai.bearingCardinal})
                           </div>
                         </div>
                       </div>
                       <div className="bg-zinc-800/60 border border-zinc-700/50 rounded-xl p-2 flex items-center gap-2">
                         <Sunrise size={14} className="text-amber-400 shrink-0" />
                         <div className="min-w-0">
                           <div className="text-[9px] uppercase font-bold text-zinc-400 truncate">
                             Alba / Tramonto
                           </div>
                           <div className="text-[11px] font-mono font-bold text-zinc-100 truncate">
                             {solar.sunrise} · {solar.sunset}
                           </div>
                         </div>
                       </div>
                     </div>
                   );
                 })()}

                 {/* Actions */}
                 <div className="flex items-center gap-1.5 pt-2 border-t border-zinc-800">
                   <button
                     onClick={() => {
                       const coordsStr = `${inspectedLocation.lat.toFixed(5)}, ${inspectedLocation.lng.toFixed(5)}`;
                       navigator.clipboard?.writeText(coordsStr);
                       showToast(`Coordinate copiate: ${coordsStr}`);
                     }}
                     className="flex-1 py-1.5 px-2 bg-zinc-800 hover:bg-zinc-700 text-zinc-200 text-[11px] font-semibold rounded-lg border border-zinc-700 transition-colors flex items-center justify-center gap-1 cursor-pointer"
                   >
                     <Save size={12} className="text-zinc-400 shrink-0" /> <span className="truncate">GPS</span>
                   </button>

                   <button
                     onClick={() => handleOpenWeatherPanel({ lat: inspectedLocation.lat, lng: inspectedLocation.lng })}
                     className="flex-1 py-1.5 px-2 bg-zinc-800 hover:bg-zinc-700 text-zinc-200 text-[11px] font-semibold rounded-lg border border-zinc-700 transition-colors flex items-center justify-center gap-1 cursor-pointer"
                   >
                     <Sun size={12} className="text-yellow-400 shrink-0" /> <span className="truncate">Meteo</span>
                   </button>

                   <button
                     onClick={() => {
                       const wpId = `map-pt-${inspectedLocation.lat.toFixed(4)}-${inspectedLocation.lng.toFixed(4)}`;
                       toggleWaypointInTour({
                         id: wpId,
                         name: `Punto ${inspectedLocation.altitude ? `${inspectedLocation.altitude}m` : 'Mappa'}`,
                         lat: inspectedLocation.lat,
                         lng: inspectedLocation.lng,
                         altitude: inspectedLocation.altitude,
                         category: 'Punto Mappa',
                       });
                     }}
                     className="py-1.5 px-2 bg-emerald-950/70 hover:bg-emerald-900/70 text-emerald-300 border border-emerald-500/40 text-[11px] font-semibold rounded-lg transition-colors flex items-center justify-center gap-1 cursor-pointer shrink-0"
                     title="Aggiungi questo punto come tappa del Tour"
                   >
                     <Route size={12} /> +Tour
                   </button>

                   <button
                     onClick={() => {
                       const lockId = `point-${inspectedLocation.lat.toFixed(4)}-${inspectedLocation.lng.toFixed(4)}`;
                       setTargetLock({
                         id: lockId,
                         name: `Quota ${inspectedLocation.altitude ? `${inspectedLocation.altitude}m` : 'Mappa'}`,
                         lat: inspectedLocation.lat,
                         lng: inspectedLocation.lng,
                         altitude: inspectedLocation.altitude,
                       });
                       showToast("Punto bloccato sulla Bussola Target!");
                     }}
                     className="py-1.5 px-2 bg-cyan-950/70 hover:bg-cyan-900/70 text-cyan-300 border border-cyan-500/40 text-[11px] font-semibold rounded-lg transition-colors flex items-center justify-center gap-1 cursor-pointer shrink-0"
                     title="Blocca come destinazione Bussola"
                   >
                     <Compass size={12} /> Punta
                   </button>

                   <button
                     onClick={handleSaveWaypointFromPoint}
                     className="py-1.5 px-2.5 bg-orange-600 hover:bg-orange-500 text-white text-[11px] font-semibold rounded-lg transition-colors flex items-center justify-center gap-1 cursor-pointer shadow-sm shrink-0"
                     title="Salva punto nei tuoi POI"
                   >
                     <Plus size={13} /> Salva
                   </button>
                 </div>
               </div>
             )}
          </div>
        )}

        {/* Floating Radar Player Bar */}
        {viewMode === 'map' && weatherOverlayActive && !isTrackPanelOpen && (
          <div className="absolute bottom-4 left-3 right-3 sm:left-1/2 sm:-translate-x-1/2 z-[3000] pointer-events-auto flex flex-col gap-1.5 bg-zinc-900/95 backdrop-blur-md border border-zinc-700/80 rounded-2xl px-3.5 py-2.5 shadow-2xl animate-in fade-in slide-in-from-bottom-2 w-auto sm:min-w-[400px] max-w-lg">
            {isRadarLoading ? (
              <div className="flex items-center justify-center gap-2 text-xs font-semibold text-zinc-300 py-1 px-2">
                <Loader2 size={16} className="animate-spin text-blue-400" />
                <span>Caricamento radar (-6h)...</span>
              </div>
            ) : radarFrames.length > 0 ? (
              <>
                <div className="flex items-center justify-between gap-3">
                  <div className="flex items-center gap-2.5 min-w-0">
                    <button
                      onClick={() => setIsRadarPlaying(!isRadarPlaying)}
                      className="w-8 h-8 rounded-xl bg-blue-600 hover:bg-blue-500 active:bg-blue-700 text-white flex items-center justify-center transition-colors shrink-0 shadow-md cursor-pointer"
                      title={isRadarPlaying ? 'Pausa animazione' : 'Avvia animazione'}
                    >
                      {isRadarPlaying ? <Pause size={14} className="fill-white" /> : <Play size={14} className="fill-white ml-0.5" />}
                    </button>

                    <div className="flex flex-col min-w-0">
                      <div className="flex items-center gap-1.5 flex-wrap">
                        <span className="text-xs font-mono font-bold text-white">
                          {currentFrameIndex >= 0 && radarFrames[currentFrameIndex]
                            ? new Date(radarFrames[currentFrameIndex].time * 1000).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
                            : '--:--'}
                        </span>
                        {currentFrameIndex === radarFrames.length - 1 ? (
                          <span className="text-[9px] uppercase font-bold text-emerald-400 bg-emerald-500/15 border border-emerald-500/30 px-1.5 py-0.2 rounded">
                            Adesso (Live)
                          </span>
                        ) : currentFrameIndex >= 0 && radarFrames[currentFrameIndex] ? (
                          <span className="text-[9px] font-mono font-bold text-zinc-300 bg-zinc-800 border border-zinc-700 px-1.5 py-0.2 rounded">
                            {(() => {
                              const latestT = radarFrames[radarFrames.length - 1]?.time || radarFrames[currentFrameIndex].time;
                              const diffMins = Math.max(10, Math.round((latestT - radarFrames[currentFrameIndex].time) / 60));
                              const h = Math.floor(diffMins / 60);
                              const m = diffMins % 60;
                              if (h === 0) return `-${m}m`;
                              if (m === 0) return `-${h}h`;
                              return `-${h}h ${m}m`;
                            })()}
                          </span>
                        ) : null}
                      </div>
                      <span className="text-[9px] text-zinc-400 font-medium">Storico Radar (-6h → Adesso)</span>
                    </div>
                  </div>

                  <div className="flex items-center gap-2 shrink-0">
                    <span className="text-[10px] font-mono text-zinc-400">
                      {currentFrameIndex + 1}/{radarFrames.length}
                    </span>
                    <button
                      onClick={() => setWeatherOverlayActive(false)}
                      className="p-1.5 text-zinc-400 hover:text-white rounded-lg hover:bg-zinc-800 transition-colors cursor-pointer"
                      title="Chiudi radar"
                    >
                      <X size={15} />
                    </button>
                  </div>
                </div>

                {/* Scroller Slider + Clickable dots (-6h to Adesso) */}
                <div className="flex flex-col gap-1 w-full pt-0.5">
                  <input
                    type="range"
                    min={0}
                    max={radarFrames.length - 1}
                    step={1}
                    value={currentFrameIndex >= 0 ? currentFrameIndex : 0}
                    onChange={(e) => {
                      setIsRadarPlaying(false);
                      setCurrentFrameIndex(Number(e.target.value));
                    }}
                    className="radar-slider w-full h-4"
                    title="Scorri il radar da 6 ore fa ad adesso"
                  />

                  {/* Interactive timeline step dots */}
                  <div className="flex items-center justify-between px-1 w-full">
                    {radarFrames.map((frame, idx) => (
                      <button
                        key={frame.time}
                        onClick={() => {
                          setIsRadarPlaying(false);
                          setCurrentFrameIndex(idx);
                        }}
                        className={`h-1.5 rounded-full transition-all cursor-pointer ${
                          idx === currentFrameIndex
                            ? 'w-3.5 bg-blue-500 ring-2 ring-blue-400/40'
                            : idx === radarFrames.length - 1
                            ? 'w-1.5 bg-emerald-500/80 hover:bg-emerald-400'
                            : 'w-1.5 bg-zinc-700 hover:bg-zinc-500'
                        }`}
                        title={`${new Date(frame.time * 1000).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}`}
                      />
                    ))}
                  </div>

                  {/* -6h to Adesso timeline labels */}
                  <div className="flex items-center justify-between text-[9px] font-mono text-zinc-500 px-0.5 pt-0.5">
                    <span>-6h</span>
                    <span>-4h</span>
                    <span>-2h</span>
                    <span className="text-emerald-400/90 font-bold">● Adesso</span>
                  </div>
                </div>
              </>
            ) : (
              <div className="flex items-center justify-between gap-3 text-xs text-zinc-400 px-1 py-1">
                <span>Radar temporaneamente non disponibile</span>
                <button
                  onClick={() => setWeatherOverlayActive(false)}
                  className="p-1 text-zinc-400 hover:text-white rounded hover:bg-zinc-800"
                >
                  <X size={14} />
                </button>
              </div>
            )}
          </div>
        )}

        {viewMode === 'map' && (
          <div className={`absolute right-4 z-[3000] flex flex-col items-end gap-3 pointer-events-auto transition-all duration-300 ${isTrackPanelOpen && tracks.length > 0 && !isTrackPanelExpanded ? 'bottom-[calc(40vh+12px)]' : weatherOverlayActive ? 'bottom-[136px]' : 'bottom-6'}`}>
             {/* Pulsante Bussola Dinamico: appare quando la mappa è ruotata e riporta il Nord in alto con animazione fluida */}
             {Math.abs(mapBearing % 360) > 0.5 && (
               <button
                 onClick={resetMapNorth}
                 className="w-12 h-12 bg-zinc-900/95 backdrop-blur border border-orange-500/70 rounded-2xl flex flex-col items-center justify-center shadow-2xl hover:bg-zinc-800 active:scale-95 transition-all cursor-pointer animate-in zoom-in-90 fade-in duration-150 relative group"
                 title="Riporta la mappa con il Nord in alto (0°)"
               >
                 <div
                   ref={compassNeedleRef}
                   style={{ transform: `rotate(${mapBearing}deg)` }}
                   className="w-7 h-7 flex items-center justify-center will-change-transform"
                 >
                   <svg width="24" height="24" viewBox="0 0 24 24" fill="none">
                     {/* Ago Nord (Rosso) */}
                     <polygon points="12,2 15.5,12 8.5,12" fill="#ef4444" />
                     {/* Ago Sud (Bianco/Grigio) */}
                     <polygon points="12,22 15.5,12 8.5,12" fill="#e4e4e7" />
                     <circle cx="12" cy="12" r="2" fill="#18181b" stroke="#ffffff" strokeWidth="1" />
                   </svg>
                 </div>
                 <span
                   ref={compassDegTextRef}
                   className="text-[8px] font-mono font-bold text-orange-400 leading-none -mt-0.5"
                 >
                   {Math.round((mapBearing % 360 + 360) % 360)}°
                 </span>
               </button>
             )}

             <div ref={trailsMenuRef} className="relative">
               {isTrailsMenuOpen && (
                  <div className="absolute right-14 top-0 w-[min(290px,calc(100vw-84px))] max-h-[calc(100dvh-160px)] bg-zinc-900/95 backdrop-blur-md border border-zinc-700 rounded-2xl p-4 shadow-2xl overflow-y-auto z-[4000] animate-in fade-in slide-in-from-right-3">
                    <div className="flex items-center justify-between mb-3">
                      <h4 className="text-[10px] font-bold uppercase text-zinc-400 tracking-wider flex items-center gap-2"><Route size={12} className="text-orange-500"/> Gestione Percorsi</h4>
                      <button 
                        onClick={() => setIsTrailsMenuOpen(false)} 
                        className="p-1 text-zinc-400 hover:text-white rounded-lg hover:bg-zinc-800 transition-colors cursor-pointer"
                        title="Chiudi"
                      >
                        <X size={14}/>
                      </button>
                    </div>
                    {tracks.length === 0 ? (
                        <div className="text-center p-4 border border-dashed border-zinc-700 rounded-xl bg-zinc-800/30"> <p className="text-xs text-zinc-400 mb-3">Nessuna traccia caricata.</p> <button onClick={() => fileInputRef.current?.click()} className="w-full py-2 bg-orange-600 hover:bg-orange-700 text-white rounded-lg text-xs font-bold flex items-center justify-center gap-2 transition-colors cursor-pointer"> <FileUp size={14}/> Carica GPX </button> </div>
                    ) : (
                        <div className="space-y-4">
                           {tracks.map((track) => (
                               <div key={track.id} className="flex items-center justify-between p-3 bg-zinc-800 rounded-lg border border-zinc-700 gap-3"> 
                                  <button onClick={() => centerOnTrack(track)} className="flex-1 min-w-0 text-left flex items-center gap-2 group cursor-pointer hover:bg-zinc-700/50 rounded p-1 -ml-1 transition-colors"> 
                                    <div className="w-2.5 h-2.5 rounded-full shrink-0" style={{ backgroundColor: track.color }} />
                                    <div className="overflow-x-auto hide-scrollbar whitespace-nowrap mask-linear-fade w-full">
                                       <span className="text-xs font-bold text-zinc-200 group-hover:text-white transition-colors">{track.name}</span>
                                    </div>
                                  </button> 
                                  <div className="flex items-center gap-1">
                                      <button onClick={() => { setFocusedTrackId(track.id); setIsTrackPanelOpen(true); setIsTrailsMenuOpen(false); clearInspectedLocation(); centerOnTrack(track, true); }} className="p-1.5 hover:bg-zinc-700 rounded text-zinc-400 hover:text-white transition-colors shrink-0 cursor-pointer" title="Statistiche"> <BarChart3 size={16}/> </button>
                                      <button onClick={() => removeTrack(track.id)} className="p-1.5 hover:bg-zinc-700 rounded text-zinc-400 hover:text-red-400 transition-colors shrink-0 cursor-pointer" title="Rimuovi"> <Trash2 size={16}/> </button> 
                                  </div>
                               </div>
                           ))}
                           
                           <div> <button onClick={() => setFilterByTrack(!filterByTrack)} className={`w-full flex items-center justify-between p-3 rounded-xl border transition-all mb-3 cursor-pointer ${filterByTrack ? 'bg-purple-900/30 border-purple-500' : 'bg-zinc-800 border-zinc-700'}`}> <span className="flex items-center gap-2 text-xs font-bold"><Filter size={14} className={filterByTrack ? "text-purple-400" : "text-zinc-500"}/> Filtra vicino al percorso</span> <div className={`w-8 h-4 rounded-full relative transition-colors ${filterByTrack ? 'bg-purple-500' : 'bg-zinc-600'}`}> <div className={`absolute top-0.5 w-3 h-3 bg-white rounded-full transition-all ${filterByTrack ? 'left-4.5' : 'left-0.5'}`}/> </div> </button> {filterByTrack && ( <div className="px-1 animate-in slide-in-from-top-2 fade-in"> <div className="flex justify-between text-[10px] uppercase font-bold text-zinc-500 mb-2"> <span>Raggio di Ricerca</span> <span className="text-purple-400">{trackBuffer < 1 ? `${trackBuffer*1000}m` : `${trackBuffer}km`}</span> </div> <input type="range" min="0.5" max="10" step="0.5" value={trackBuffer} onChange={(e) => setTrackBuffer(parseFloat(e.target.value))} className="w-full h-1 bg-zinc-800 rounded-lg appearance-none cursor-pointer accent-purple-500" /> </div> )} </div>
                           
                           {tracks.length < 2 && (
                               <button onClick={() => fileInputRef.current?.click()} className="w-full py-2 border border-zinc-700 hover:bg-zinc-800 text-zinc-400 rounded-lg text-xs font-bold flex items-center justify-center gap-2 transition-colors cursor-pointer"> <Plus size={12}/> Aggiungi GPX </button>
                           )}
                        </div>
                    )}
                    <div className="mt-3 pt-3 border-t border-zinc-800 space-y-2">
                      <button
                        onClick={() => {
                          setIsTrailsMenuOpen(false);
                          if (tourWaypoints.length > 0) {
                            setIsTourPlannerOpen(true);
                          } else {
                            showToast("Tocca un Bivacco, Rifugio o Punto sulla mappa e premi '+Tour' per creare un itinerario!");
                          }
                        }}
                        className="w-full py-2 px-3 bg-emerald-950/50 hover:bg-emerald-900/60 text-emerald-300 border border-emerald-500/40 rounded-xl text-[11px] font-bold flex items-center justify-center gap-2 transition-colors cursor-pointer"
                      >
                        <Route size={13} className="text-emerald-400" />
                        <span>
                          Pianificatore Tour {tourWaypoints.length > 0 ? `(${tourWaypoints.length} tappe)` : '(Multi-Tappa)'}
                        </span>
                      </button>
                      <button
                        onClick={() => exportPoisToGpx('saved')}
                        className="w-full py-2 px-3 bg-zinc-800/80 hover:bg-zinc-800 text-zinc-200 border border-zinc-700 rounded-xl text-[11px] font-bold flex items-center justify-center gap-2 transition-colors cursor-pointer"
                      >
                        <Download size={13} className="text-orange-400" /> Esporta Preferiti & Note (.GPX)
                      </button>
                    </div>
                  </div>
               )}
               <button onClick={() => { const next = !isTrailsMenuOpen; setIsTrailsMenuOpen(next); if (next) setIsLayersMenuOpen(false); }} className={`w-12 h-12 bg-zinc-900 border ${isTrailsMenuOpen || tracks.length > 0 ? 'border-orange-500 text-orange-500' : 'border-zinc-700 text-zinc-300'} rounded-2xl flex items-center justify-center shadow-lg hover:bg-zinc-800 transition-all cursor-pointer`} title="Tracce GPX"> <Footprints size={22}/> </button>
             </div>
             
             <div ref={layersMenuRef} className="relative">
               {isLayersMenuOpen && (
                <div className="absolute right-14 bottom-0 w-[min(265px,calc(100vw-84px))] max-h-[calc(100dvh-160px)] bg-zinc-900/95 backdrop-blur-md border border-zinc-800 rounded-2xl p-2.5 shadow-2xl overflow-y-auto z-[4000] animate-in fade-in slide-in-from-right-3">
                  <div className="flex items-center justify-between pb-2 mb-2 border-b border-zinc-800/80">
                    <span className="text-[11px] font-bold uppercase text-zinc-400 tracking-wider flex items-center gap-1.5">
                      <Layers size={13} className="text-orange-500" />
                      Mappa e Livelli
                    </span>
                    <button 
                      onClick={() => setIsLayersMenuOpen(false)} 
                      className="p-1 text-zinc-400 hover:text-white rounded-md hover:bg-zinc-800 transition-colors cursor-pointer"
                      title="Chiudi"
                    >
                      <X size={13}/>
                    </button>
                  </div>

                  <div className="space-y-1 mb-2.5">
                    <button
                      onClick={() => setMapStyle('standard')}
                      className={`w-full flex items-center justify-between px-2.5 py-1.5 rounded-lg text-xs transition-colors cursor-pointer ${
                        mapStyle === 'standard'
                          ? 'bg-orange-500/10 text-orange-400 border border-orange-500/30 font-medium'
                          : 'text-zinc-300 hover:bg-zinc-800/60 border border-transparent'
                      }`}
                    >
                      <span>OSM Standard</span>
                      {mapStyle === 'standard' && <span className="w-1.5 h-1.5 rounded-full bg-orange-500" />}
                    </button>
                    <button
                      onClick={() => setMapStyle('satellite')}
                      className={`w-full flex items-center justify-between px-2.5 py-1.5 rounded-lg text-xs transition-colors cursor-pointer ${
                        mapStyle === 'satellite'
                          ? 'bg-orange-500/10 text-orange-400 border border-orange-500/30 font-medium'
                          : 'text-zinc-300 hover:bg-zinc-800/60 border border-transparent'
                      }`}
                    >
                      <span>Satellite Puro</span>
                      {mapStyle === 'satellite' && <span className="w-1.5 h-1.5 rounded-full bg-orange-500" />}
                    </button>
                    <button
                      onClick={() => setMapStyle('hybrid')}
                      className={`w-full flex items-center justify-between px-2.5 py-1.5 rounded-lg text-xs transition-colors cursor-pointer ${
                        mapStyle === 'hybrid'
                          ? 'bg-orange-500/10 text-orange-400 border border-orange-500/30 font-medium'
                          : 'text-zinc-300 hover:bg-zinc-800/60 border border-transparent'
                      }`}
                    >
                      <span>Ibrida (Satellite + Sentieri)</span>
                      {mapStyle === 'hybrid' && <span className="w-1.5 h-1.5 rounded-full bg-orange-500" />}
                    </button>
                  </div>

                  <div className="pt-2 border-t border-zinc-800/80 mb-2.5 space-y-2">
                    <button 
                      onClick={() => {
                        const next = !weatherOverlayActive;
                        setWeatherOverlayActive(next);
                        if (next) {
                          setIsLayersMenuOpen(false);
                        }
                      }} 
                      className={`w-full flex items-center justify-between px-2.5 py-1.5 rounded-lg text-xs transition-colors cursor-pointer ${
                        weatherOverlayActive 
                          ? 'bg-blue-500/10 text-blue-400 border border-blue-500/30' 
                          : 'text-zinc-400 hover:text-zinc-200 hover:bg-zinc-800/50 border border-transparent'
                      }`}
                    >
                      <span className="flex items-center gap-2">
                        <CloudRain size={13} className={weatherOverlayActive ? 'text-blue-400' : 'text-zinc-500'} />
                        Radar precipitazioni
                      </span>
                      <span className={`w-7 h-3.5 rounded-full relative transition-colors ${weatherOverlayActive ? 'bg-blue-500' : 'bg-zinc-700'}`}>
                        <span className={`absolute top-0.5 w-2.5 h-2.5 bg-white rounded-full transition-all ${weatherOverlayActive ? 'left-4' : 'left-0.5'}`} />
                      </span>
                    </button>

                    {/* Controlli rapidi & Slider fluido Rotazione Mappa (oltre a 2 dita su touch o Tasto Destro / Alt+Trascina) */}
                    <div className="bg-zinc-950/60 border border-zinc-800/80 rounded-xl p-2">
                      <div className="flex items-center justify-between text-[10px] text-zinc-400 mb-1.5">
                        <span className="font-bold uppercase tracking-wider flex items-center gap-1">
                          <Compass size={11} className="text-orange-500" /> Orientamento Mappa
                        </span>
                        <span className="font-mono text-orange-400 font-bold">
                          {Math.round((mapBearing % 360 + 360) % 360)}°
                        </span>
                      </div>
                      <input
                        type="range"
                        min={0}
                        max={360}
                        step={1}
                        value={Math.round((mapBearing % 360 + 360) % 360)}
                        onChange={(e) => applyMapBearingLive(Number(e.target.value), false)}
                        className="w-full h-1.5 bg-zinc-800 rounded-lg appearance-none cursor-pointer accent-orange-500 mb-2"
                        title="Ruota fluidamente la mappa da 0° a 360°"
                      />
                      <div className="grid grid-cols-3 gap-1">
                        <button
                          onClick={() => applyMapBearingLive(mapBearingRef.current - 45, true)}
                          className="py-1 px-2 bg-zinc-800 hover:bg-zinc-700 text-zinc-200 rounded-lg text-[10px] font-bold transition-colors cursor-pointer"
                          title="Ruota di -45°"
                        >
                          ↺ -45°
                        </button>
                        <button
                          onClick={resetMapNorth}
                          className="py-1 px-2 bg-zinc-800 hover:bg-zinc-700 text-emerald-400 rounded-lg text-[10px] font-bold transition-colors cursor-pointer"
                          title="Nord in alto (0°)"
                        >
                          Nord (0°)
                        </button>
                        <button
                          onClick={() => applyMapBearingLive(mapBearingRef.current + 45, true)}
                          className="py-1 px-2 bg-zinc-800 hover:bg-zinc-700 text-zinc-200 rounded-lg text-[10px] font-bold transition-colors cursor-pointer"
                          title="Ruota di +45°"
                        >
                          +45° ↻
                        </button>
                      </div>
                      <p className="text-[9px] text-zinc-500 mt-1 text-center">
                        Touch: 2 dita · PC: Tasto Destro o Alt + Trascina
                      </p>
                    </div>
                  </div>

                  <div className="pt-2 border-t border-zinc-800/80 space-y-1.5">
                    <div className="flex items-center justify-between px-1 text-[10px] text-zinc-500">
                      <span className="flex items-center gap-1.5 text-emerald-400/90 font-medium">
                        <CheckCircle2 size={11} className="text-emerald-400" />
                        Offline (Veneto & Trentino)
                      </span>
                    </div>

                    <button 
                      disabled={isOffline || isDownloading} 
                      onClick={downloadMapArea} 
                      className="w-full py-1.5 px-2.5 bg-zinc-800/80 hover:bg-zinc-800 disabled:opacity-50 disabled:cursor-not-allowed rounded-lg text-[11px] font-medium flex items-center justify-center gap-1.5 text-zinc-300 transition-colors border border-zinc-700/60 cursor-pointer"
                    >
                      {isDownloading ? (
                        downloadProgress === 'fetching' ? (
                          <><Loader2 size={12} className="animate-spin text-orange-500"/> Scarico...</>
                        ) : downloadProgress === 'saving' ? (
                          <><Database size={12} className="animate-pulse text-emerald-500"/> Salvo {downloadCount} Punti...</>
                        ) : (
                          <><CheckCircle2 size={12} className="text-emerald-500"/> Completato</>
                        )
                      ) : (
                        <><Download size={12}/> Scarica area visibile</>
                      )}
                    </button>
                  </div>
                </div>
               )}
               <button onClick={() => { const next = !isLayersMenuOpen; setIsLayersMenuOpen(next); if (next) setIsTrailsMenuOpen(false); }} className={`w-12 h-12 bg-zinc-900 border ${isLayersMenuOpen ? 'border-orange-500 text-orange-500' : 'border-zinc-700 text-zinc-300'} rounded-2xl flex items-center justify-center shadow-lg hover:bg-zinc-800 transition-all cursor-pointer`} title="Mappa e Livelli"> <Layers size={22}/> </button>
             </div>
            
            <button onClick={handleLocateUser} className={`w-12 h-12 bg-zinc-900 border ${isLocating ? 'border-orange-500' : 'border-zinc-700'} rounded-2xl flex items-center justify-center shadow-lg hover:bg-zinc-800 transition-all text-zinc-200 cursor-pointer`} title="La mia posizione">
                {isLocating ? <Loader2 size={24} className="animate-spin text-orange-500"/> : <Locate size={24} className={userLocation ? "text-blue-500 fill-blue-500/20" : ""} />}
            </button>

            <div className="flex flex-col rounded-2xl overflow-hidden shadow-lg border border-zinc-700 bg-zinc-900">
               <button onClick={handleZoomIn} className="w-12 h-12 flex items-center justify-center hover:bg-zinc-800 active:bg-zinc-700 transition-colors text-zinc-200 border-b border-zinc-800 cursor-pointer" title="Ingrandisci"><Plus size={24} /></button>
               <button onClick={handleZoomOut} className="w-12 h-12 flex items-center justify-center hover:bg-zinc-800 active:bg-zinc-700 transition-colors text-zinc-200 cursor-pointer" title="Riduci"><Minus size={24} /></button>
            </div>
          </div>
        )}
      </main>
      
      {/* Hidden File Input for GPX Upload */}
      <input type="file" ref={fileInputRef} accept=".gpx" className="hidden" onChange={handleGpxUpload} />

      {/* GPX TRACK PANEL */}
      <div className={`fixed bottom-0 left-0 right-0 z-[5500] bg-zinc-900 border-t border-zinc-800 shadow-2xl transition-all duration-300 ease-out flex flex-col overflow-hidden ${isTrackPanelOpen && tracks.length > 0 ? (isTrackPanelExpanded ? 'h-[100dvh]' : 'h-[40vh]') : 'h-0 translate-y-full'}`}>
         
         {/* DRAG HANDLE & HEADER */}
         <div 
            className="w-full flex flex-col items-center pt-2 pb-1 bg-zinc-900 border-b border-zinc-800/50 cursor-grab active:cursor-grabbing touch-none shrink-0"
            onClick={() => setIsTrackPanelExpanded(!isTrackPanelExpanded)}
            onTouchStart={(e) => { touchStartRef.current = e.touches[0].clientY; }}
            onTouchEnd={(e) => { 
                if (touchStartRef.current !== null) {
                    const diff = touchStartRef.current - e.changedTouches[0].clientY;
                    if (diff > 50 && !isTrackPanelExpanded) setIsTrackPanelExpanded(true); // Swipe Up
                    else if (diff < -50) {
                        if (isTrackPanelExpanded) {
                            setIsTrackPanelExpanded(false); // Swipe Down (Expanded -> Collapsed)
                        } else {
                            setIsTrackPanelOpen(false); // Swipe Down (Collapsed -> Closed)
                            if (currentStatsTrack) centerOnTrack(currentStatsTrack, false); // Recenter map without offset
                        }
                    }
                    touchStartRef.current = null;
                }
            }}
         >
            <div className="w-12 h-1.5 bg-zinc-700 rounded-full mb-2"></div>
            <div className="w-full flex items-center justify-between px-4 pb-1">
                <div className="flex items-center gap-3 overflow-x-auto no-scrollbar mask-linear-fade">
                    <Activity size={16} className="text-orange-500 shrink-0"/>
                    {tracks.length > 1 ? (
                        <div className="flex items-center gap-1">
                            {tracks.map(t => (
                                <button
                                    key={t.id}
                                    onClick={(e) => { 
                                        e.stopPropagation(); 
                                        setFocusedTrackId(t.id); 
                                        centerOnTrack(t, true); // Added offset centering
                                    }}
                                    className={`flex items-center gap-1.5 px-2 py-1 rounded-full text-[10px] font-bold border transition-all whitespace-nowrap ${focusedTrackId === t.id ? 'bg-zinc-800 border-zinc-600 text-white shadow-sm' : 'bg-transparent border-transparent text-zinc-500 hover:bg-zinc-800/50'}`}
                                >
                                    <div className="w-2 h-2 rounded-full shrink-0" style={{ backgroundColor: t.color }} />
                                    <span>{t.name}</span>
                                </button>
                            ))}
                        </div>
                    ) : (
                         <div className="flex items-center gap-2">
                             {currentStatsTrack && <span className="text-xs font-bold uppercase tracking-wider text-zinc-300 truncate max-w-[200px]">{currentStatsTrack.name}</span>}
                             <button onClick={(e) => {
                                 e.stopPropagation();
                                 fileInputRef.current?.click();
                             }} className="p-1 bg-zinc-800 hover:bg-zinc-700 rounded-lg text-zinc-400 hover:text-white transition-colors">
                                <Plus size={14} />
                             </button>
                         </div>
                    )}
                </div>
                <div className="flex items-center gap-2">
                    <button onClick={(e) => { 
                        e.stopPropagation(); 
                        setIsTrackPanelOpen(false); 
                        if(currentStatsTrack) centerOnTrack(currentStatsTrack, false);
                    }} className="p-2 bg-zinc-800 hover:bg-zinc-700 rounded-full text-zinc-400">
                        <X size={16}/>
                    </button>
                </div>
            </div>
         </div>

         {/* CONTENT */}
         <div className="flex-1 overflow-y-auto p-4 space-y-4">
            {currentStatsTrack && (
               <>
                 {/* GRID STATS - Optimized for Expanded/Collapsed */}
                 <div className={`grid grid-cols-4 ${isTrackPanelExpanded ? 'gap-2 mb-4' : 'gap-0 mb-1'} transition-all duration-300`}>
                    <div className={`flex flex-col items-center justify-center transition-all ${isTrackPanelExpanded ? 'bg-zinc-800/50 p-3 rounded-xl border border-zinc-700/50' : 'p-0.5 border-r border-zinc-800/50 last:border-0'}`}>
                        <span className={`text-zinc-500 uppercase font-bold transition-all ${isTrackPanelExpanded ? 'text-[10px] mb-1' : 'text-[9px]'}`}>Distanza</span>
                        <span className={`font-bold text-white transition-all ${isTrackPanelExpanded ? 'text-lg' : 'text-xs'}`}>
                             {currentStatsTrack.stats.totalDistance.toFixed(1)}<span className="text-[9px] font-normal text-zinc-500 ml-0.5">km</span>
                        </span>
                    </div>
                    <div className={`flex flex-col items-center justify-center transition-all ${isTrackPanelExpanded ? 'bg-zinc-800/50 p-3 rounded-xl border border-zinc-700/50' : 'p-0.5 border-r border-zinc-800/50 last:border-0'}`}>
                        <span className={`text-zinc-500 uppercase font-bold transition-all ${isTrackPanelExpanded ? 'text-[10px] mb-1' : 'text-[9px]'}`}>Dislivello</span>
                        <span className={`font-bold text-emerald-400 transition-all ${isTrackPanelExpanded ? 'text-lg' : 'text-xs'}`}>
                            +{Math.round(currentStatsTrack.stats.elevationGain)}<span className="text-[9px] font-normal text-zinc-500 ml-0.5">m</span>
                        </span>
                    </div>
                    <div className={`flex flex-col items-center justify-center transition-all ${isTrackPanelExpanded ? 'bg-zinc-800/50 p-3 rounded-xl border border-zinc-700/50' : 'p-0.5 border-r border-zinc-800/50 last:border-0'}`}>
                        <span className={`text-zinc-500 uppercase font-bold transition-all ${isTrackPanelExpanded ? 'text-[10px] mb-1' : 'text-[9px]'}`}>Tempo</span>
                        <span className={`font-bold text-white transition-all ${isTrackPanelExpanded ? 'text-lg' : 'text-xs'}`}>
                            {formatDuration(currentStatsTrack.stats.totalTimeSeconds || 0)}
                        </span>
                    </div>
                    <div className={`flex flex-col items-center justify-center transition-all ${isTrackPanelExpanded ? 'bg-zinc-800/50 p-3 rounded-xl border border-zinc-700/50' : 'p-0.5 last:border-0'}`}>
                        <span className={`text-zinc-500 uppercase font-bold transition-all flex items-center gap-1 ${isTrackPanelExpanded ? 'text-[10px] mb-1' : 'text-[9px]'}`}>
                          <span>Max Ele</span>
                          {gpxTrailAnalysis[currentStatsTrack.id]?.maxElevationSource === 'osm_peak' && (
                            <span className="text-[8px] px-1 py-0.2 rounded bg-orange-500/20 text-orange-400 border border-orange-500/40 font-mono" title={`Quota ufficiale Cima OSM: ${gpxTrailAnalysis[currentStatsTrack.id]?.summitName || 'Vetta'}`}>
                              ▲ OSM
                            </span>
                          )}
                        </span>
                        <span className={`font-bold text-white transition-all ${isTrackPanelExpanded ? 'text-lg' : 'text-xs'}`}>
                             {Math.round(currentStatsTrack.stats.maxElevation)}<span className="text-[9px] font-normal text-zinc-500 ml-0.5">m</span>
                        </span>
                        {isTrackPanelExpanded && gpxTrailAnalysis[currentStatsTrack.id]?.summitName && (
                          <span className="text-[9px] text-orange-400 font-medium truncate max-w-[110px] mt-0.5" title={gpxTrailAnalysis[currentStatsTrack.id]?.summitName}>
                            ▲ {gpxTrailAnalysis[currentStatsTrack.id]?.summitName}
                          </span>
                        )}
                    </div>
                 </div>

                 {/* EXTRA STATS (If Expanded) */}
                 {isTrackPanelExpanded && (
                     <div className="grid grid-cols-4 gap-2 animate-in fade-in slide-in-from-bottom-2">
                        <div className="bg-zinc-800/30 p-2 rounded-lg border border-zinc-700/30 flex flex-col items-center justify-center">
                            <span className="text-[10px] text-zinc-500 uppercase font-bold">Pendenza Max</span>
                            <span className="text-sm font-bold text-orange-400">{currentStatsTrack.stats.maxGrade?.toFixed(1)}%</span>
                        </div>
                        <div className="bg-zinc-800/30 p-2 rounded-lg border border-zinc-700/30 flex flex-col items-center justify-center">
                            <span className="text-[10px] text-zinc-500 uppercase font-bold">VAM</span>
                            <span className="text-sm font-bold text-white">{currentStatsTrack.stats.vam || '-'}<span className="text-[10px] font-normal text-zinc-500">m/h</span></span>
                        </div>
                         <div className="bg-zinc-800/30 p-2 rounded-lg border border-zinc-700/30 flex flex-col items-center justify-center">
                            <span className="text-[10px] text-zinc-500 uppercase font-bold">Negativo</span>
                            <span className="text-sm font-bold text-red-400">-{Math.round(currentStatsTrack.stats.elevationLoss)}<span className="text-[10px] font-normal text-zinc-400">m</span></span>
                        </div>
                        <div className="bg-zinc-800/30 p-2 rounded-lg border border-zinc-700/30 flex flex-col items-center justify-center">
                            <span className="text-[10px] text-zinc-500 uppercase font-bold">Avg Speed</span>
                            <span className="text-sm font-bold text-white">{currentStatsTrack.stats.avgSpeedKmh?.toFixed(1)}<span className="text-[10px] font-normal text-zinc-500">km/h</span></span>
                        </div>
                     </div>
                 )}
                 
                 {/* INTERACTIVE CHART (KOMOOT SLOPE-COLORED OR CLASSIC) */}
                 <div className="space-y-2 mt-2">
                   <div className="flex items-center justify-between px-0.5">
                     <span className="text-[10px] font-bold uppercase tracking-wider text-zinc-400 flex items-center gap-1.5">
                       <TrendingUp size={12} className="text-orange-500" /> Profilo Altimetrico & Pendenze
                     </span>
                     <button
                       type="button"
                       onClick={() => setColorChartBySlope(prev => !prev)}
                       className={`px-2 py-0.5 rounded-md text-[10px] font-bold border transition-colors cursor-pointer ${
                         colorChartBySlope
                           ? 'bg-emerald-500/15 border-emerald-500/40 text-emerald-300'
                           : 'bg-zinc-800 border-zinc-700 text-zinc-400 hover:text-zinc-200'
                       }`}
                       title="Attiva/Disattiva colorazione per pendenza in stile Komoot"
                     >
                       {colorChartBySlope ? 'Colori Pendenza: ON' : 'Colore Unico'}
                     </button>
                   </div>

                   <div className={`w-full bg-zinc-900/50 rounded-xl border border-zinc-800 relative overflow-hidden select-none transition-all duration-300 ${isTrackPanelExpanded ? 'h-36' : 'h-20'}`}
                        onMouseMove={handleChartMouseMove}
                        onTouchMove={handleChartMouseMove}
                        onMouseLeave={handleChartMouseLeave}
                   >
                      <svg className="w-full h-full" preserveAspectRatio="none" viewBox={`0 0 1000 200`}>
                          {/* Gradient Definitions */}
                          <defs>
                              <linearGradient id="chartGradient" x1="0" x2="0" y1="0" y2="1">
                                  <stop offset="0%" stopColor="#ea580c" stopOpacity="0.4"/>
                                  <stop offset="100%" stopColor="#ea580c" stopOpacity="0.0"/>
                              </linearGradient>
                              <linearGradient id="slopeGradEasy" x1="0" x2="0" y1="0" y2="1">
                                  <stop offset="0%" stopColor="#10b981" stopOpacity="0.45"/>
                                  <stop offset="100%" stopColor="#10b981" stopOpacity="0.03"/>
                              </linearGradient>
                              <linearGradient id="slopeGradMedium" x1="0" x2="0" y1="0" y2="1">
                                  <stop offset="0%" stopColor="#eab308" stopOpacity="0.45"/>
                                  <stop offset="100%" stopColor="#eab308" stopOpacity="0.03"/>
                              </linearGradient>
                              <linearGradient id="slopeGradSteep" x1="0" x2="0" y1="0" y2="1">
                                  <stop offset="0%" stopColor="#f97316" stopOpacity="0.5"/>
                                  <stop offset="100%" stopColor="#f97316" stopOpacity="0.04"/>
                              </linearGradient>
                              <linearGradient id="slopeGradExtreme" x1="0" x2="0" y1="0" y2="1">
                                  <stop offset="0%" stopColor="#ef4444" stopOpacity="0.55"/>
                                  <stop offset="100%" stopColor="#ef4444" stopOpacity="0.05"/>
                              </linearGradient>
                          </defs>

                          {colorChartBySlope && slopeChartData ? (
                            <>
                              {/* Segmenti Area Colorati per Pendenza */}
                              {slopeChartData.segments.map((seg, idx) => (
                                <path
                                  key={`area-${idx}`}
                                  d={`M${seg.x1.toFixed(1)},200 L${seg.x1.toFixed(1)},${seg.y1.toFixed(1)} L${seg.x2.toFixed(1)},${seg.y2.toFixed(1)} L${seg.x2.toFixed(1)},200 Z`}
                                  fill={`url(#${seg.gradId})`}
                                />
                              ))}
                              {/* Segmenti Linea Superiore Colorati per Pendenza */}
                              {slopeChartData.segments.map((seg, idx) => (
                                <line
                                  key={`line-${idx}`}
                                  x1={seg.x1.toFixed(1)}
                                  y1={seg.y1.toFixed(1)}
                                  x2={seg.x2.toFixed(1)}
                                  y2={seg.y2.toFixed(1)}
                                  stroke={seg.stroke}
                                  strokeWidth="2.5"
                                  strokeLinecap="round"
                                />
                              ))}
                            </>
                          ) : (
                            <>
                              {/* Area Classica */}
                              <path 
                                 d={`M0,200 ${generateChartPath(currentStatsTrack.points, 1000, 200, currentStatsTrack.stats.minElevation - elePadding, chartMaxEle, currentStatsTrack.stats.totalDistance)} L1000,200Z`} 
                                 fill="url(#chartGradient)" 
                              />
                              {/* Line Classica */}
                              <path 
                                 d={`M0,200 ${generateChartPath(currentStatsTrack.points, 1000, 200, currentStatsTrack.stats.minElevation - elePadding, chartMaxEle, currentStatsTrack.stats.totalDistance)}`} 
                                 fill="none" 
                                 stroke="#ea580c" 
                                 strokeWidth="2"
                              />
                            </>
                          )}
                      </svg>

                      {/* Linea verticale e Pallino Circolare Perfetto (HTML Overlay non deformato da preserveAspectRatio="none") */}
                      {hoveredTrackPoint && hoveredTrackIndex !== null && currentStatsTrack.points.length > 0 && (() => {
                          const totalDist = currentStatsTrack.stats.totalDistance || 1;
                          const minEle = currentStatsTrack.stats.minElevation - elePadding;
                          const eleRange = (chartMaxEle - minEle) || 1;
                          const xPct = Math.max(0, Math.min(100, (hoveredTrackPoint.dist / totalDist) * 100));
                          const yPct = Math.max(0, Math.min(100, (1 - (hoveredTrackPoint.ele - minEle) / eleRange) * 100));
                          const dotColor =
                            colorChartBySlope && slopeChartData
                              ? getSlopeBandInfo(Math.abs(slopeChartData.pointGrades[hoveredTrackIndex] || 0)).stroke
                              : '#3b82f6';

                          return (
                            <>
                              <div
                                style={{ left: `${xPct}%` }}
                                className="absolute top-0 bottom-0 w-px border-l border-dashed border-white/85 pointer-events-none"
                              />
                              <div
                                style={{
                                  left: `${xPct}%`,
                                  top: `${yPct}%`,
                                  backgroundColor: dotColor,
                                }}
                                className="absolute w-3.5 h-3.5 rounded-full border-2 border-white shadow-[0_0_8px_rgba(0,0,0,0.8)] -translate-x-1/2 -translate-y-1/2 pointer-events-none"
                              />
                            </>
                          );
                      })()}
                      
                      {/* Hover Info Tooltip con Pendenza Istantanea Komoot-style */}
                      {hoveredTrackPoint && hoveredTrackIndex !== null && (
                          <div className="absolute top-2 left-2 bg-zinc-900/95 border border-zinc-700 px-2.5 py-1.5 rounded-lg text-[10px] font-mono shadow-xl pointer-events-none flex items-center gap-2.5">
                               <div>
                                 <div className="text-white font-bold">{Math.round(hoveredTrackPoint.ele)}m</div>
                                 <div className="text-zinc-400">{hoveredTrackPoint.dist.toFixed(1)}km</div>
                               </div>
                               {slopeChartData && (
                                 <div className="border-l border-zinc-700 pl-2">
                                   <div className="text-[9px] uppercase text-zinc-500 font-sans font-bold">Pendenza</div>
                                   <div className={`font-bold ${getSlopeBandInfo(Math.abs(slopeChartData.pointGrades[hoveredTrackIndex] || 0)).textClass}`}>
                                     {slopeChartData.pointGrades[hoveredTrackIndex] > 0 ? '+' : ''}
                                     {(slopeChartData.pointGrades[hoveredTrackIndex] || 0).toFixed(1)}%
                                   </div>
                                 </div>
                               )}
                               {(hoveredTrackPoint.hr || hoveredTrackPoint.temp) && (
                                 <div className="border-l border-zinc-700 pl-2">
                                   {hoveredTrackPoint.hr && <div className="text-red-400">♥ {Math.round(hoveredTrackPoint.hr)}</div>}
                                   {hoveredTrackPoint.temp && <div className="text-blue-400">{Math.round(hoveredTrackPoint.temp)}°C</div>}
                                 </div>
                               )}
                          </div>
                      )}
                   </div>

                   {/* --- [MODULAR FEATURE 1.1] LEGENDA CLASSI DI PENDENZA (SENZA BARRA COLORATA) --- */}
                   {colorChartBySlope && slopeChartData && (
                     <div className="mt-2 pt-1.5 border-t border-zinc-800/70 grid grid-cols-4 gap-1 text-[9px] font-mono text-zinc-400">
                       <div className="flex items-center gap-1">
                         <span className="w-2 h-2 rounded-full bg-emerald-500 shrink-0" />
                         <span className="truncate">&lt;6% ({slopeChartData.pctGentle}%)</span>
                       </div>
                       <div className="flex items-center gap-1">
                         <span className="w-2 h-2 rounded-full bg-amber-400 shrink-0" />
                         <span className="truncate">6-12% ({slopeChartData.pctModerate}%)</span>
                       </div>
                       <div className="flex items-center gap-1">
                         <span className="w-2 h-2 rounded-full bg-orange-500 shrink-0" />
                         <span className="truncate">12-20% ({slopeChartData.pctSteep}%)</span>
                       </div>
                       <div className="flex items-center gap-1">
                         <span className="w-2 h-2 rounded-full bg-red-500 shrink-0" />
                         <span className="truncate">&gt;20% ({slopeChartData.pctExtreme}%)</span>
                       </div>
                     </div>
                   )}
                 </div>

                 {/* --- [MODULAR FEATURE 1.2 & PEAK CALIBRATION] ANALISI TIPOLOGIA PERCORSO, SUPERFICIE, DIFFICOLTÀ SAC & CIME OSM --- */}
                 <div className="bg-zinc-950/80 border border-zinc-800 rounded-2xl p-3 space-y-3">
                   <div className="flex items-center justify-between gap-2 flex-wrap">
                     <span className="text-[10px] font-bold uppercase tracking-wider text-zinc-400 flex items-center gap-1.5">
                       <Footprints size={13} className="text-orange-500" /> Analisi Fondo, Sentiero & Difficoltà SAC
                     </span>

                     <div className="flex items-center gap-1.5">
                       {gpxTrailAnalysis[currentStatsTrack.id] && (() => {
                         const analysis = gpxTrailAnalysis[currentStatsTrack.id];
                         const gradeColors =
                           analysis.overallSacScale === 'T1'
                             ? 'bg-emerald-500/15 border-emerald-500/40 text-emerald-300'
                             : analysis.overallSacScale === 'T2'
                             ? 'bg-amber-500/15 border-amber-500/40 text-amber-300'
                             : analysis.overallSacScale === 'T3'
                             ? 'bg-orange-500/20 border-orange-500/50 text-orange-300'
                             : 'bg-red-500/20 border-red-500/50 text-red-300';
                         return (
                           <span className={`text-[10px] font-mono font-bold px-2 py-0.5 rounded-md border ${gradeColors}`}>
                             CAI {analysis.overallCaiGrade} · SAC {analysis.overallSacScale}
                           </span>
                         );
                       })()}
                       <button
                         type="button"
                         onClick={() => runGpxTrailAnalysis(currentStatsTrack)}
                         disabled={isLoadingTrailAnalysis}
                         className="px-2 py-0.5 rounded-md text-[9px] font-bold bg-zinc-900 hover:bg-zinc-800 border border-zinc-700 text-zinc-300 transition-colors cursor-pointer disabled:opacity-50"
                         title="Ricalcola analisi cartografica OSM di sentieri, superfici e cime"
                       >
                         {isLoadingTrailAnalysis ? '...' : 'Aggiorna'}
                       </button>
                     </div>
                   </div>

                   {isLoadingTrailAnalysis && !gpxTrailAnalysis[currentStatsTrack.id] ? (
                     <div className="flex items-center gap-2 text-xs text-zinc-400 py-2">
                       <Loader2 size={14} className="animate-spin text-orange-500" />
                       <span>Analisi cartografica OSM di sentieri, superfici, grado SAC e cime...</span>
                     </div>
                   ) : gpxTrailAnalysis[currentStatsTrack.id] ? (() => {
                     const analysis = gpxTrailAnalysis[currentStatsTrack.id];
                     return (
                         <div className="space-y-3">
                           {/* Descrizione sintetica difficoltà + eventuale avviso Via Ferrata / Tratto Attrezzato */}
                           <div className="flex flex-col gap-1.5">
                             <div className="text-[11px] text-zinc-300 font-medium flex items-center justify-between gap-2 bg-zinc-900/90 border border-zinc-800/90 rounded-xl px-2.5 py-1.5">
                               <span>{analysis.overallDifficultyLabel}</span>
                               <div className="flex items-center gap-1 text-[9px] font-mono text-zinc-400 shrink-0">
                                 <span>T1:{analysis.sacDistribution.t1Pct}%</span>
                                 <span>·</span>
                                 <span>T2:{analysis.sacDistribution.t2Pct}%</span>
                                 <span>·</span>
                                 <span className="text-orange-400">T3:{analysis.sacDistribution.t3Pct}%</span>
                                 {analysis.sacDistribution.t4PlusPct > 0 && (
                                   <>
                                     <span>·</span>
                                     <span className="text-red-400 font-bold">T4+:{analysis.sacDistribution.t4PlusPct}%</span>
                                   </>
                                 )}
                               </div>
                             </div>

                             {analysis.hasViaFerrataOrAssisted && (
                               <div className="px-2.5 py-1.5 rounded-xl bg-red-950/60 border border-red-500/50 text-red-200 text-[11px] font-semibold flex items-center gap-2">
                                 <AlertCircle size={14} className="text-red-400 shrink-0" />
                                 <span>Attenzione: Rilevati tratti attrezzati / Via Ferrata sul percorso (richiesto kit ferrata/casco).</span>
                               </div>
                             )}
                           </div>

                           {/* Cime e Valichi Ufficiali OSM Rilevati lungo la Traccia (con Quota Cartografica Calibrata) */}
                           {analysis.detectedPeaks.length > 0 && (
                             <div className="space-y-1.5">
                               <div className="flex items-center justify-between text-[10px] text-zinc-400 font-bold uppercase tracking-wider">
                                 <span className="flex items-center gap-1">
                                   <Mountain size={12} className="text-orange-400" /> Cime & Valichi Cartografici sul Percorso
                                 </span>
                                 <span className="text-[9px] font-mono text-emerald-400 normal-case">
                                   Quota allineata a mappa OSM
                                 </span>
                               </div>
                               <div className="flex flex-wrap gap-1.5">
                                 {analysis.detectedPeaks.map(pk => (
                                   <button
                                     key={pk.id}
                                     type="button"
                                     onClick={() => {
                                       setHoveredTrackIndex(pk.pointIndex);
                                       if (mapRef.current) {
                                         mapRef.current.panTo([pk.lat, pk.lng], { animate: true });
                                       }
                                     }}
                                     className="px-2.5 py-1.5 rounded-xl bg-zinc-900 hover:bg-zinc-800 border border-zinc-700/80 text-left transition-colors cursor-pointer flex items-center gap-2"
                                     title={`Tocca per centrare ${pk.name} (${pk.ele}m) su mappa e profilo altimetrico`}
                                   >
                                     <span className={`text-xs font-bold ${pk.kind === 'peak' ? 'text-orange-400' : 'text-cyan-400'}`}>
                                       {pk.kind === 'peak' ? '▲' : '⛌'}
                                     </span>
                                     <div>
                                       <div className="text-[11px] font-bold text-white flex items-center gap-1.5">
                                         <span>{pk.name}</span>
                                         <span className="font-mono text-orange-400">{pk.ele}m</span>
                                       </div>
                                       <div className="text-[9px] font-mono text-zinc-400">
                                         km {pk.distKm.toFixed(1)}
                                         {Math.abs(pk.ele - pk.rawGpxEle) >= 3 && (
                                           <span className="text-zinc-500 ml-1">
                                             (GPX grezzo: {pk.rawGpxEle}m → Mappa: {pk.ele}m)
                                           </span>
                                         )}
                                       </div>
                                     </div>
                                   </button>
                                 ))}
                               </div>
                             </div>
                           )}

                           {/* 1. Tipologia di Percorso (Waytypes Komoot) */}
                           <div className="space-y-1.5">
                             <div className="text-[10px] font-bold uppercase tracking-wider text-zinc-400">
                               Tipologia di Percorso (Waytypes)
                             </div>
                             <div className="w-full h-2 bg-zinc-800 rounded-full overflow-hidden flex">
                               {analysis.waytypes.alpinePathPct > 0 && (
                                 <div
                                   style={{ width: `${analysis.waytypes.alpinePathPct}%` }}
                                   className="bg-orange-500 h-full"
                                   title={`Sentiero Alpino / Singletrack: ${analysis.waytypes.alpinePathPct}% (${analysis.waytypes.alpinePathKm} km)`}
                                 />
                               )}
                               {analysis.waytypes.hikingPathPct > 0 && (
                                 <div
                                   style={{ width: `${analysis.waytypes.hikingPathPct}%` }}
                                   className="bg-emerald-500 h-full"
                                   title={`Sentiero Escursionistico / Mulattiera: ${analysis.waytypes.hikingPathPct}% (${analysis.waytypes.hikingPathKm} km)`}
                                 />
                               )}
                               {analysis.waytypes.forestTrackPct > 0 && (
                                 <div
                                   style={{ width: `${analysis.waytypes.forestTrackPct}%` }}
                                   className="bg-amber-500 h-full"
                                   title={`Strada Forestale / Carrareccia: ${analysis.waytypes.forestTrackPct}% (${analysis.waytypes.forestTrackKm} km)`}
                                 />
                               )}
                               {analysis.waytypes.pavedRoadPct > 0 && (
                                 <div
                                   style={{ width: `${analysis.waytypes.pavedRoadPct}%` }}
                                   className="bg-sky-500 h-full"
                                   title={`Strada Asfaltata / Secondaria: ${analysis.waytypes.pavedRoadPct}% (${analysis.waytypes.pavedRoadKm} km)`}
                                 />
                               )}
                             </div>
                             <div className="grid grid-cols-2 sm:grid-cols-4 gap-1.5 text-[9px] font-mono text-zinc-300">
                               <div className="flex items-center gap-1.5 bg-zinc-900/70 px-2 py-1 rounded-lg border border-zinc-800/80">
                                 <span className="w-2 h-2 rounded-full bg-orange-500 shrink-0" />
                                 <span className="truncate">Sent. Alpino {analysis.waytypes.alpinePathPct}% ({analysis.waytypes.alpinePathKm}km)</span>
                               </div>
                               <div className="flex items-center gap-1.5 bg-zinc-900/70 px-2 py-1 rounded-lg border border-zinc-800/80">
                                 <span className="w-2 h-2 rounded-full bg-emerald-500 shrink-0" />
                                 <span className="truncate">Sentiero {analysis.waytypes.hikingPathPct}% ({analysis.waytypes.hikingPathKm}km)</span>
                               </div>
                               <div className="flex items-center gap-1.5 bg-zinc-900/70 px-2 py-1 rounded-lg border border-zinc-800/80">
                                 <span className="w-2 h-2 rounded-full bg-amber-500 shrink-0" />
                                 <span className="truncate">Forestale {analysis.waytypes.forestTrackPct}% ({analysis.waytypes.forestTrackKm}km)</span>
                               </div>
                               <div className="flex items-center gap-1.5 bg-zinc-900/70 px-2 py-1 rounded-lg border border-zinc-800/80">
                                 <span className="w-2 h-2 rounded-full bg-sky-500 shrink-0" />
                                 <span className="truncate">Asfalto {analysis.waytypes.pavedRoadPct}% ({analysis.waytypes.pavedRoadKm}km)</span>
                               </div>
                             </div>
                           </div>

                           {/* 2. Tipologia di Fondo / Superficie (Surfaces Komoot) */}
                           <div className="space-y-1.5">
                             <div className="text-[10px] font-bold uppercase tracking-wider text-zinc-400">
                               Tipologia di Superficie (Fondo)
                             </div>
                             <div className="w-full h-2 bg-zinc-800 rounded-full overflow-hidden flex">
                               {analysis.surfaces.rockScreePct > 0 && (
                                 <div
                                   style={{ width: `${analysis.surfaces.rockScreePct}%` }}
                                   className="bg-rose-500 h-full"
                                   title={`Roccia / Pietraia / Ghiaione: ${analysis.surfaces.rockScreePct}% (${analysis.surfaces.rockScreeKm} km)`}
                                 />
                               )}
                               {analysis.surfaces.naturalEarthPct > 0 && (
                                 <div
                                   style={{ width: `${analysis.surfaces.naturalEarthPct}%` }}
                                   className="bg-emerald-500 h-full"
                                   title={`Fondo Naturale / Terra & Radici: ${analysis.surfaces.naturalEarthPct}% (${analysis.surfaces.naturalEarthKm} km)`}
                                 />
                               )}
                               {analysis.surfaces.gravelCompactedPct > 0 && (
                                 <div
                                   style={{ width: `${analysis.surfaces.gravelCompactedPct}%` }}
                                   className="bg-yellow-500 h-full"
                                   title={`Ghiaia / Sterrato Compatto: ${analysis.surfaces.gravelCompactedPct}% (${analysis.surfaces.gravelCompactedKm} km)`}
                                 />
                               )}
                               {analysis.surfaces.asphaltPavedPct > 0 && (
                                 <div
                                   style={{ width: `${analysis.surfaces.asphaltPavedPct}%` }}
                                   className="bg-indigo-400 h-full"
                                   title={`Asfalto / Lastricato: ${analysis.surfaces.asphaltPavedPct}% (${analysis.surfaces.asphaltPavedKm} km)`}
                                 />
                               )}
                             </div>
                             <div className="grid grid-cols-2 sm:grid-cols-4 gap-1.5 text-[9px] font-mono text-zinc-300">
                               <div className="flex items-center gap-1.5 bg-zinc-900/70 px-2 py-1 rounded-lg border border-zinc-800/80">
                                 <span className="w-2 h-2 rounded-full bg-rose-500 shrink-0" />
                                 <span className="truncate">Roccia/Pietraia {analysis.surfaces.rockScreePct}% ({analysis.surfaces.rockScreeKm}km)</span>
                               </div>
                               <div className="flex items-center gap-1.5 bg-zinc-900/70 px-2 py-1 rounded-lg border border-zinc-800/80">
                                 <span className="w-2 h-2 rounded-full bg-emerald-500 shrink-0" />
                                 <span className="truncate">Terra/Sentiero {analysis.surfaces.naturalEarthPct}% ({analysis.surfaces.naturalEarthKm}km)</span>
                               </div>
                               <div className="flex items-center gap-1.5 bg-zinc-900/70 px-2 py-1 rounded-lg border border-zinc-800/80">
                                 <span className="w-2 h-2 rounded-full bg-yellow-500 shrink-0" />
                                 <span className="truncate">Sterrato/Ghiaia {analysis.surfaces.gravelCompactedPct}% ({analysis.surfaces.gravelCompactedKm}km)</span>
                               </div>
                               <div className="flex items-center gap-1.5 bg-zinc-900/70 px-2 py-1 rounded-lg border border-zinc-800/80">
                                 <span className="w-2 h-2 rounded-full bg-indigo-400 shrink-0" />
                                 <span className="truncate">Asfalto/Pietra {analysis.surfaces.asphaltPavedPct}% ({analysis.surfaces.asphaltPavedKm}km)</span>
                               </div>
                             </div>
                           </div>
                         </div>
                       );
                     })() : (
                       <div className="flex items-center justify-between text-xs text-zinc-400 py-1.5">
                         <span>Tocca "Aggiorna" per avviare l'analisi del percorso.</span>
                         <button
                           type="button"
                           onClick={() => runGpxTrailAnalysis(currentStatsTrack)}
                           className="px-2.5 py-1 rounded-lg bg-orange-600 hover:bg-orange-500 text-white text-[10px] font-bold cursor-pointer"
                         >
                           Analizza Percorso
                         </button>
                       </div>
                     )}
                   </div>

                 {/* --- [MODULAR FEATURE 1] GPX WEATHER WATCH PANEL (CON SELETTORE DATA E ORA DI PARTENZA + CACHE OFFLINE) --- */}
                 {(!isOffline || Boolean(gpxWeatherWatch[currentStatsTrack.id])) && (
                   <div className="bg-zinc-950/80 border border-zinc-800 rounded-2xl p-3 space-y-2.5">
                     <div className="flex items-center justify-between gap-2 flex-wrap">
                       <span className="text-[10px] font-bold uppercase tracking-wider text-zinc-400 flex items-center gap-1.5">
                         <CloudSun size={13} className="text-orange-500" /> GPX Weather Watch (Meteo sul Tracciato)
                       </span>
                       {gpxWeatherWatch[currentStatsTrack.id] && (
                         <span className="text-[10px] font-mono text-blue-300 bg-blue-950/60 border border-blue-800/50 px-2 py-0.5 rounded-md">
                           0° Termico: {gpxWeatherWatch[currentStatsTrack.id].freezingLevel}m
                         </span>
                       )}
                     </div>

                     {/* Selettore Data e Ora di Partenza (layout compatto originario con input di testo per apertura tastiera come nella ricerca) */}
                     <div className="flex items-center justify-between gap-2 bg-zinc-900/80 border border-zinc-800/80 rounded-xl px-2.5 py-1.5 flex-wrap">
                       <div className="flex items-center gap-1.5 text-[10px] font-semibold text-zinc-300">
                         <Calendar size={12} className="text-orange-400 shrink-0" />
                         <span>Partenza:</span>
                       </div>
                       <div className="flex items-center gap-1.5 flex-wrap">
                         <input
                           type="text"
                           value={gpxDateDraft}
                           onChange={e => {
                             const val = e.target.value;
                             setGpxDateDraft(val);
                             const parsed = tryParseIsoDate(val);
                             if (parsed) {
                               setGpxWeatherDepartureDate(parsed);
                             }
                           }}
                           onBlur={e => commitGpxDateDraft(e.target.value)}
                           onKeyDown={e => {
                             if (e.key === 'Enter') {
                               commitGpxDateDraft((e.target as HTMLInputElement).value);
                               (e.target as HTMLInputElement).blur();
                             }
                           }}
                           placeholder="GG/MM/AAAA"
                           className="w-[92px] bg-zinc-950 border border-zinc-700 rounded-lg px-2 py-1 text-[11px] font-mono text-zinc-200 focus:ring-2 focus:ring-orange-500 focus:border-orange-500 outline-none text-center"
                           title="Data di partenza (GG/MM/AAAA)"
                         />
                         <input
                           type="text"
                           value={gpxTimeDraft}
                           onChange={e => {
                             const val = e.target.value;
                             setGpxTimeDraft(val);
                             const match = val.trim().match(/^(\d{1,2}):(\d{2})$/);
                             if (match) {
                               const hh = parseInt(match[1], 10);
                               const mm = parseInt(match[2], 10);
                               if (hh >= 0 && hh <= 23 && mm >= 0 && mm <= 59) {
                                 setGpxWeatherDepartureTime(`${String(hh).padStart(2, '0')}:${String(mm).padStart(2, '0')}`);
                               }
                             }
                           }}
                           onBlur={e => commitGpxTimeDraft(e.target.value)}
                           onKeyDown={e => {
                             if (e.key === 'Enter') {
                               commitGpxTimeDraft((e.target as HTMLInputElement).value);
                               (e.target as HTMLInputElement).blur();
                             }
                           }}
                           placeholder="OO:MM"
                           className="w-[62px] bg-zinc-950 border border-zinc-700 rounded-lg px-2 py-1 text-[11px] font-mono text-zinc-200 focus:ring-2 focus:ring-orange-500 focus:border-orange-500 outline-none text-center"
                           title="Ora di partenza (OO:MM)"
                         />
                         <button
                           type="button"
                           onClick={() => {
                             const now = new Date();
                             setGpxWeatherDepartureDate(
                               `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`
                             );
                             setGpxWeatherDepartureTime(
                               `${String(now.getHours()).padStart(2, '0')}:${String(now.getMinutes()).padStart(2, '0')}`
                             );
                           }}
                           className="px-2 py-1 rounded-lg bg-zinc-800 hover:bg-zinc-700 text-[10px] font-bold text-orange-400 border border-zinc-700 transition-colors cursor-pointer"
                           title="Imposta data e ora attuali"
                         >
                           Adesso
                         </button>
                       </div>
                     </div>

                     {isLoadingGpxWeather ? (
                       <div className="flex items-center gap-2 text-xs text-zinc-400 py-2">
                         <Loader2 size={14} className="animate-spin text-orange-500" />
                         <span>Calcolo meteo orario per Partenza, Quota Max e Arrivo...</span>
                       </div>
                     ) : gpxWeatherWatch[currentStatsTrack.id] ? (
                       <>
                         {/* Alert Badges */}
                         <div className="space-y-1">
                           {gpxWeatherWatch[currentStatsTrack.id].alerts.map((al, i) => (
                             <div
                               key={i}
                               className={`px-2.5 py-1.5 rounded-xl border text-[11px] font-semibold flex items-center gap-2 ${
                                 al.level === 'danger'
                                   ? 'bg-red-950/50 border-red-500/50 text-red-300'
                                   : al.level === 'warn'
                                   ? 'bg-amber-950/40 border-amber-500/40 text-amber-300'
                                   : 'bg-emerald-950/40 border-emerald-500/30 text-emerald-300'
                               }`}
                             >
                               <AlertCircle size={13} className="shrink-0" />
                               <span>{al.message}</span>
                             </div>
                           ))}
                         </div>

                         {/* 3 Key Checkpoints con Orario Stimato di Passaggio */}
                         <div className="grid grid-cols-3 gap-2">
                           {gpxWeatherWatch[currentStatsTrack.id].checkpoints.map((cp, idx) => (
                             <button
                               key={idx}
                               onClick={() => {
                                 setHoveredTrackIndex(cp.pointIndex);
                                 if (mapRef.current) {
                                   mapRef.current.panTo([cp.lat, cp.lng], { animate: true });
                                 }
                               }}
                               className="bg-zinc-900 hover:bg-zinc-800/90 border border-zinc-800 rounded-xl p-2 text-left transition-colors cursor-pointer"
                               title="Tocca per evidenziare questo punto sulla mappa e sul grafico"
                             >
                               <div className="flex items-center justify-between gap-1 mb-0.5">
                                 <span className="text-[9px] font-bold uppercase text-zinc-400 truncate">
                                   {cp.label}
                                 </span>
                                 <span className="text-[9px] font-mono text-orange-400">{cp.ele}m</span>
                               </div>
                               {cp.passageTime && (
                                 <div className="text-[9px] font-mono text-emerald-400/90 mb-1 flex items-center gap-1">
                                   <Clock size={9} className="shrink-0" />
                                   <span>ore {cp.passageTime}</span>
                                 </div>
                               )}
                               <div className="flex items-center gap-1.5">
                                 {getWeatherIcon(cp.weatherCode)}
                                 <span className="text-xs font-bold text-white">{cp.temp}°C</span>
                               </div>
                               <div className="text-[9px] font-mono text-zinc-400 mt-1 flex items-center justify-between">
                                 <span>Vento {cp.windGusts}km/h</span>
                                 {cp.precipProb > 0 && <span className="text-blue-400">{cp.precipProb}%</span>}
                               </div>
                             </button>
                           ))}
                         </div>
                       </>
                     ) : null}
                   </div>
                 )}
               </>
            )}
         </div>
      </div>
      
      {/* --- [LOCKED FEATURE] DETAIL PANEL (FULL SCREEN) --- */}
      {/* DO NOT MODIFY WITHOUT PERMISSION */}
      <div ref={detailPanelRef} className={`fixed inset-0 z-[5000] bg-zinc-950 transition-transform duration-300 ease-in-out flex flex-col ${isDetailPanelOpen && selectedPoi ? 'translate-x-0' : 'translate-x-full'}`}>
        
        {/* Full Page Sticky Header */}
        <div className="sticky top-0 z-10 bg-zinc-950/90 backdrop-blur border-b border-zinc-800 p-4 flex items-center justify-between">
            <button onClick={() => setIsDetailPanelOpen(false)} className="p-2 bg-zinc-800 hover:bg-zinc-700 rounded-full text-white transition-colors border border-zinc-700">
                <ChevronLeft size={24}/>
            </button>
            <div className="flex gap-2">
                <button onClick={handleShowOnMap} className="p-2 bg-zinc-800 rounded-xl text-zinc-400 hover:text-white border border-zinc-700" title="Vedi su Mappa"><MapIcon size={20}/></button>
                <button onClick={handleShowInList} className="p-2 bg-zinc-800 rounded-xl text-zinc-400 hover:text-white border border-zinc-700" title="Vedi in Lista"><List size={20}/></button>
                <button onClick={(e) => selectedPoi && toggleFavorite(e, selectedPoi)} className={`p-2 bg-zinc-800 rounded-xl border border-zinc-700 ${selectedPoi && favorites.has(selectedPoi.id) ? 'text-red-500' : 'text-zinc-400 hover:text-white'}`}><Heart size={20} className={selectedPoi && favorites.has(selectedPoi.id) ? "fill-red-500" : ""}/></button>
            </div>
        </div>

        {/* Content */}
        <div ref={detailScrollRef} className="flex-1 overflow-y-auto p-6 space-y-8 pb-20">
            {selectedPoi && (
                <>
                    {/* Header Info - Reorganized without Image */}
                    <div>
                        <h2 className="text-3xl font-bold text-white mb-3 leading-tight pt-2">{selectedPoi.name}</h2>
                        <div className="flex items-center flex-wrap gap-3 text-sm text-zinc-400 mb-6">
                            <span className={`font-bold uppercase tracking-wider px-2 py-1 rounded border ${selectedPoi.type === POIType.REFUGE ? 'text-rose-400 bg-rose-500/10 border-rose-500/30' : selectedPoi.type === POIType.FOUNTAIN ? 'text-sky-400 bg-sky-500/10 border-sky-500/30' : selectedPoi.type === POIType.PICNIC ? 'text-emerald-400 bg-emerald-500/10 border-emerald-500/30' : selectedPoi.type === POIType.VIEWPOINT ? 'text-purple-400 bg-purple-500/10 border-purple-500/30' : 'text-orange-500 bg-orange-500/10 border-orange-500/20'}`}>{selectedPoi.type}</span>
                            <span className="font-mono bg-zinc-900 border border-zinc-800 px-2 py-1 rounded text-zinc-300">{selectedPoi.altitude > 0 ? `${selectedPoi.altitude}m s.l.m.` : 'Rilevamento altitudine...'}</span>
                            <span>{selectedPoi.exposure}</span>
                            {/* HEADER SNOW/ICE BADGE */}
                            {geoAnalysis?.weather && (geoAnalysis.weather.snowDepth > 0 || (selectedPoi.altitude > geoAnalysis.weather.freezingLevel && geoAnalysis.weather.temp < 2)) && (
                                <span className={`flex items-center gap-1 font-bold uppercase tracking-wider px-2 py-1 rounded border animate-pulse ${geoAnalysis.weather.snowDepth > 0 ? 'bg-blue-500/20 text-blue-200 border-blue-500/30' : 'bg-cyan-500/20 text-cyan-200 border-cyan-500/30'}`}>
                                    <Snowflake size={12}/> {geoAnalysis.weather.snowDepth > 0 ? `Neve: ${geoAnalysis.weather.snowDepth}m` : 'Rischio Ghiaccio'}
                                </span>
                            )}
                        </div>
                        <p className="text-zinc-300 leading-relaxed text-lg">{selectedPoi.description}</p>

                        {/* Extended Technical Attributes Grid */}
                        <div className="grid grid-cols-2 sm:grid-cols-3 gap-2.5 mt-4">
                            {selectedPoi.capacity ? (
                                <div className="bg-zinc-900 border border-zinc-800 p-3 rounded-xl flex items-center gap-2.5">
                                    <BedDouble size={18} className="text-orange-500 shrink-0"/>
                                    <div>
                                        <div className="text-[10px] text-zinc-500 uppercase font-bold">Posti Letto</div>
                                        <div className="text-xs font-bold text-zinc-200">{selectedPoi.capacity} posti</div>
                                    </div>
                                </div>
                            ) : null}
                            {selectedPoi.operator ? (
                                <div className="bg-zinc-900 border border-zinc-800 p-3 rounded-xl flex items-center gap-2.5">
                                    <Building size={18} className="text-blue-400 shrink-0"/>
                                    <div className="min-w-0">
                                        <div className="text-[10px] text-zinc-500 uppercase font-bold">Gestione</div>
                                        <div className="text-xs font-bold text-zinc-200 truncate">{selectedPoi.operator}</div>
                                    </div>
                                </div>
                            ) : null}
                            {selectedPoi.hikingDifficulty ? (
                                <div className="bg-zinc-900 border border-zinc-800 p-3 rounded-xl flex items-center gap-2.5">
                                    <Footprints size={18} className="text-amber-500 shrink-0"/>
                                    <div>
                                        <div className="text-[10px] text-zinc-500 uppercase font-bold">Difficoltà</div>
                                        <div className="text-xs font-bold text-zinc-200">{selectedPoi.hikingDifficulty.toUpperCase()}</div>
                                    </div>
                                </div>
                            ) : null}
                            {selectedPoi.material ? (
                                <div className="bg-zinc-900 border border-zinc-800 p-3 rounded-xl flex items-center gap-2.5">
                                    <Home size={18} className="text-zinc-400 shrink-0"/>
                                    <div>
                                        <div className="text-[10px] text-zinc-500 uppercase font-bold">Materiale</div>
                                        <div className="text-xs font-bold text-zinc-200 capitalize">{selectedPoi.material}</div>
                                    </div>
                                </div>
                            ) : null}
                            <div className="bg-zinc-900 border border-zinc-800 p-3 rounded-xl flex items-center gap-2.5">
                                <Droplets size={18} className={selectedPoi.hasWater ? "text-blue-400 shrink-0" : "text-zinc-600 shrink-0"}/>
                                <div>
                                    <div className="text-[10px] text-zinc-500 uppercase font-bold">Acqua</div>
                                    <div className="text-xs font-bold text-zinc-200">{selectedPoi.hasWater ? 'Presente' : 'Assente'}</div>
                                </div>
                            </div>
                            <div className="bg-zinc-900 border border-zinc-800 p-3 rounded-xl flex items-center gap-2.5">
                                <Flame size={18} className={selectedPoi.hasFireplace ? "text-yellow-500 shrink-0" : "text-zinc-600 shrink-0"}/>
                                <div>
                                    <div className="text-[10px] text-zinc-500 uppercase font-bold">Stufa/Riscaldamento</div>
                                    <div className="text-xs font-bold text-zinc-200">{selectedPoi.hasFireplace ? 'Disponibile' : 'Assente'}</div>
                                </div>
                            </div>
                        </div>

                        {/* Link Esterni, Pianificatore Tour, Navigazione Bussola & Export GPX */}
                        <div className="flex flex-wrap gap-2 pt-3">
                            <button
                                onClick={() => {
                                    toggleWaypointInTour({
                                        id: selectedPoi.id,
                                        name: selectedPoi.name,
                                        lat: selectedPoi.coordinates.lat,
                                        lng: selectedPoi.coordinates.lng,
                                        altitude: selectedPoi.altitude || null,
                                        category: selectedPoi.type,
                                    });
                                    setIsDetailPanelOpen(false);
                                    setViewMode('map');
                                }}
                                className={`inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg border text-xs font-semibold transition-colors cursor-pointer ${
                                    tourWaypoints.some(w => w.id === selectedPoi.id)
                                        ? 'bg-emerald-500/20 border-emerald-400 text-emerald-200'
                                        : 'bg-zinc-900 hover:bg-zinc-800 border-emerald-500/40 text-emerald-400 hover:text-emerald-300'
                                }`}
                            >
                                <Route size={14}/>
                                {tourWaypoints.some(w => w.id === selectedPoi.id)
                                    ? `Nel Tour (Tappa #${tourWaypoints.findIndex(w => w.id === selectedPoi.id) + 1} · Rimuovi)`
                                    : '+ Aggiungi al Tour (Pianifica)'}
                            </button>
                            <button onClick={openGoogleMapsReview} className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-zinc-900 hover:bg-zinc-800 border border-zinc-800 text-xs text-zinc-300 hover:text-white transition-colors cursor-pointer">
                                <Navigation size={14} className="text-orange-500"/> Apri in Google Maps
                            </button>
                            <button
                                onClick={() => {
                                    setTargetLock(prev => {
                                        if (prev?.id === selectedPoi.id) {
                                            showToast("Target Lock disattivato");
                                            return null;
                                        }
                                        showToast(`Target bloccato: ${selectedPoi.name}`);
                                        return {
                                            id: selectedPoi.id,
                                            name: selectedPoi.name,
                                            lat: selectedPoi.coordinates.lat,
                                            lng: selectedPoi.coordinates.lng,
                                            altitude: selectedPoi.altitude || null,
                                        };
                                    });
                                    setIsDetailPanelOpen(false);
                                    setViewMode('map');
                                }}
                                className={`inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg border text-xs font-semibold transition-colors cursor-pointer ${
                                    targetLock?.id === selectedPoi.id
                                        ? 'bg-cyan-500/20 border-cyan-400 text-cyan-200'
                                        : 'bg-zinc-900 hover:bg-zinc-800 border-zinc-800 text-cyan-400 hover:text-cyan-300'
                                }`}
                            >
                                <Compass size={14}/> {targetLock?.id === selectedPoi.id ? 'Target Bloccato (Attivo)' : 'Punta con Bussola (Target Lock)'}
                            </button>
                            <button
                                onClick={() => exportPoisToGpx('single', selectedPoi)}
                                className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-zinc-900 hover:bg-zinc-800 border border-zinc-800 text-xs text-zinc-300 hover:text-white transition-colors cursor-pointer"
                            >
                                <Download size={14} className="text-emerald-400"/> Scarica Waypoint .GPX
                            </button>
                            {selectedPoi.wikipediaLink && (
                                <a href={selectedPoi.wikipediaLink} target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-zinc-900 hover:bg-zinc-800 border border-zinc-800 text-xs text-zinc-300 hover:text-white transition-colors">
                                    <BookOpen size={14} className="text-blue-400"/> Wikipedia
                                </a>
                            )}
                            {selectedPoi.website && (
                                <a href={selectedPoi.website} target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-zinc-900 hover:bg-zinc-800 border border-zinc-800 text-xs text-zinc-300 hover:text-white transition-colors">
                                    <Globe size={14} className="text-emerald-400"/> Sito Ufficiale
                                </a>
                            )}
                        </div>
                    </div>

                    {/* --- [MODULAR FEATURE 2] CALCOLATORE AVVICINAMENTO CAI & EFFEMERIDI SOLARI --- */}
                    {(() => {
                        const origin = userLocation || (currentStatsTrack?.points?.[0] ? { lat: currentStatsTrack.points[0].lat, lng: currentStatsTrack.points[0].lng } : mapViewState.current.center);
                        const originLabel = userLocation ? 'dalla tua posizione GPS' : currentStatsTrack ? 'da inizio traccia GPX' : 'dal centro mappa attuale';
                        const originAlt = currentStatsTrack?.points?.[0]?.ele || 1200;
                        const cai = computeCaiWalkingEstimate(
                            origin.lat,
                            origin.lng,
                            originAlt,
                            selectedPoi.coordinates.lat,
                            selectedPoi.coordinates.lng,
                            selectedPoi.altitude || originAlt
                        );
                        const solar = computeSolarTimes(
                            selectedPoi.coordinates.lat,
                            selectedPoi.coordinates.lng,
                            selectedPoi.altitude || 0
                        );
                        return (
                            <div className="bg-zinc-900 rounded-3xl p-6 border border-zinc-800 space-y-5">
                                <div className="flex items-center justify-between flex-wrap gap-2">
                                    <h3 className="text-sm font-bold text-zinc-400 uppercase tracking-wider flex items-center gap-2">
                                        <Compass size={16} className="text-orange-500"/> Stima Avvicinamento CAI & Effemeridi
                                    </h3>
                                    <span className="text-[11px] font-mono text-zinc-500">Calcolato {originLabel}</span>
                                </div>

                                <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
                                    <div className="bg-zinc-950 p-3.5 rounded-2xl border border-zinc-800/70">
                                        <div className="text-[10px] text-zinc-500 uppercase font-bold mb-1">Tempo Marcia CAI</div>
                                        <div className="text-xl font-bold text-orange-400 font-mono">~{cai.caiTimeFormatted}</div>
                                        <div className="text-[10px] text-zinc-500 mt-0.5">Formula Munter / CAI</div>
                                    </div>
                                    <div className="bg-zinc-950 p-3.5 rounded-2xl border border-zinc-800/70">
                                        <div className="text-[10px] text-zinc-500 uppercase font-bold mb-1">Distanza Stimata</div>
                                        <div className="text-xl font-bold text-white font-mono">{cai.trailDistKm.toFixed(1)} km</div>
                                        <div className="text-[10px] text-zinc-500 mt-0.5">Linea d'aria: {cai.linearDistKm.toFixed(1)} km</div>
                                    </div>
                                    <div className="bg-zinc-950 p-3.5 rounded-2xl border border-zinc-800/70">
                                        <div className="text-[10px] text-zinc-500 uppercase font-bold mb-1">Dislivello Δh</div>
                                        <div className={`text-xl font-bold font-mono ${cai.deltaH >= 0 ? 'text-emerald-400' : 'text-sky-400'}`}>
                                            {cai.deltaH >= 0 ? `+${cai.deltaH}m` : `${cai.deltaH}m`}
                                        </div>
                                        <div className="text-[10px] text-zinc-500 mt-0.5">Azimut: {cai.bearingDeg}° {cai.bearingCardinal}</div>
                                    </div>
                                    <div className="bg-zinc-950 p-3.5 rounded-2xl border border-zinc-800/70">
                                        <div className="text-[10px] text-zinc-500 uppercase font-bold mb-1">Effemeridi Quota</div>
                                        <div className="text-sm font-bold text-amber-300 font-mono flex items-center gap-2">
                                            <span>☀ {solar.sunrise}</span>
                                            <span>☾ {solar.sunset}</span>
                                        </div>
                                        <div className="text-[10px] text-zinc-400 mt-1 truncate">{solar.remainingLightLabel}</div>
                                    </div>
                                </div>
                            </div>
                        );
                    })()}

                    {/* NEAREST WATER SOURCES */}
                    {nearestWaterSources.length > 0 && (
                        <div>
                            <h3 className="text-sm font-bold text-zinc-500 uppercase tracking-wider mb-4 flex items-center gap-2"><Droplets size={16}/> Fonti d'acqua vicine</h3>
                            <div className="space-y-3">
                                {nearestWaterSources.map(water => (
                                    <div key={water.id} onClick={() => setSelectedPoi(water)} className="flex items-center justify-between p-4 bg-zinc-900/50 hover:bg-zinc-900 border border-zinc-800 rounded-2xl cursor-pointer transition-colors group">
                                        <div className="flex items-center gap-4">
                                            <div className="w-10 h-10 rounded-full bg-blue-900/20 text-blue-400 flex items-center justify-center group-hover:bg-blue-600 group-hover:text-white transition-colors border border-blue-500/20">
                                                <Droplets size={18}/>
                                            </div>
                                            <div>
                                                <div className="text-base font-bold text-zinc-200">{water.name}</div>
                                                <div className="text-xs text-zinc-500 font-mono">{water.altitude}m • {(water as any).distance.toFixed(1)}km</div>
                                            </div>
                                        </div>
                                        <ChevronRight size={20} className="text-zinc-600 group-hover:text-white transition-colors"/>
                                    </div>
                                ))}
                            </div>
                        </div>
                    )}

                    {/* ENVIRONMENT ANALYSIS (PHYSICS BASED) */}
                    <div className="bg-zinc-900 rounded-3xl p-6 border border-zinc-800">
                        <h3 className="text-sm font-bold text-zinc-400 uppercase tracking-wider mb-6 flex items-center gap-2">
                            <Mountain size={16} className="text-zinc-500"/> Dati Ambientali & Meteo
                        </h3>
                        {isLoadingAnalysis ? (
                            <div className="flex flex-col items-center justify-center gap-3 text-zinc-500 py-8">
                                <Loader2 size={24} className="animate-spin text-orange-500"/> 
                                <p>Calcolo esposizione e meteo...</p>
                            </div>
                        ) : geoAnalysis ? (
                            <div className="space-y-6">
                                {/* Signal & Terrain */}
                                <div className="grid grid-cols-2 gap-4">
                                    <div className="bg-zinc-950 p-4 rounded-2xl border border-zinc-800/50">
                                        <div className="text-[10px] text-zinc-500 uppercase font-bold mb-2">Segnale Cellulare</div>
                                        <div className={`text-2xl font-bold ${geoAnalysis.signalEstimate.level === SignalStrength.NONE ? 'text-red-400' : 'text-emerald-400'}`}>{geoAnalysis.signalEstimate.level}</div>
                                        <div className="text-xs text-zinc-500 leading-tight mt-1">{geoAnalysis.signalEstimate.reason}</div>
                                    </div>
                                    <div className="bg-zinc-950 p-4 rounded-2xl border border-zinc-800/50">
                                        <div className="text-[10px] text-zinc-500 uppercase font-bold mb-2">Morfologia</div>
                                        <div className="text-lg font-bold text-white leading-tight">{geoAnalysis.terrainType}</div>
                                        <div className="text-xs text-zinc-500 leading-tight mt-1">Esposizione: {geoAnalysis.exposure}</div>
                                    </div>
                                </div>

                                {/* Live Weather Data - Altitude Specific */}
                                {geoAnalysis.weather && (
                                    <div className="bg-gradient-to-br from-blue-950/40 to-zinc-950 p-5 rounded-2xl border border-blue-900/30">
                                        <div className="flex justify-between items-center mb-6">
                                            <div className="flex items-center gap-3">
                                                <div className="p-2 bg-blue-500/10 rounded-lg text-blue-400">
                                                    {getWeatherIcon(geoAnalysis.weather.conditionCode)}
                                                </div>
                                                <div>
                                                    <span className="block text-lg font-bold text-zinc-100">{geoAnalysis.weather.description}</span>
                                                    <span className="text-xs text-blue-300 font-bold">Meteo a quota {selectedPoi.altitude}m</span>
                                                </div>
                                            </div>
                                            <div className="text-3xl font-bold text-white">{Math.round(geoAnalysis.weather.temp)}°</div>
                                        </div>
                                        
                                        {/* ENHANCED SNOW/ICE WIDGET */}
                                        {(geoAnalysis.weather.snowDepth > 0 || (selectedPoi.altitude > geoAnalysis.weather.freezingLevel && geoAnalysis.weather.temp < 2)) && (
                                            <div className={`p-4 rounded-2xl border mb-4 flex items-center justify-between ${
                                                geoAnalysis.weather.snowDepth > 0 
                                                ? 'bg-gradient-to-r from-blue-900/40 to-indigo-900/40 border-blue-400/30' 
                                                : 'bg-cyan-900/20 border-cyan-500/30'
                                            }`}>
                                                <div className="flex items-center gap-3">
                                                    <div className={`p-2.5 rounded-full ${geoAnalysis.weather.snowDepth > 0 ? 'bg-white/10' : 'bg-cyan-500/20'}`}>
                                                        <Snowflake size={24} className={geoAnalysis.weather.snowDepth > 0 ? "text-white" : "text-cyan-400"} />
                                                    </div>
                                                    <div>
                                                        <h4 className="font-bold text-zinc-100 text-sm uppercase tracking-wide">
                                                            {geoAnalysis.weather.snowDepth > 0 ? 'Copertura Nevosa' : 'Rischio Ghiaccio'}
                                                        </h4>
                                                        <p className="text-xs text-zinc-400">
                                                            {geoAnalysis.weather.snowDepth > 0 
                                                                ? `Stimati ${geoAnalysis.weather.snowDepth} metri al suolo` 
                                                                : `Temperatura sotto zero (${Math.round(geoAnalysis.weather.temp)}°C)`}
                                                        </p>
                                                    </div>
                                                </div>
                                                {geoAnalysis.weather.snowDepth > 0 && (
                                                    <div className="text-right">
                                                        <span className="block text-2xl font-bold text-white leading-none">{geoAnalysis.weather.snowDepth}</span>
                                                        <span className="text-[10px] text-blue-200 uppercase">Metri</span>
                                                    </div>
                                                )}
                                            </div>
                                        )}

                                        {/* HOURLY FORECAST SCROLL (Timeline Style) */}
                                        {geoAnalysis.weather.hourly && geoAnalysis.weather.hourly.length > 0 && (
                                            <div className="mb-6">
                                                <h4 className="text-xs font-bold text-zinc-400 uppercase tracking-wider mb-3 pl-1 flex items-center gap-2">
                                                    <Clock size={12}/> Prossime 24 Ore
                                                </h4>
                                                <div className="flex overflow-x-auto pb-4 gap-3 hide-scrollbar snap-x">
                                                    {geoAnalysis.weather.hourly.map((h, i) => (
                                                        <div key={i} className="flex flex-col items-center min-w-[60px] p-2 bg-white/5 rounded-xl border border-white/5 snap-start">
                                                            <span className="text-[10px] text-zinc-400 font-mono mb-1">{h.time}</span>
                                                            <div className="mb-1">{getWeatherIcon(h.conditionCode)}</div>
                                                            <span className="text-sm font-bold text-white mb-1">{Math.round(h.temp)}°</span>
                                                            {h.precipProb > 0 ? (
                                                                <div className="flex flex-col items-center w-full">
                                                                    <div className="h-8 w-1.5 bg-zinc-800 rounded-full relative overflow-hidden">
                                                                        <div className="absolute bottom-0 w-full bg-blue-500 rounded-full" style={{ height: `${h.precipProb}%` }}></div>
                                                                    </div>
                                                                    <span className="text-[9px] text-blue-400 font-bold mt-1">{h.precipProb}%</span>
                                                                </div>
                                                            ) : (
                                                                <div className="h-12 w-full flex items-end justify-center">
                                                                    <span className="text-[9px] text-zinc-600">-</span>
                                                                </div>
                                                            )}
                                                        </div>
                                                    ))}
                                                </div>
                                            </div>
                                        )}
                                        
                                        <div className="grid grid-cols-2 gap-3 text-center mb-3">
                                            <div className="bg-zinc-950/50 p-3 rounded-xl border border-zinc-800/50">
                                                <div className="text-[10px] text-zinc-500 uppercase mb-1">Vento</div>
                                                <div className="text-sm font-bold text-white">{geoAnalysis.weather.windSpeed}</div>
                                                <div className="text-[10px] text-zinc-500">km/h {geoAnalysis.weather.windDirText}</div>
                                            </div>
                                            
                                            <div className={`bg-zinc-950/50 p-3 rounded-xl border border-zinc-800/50 ${selectedPoi.altitude > geoAnalysis.weather.freezingLevel ? 'border-blue-500/30 bg-blue-900/10' : ''}`}>
                                                <div className="text-[10px] text-zinc-500 uppercase mb-1">Zero Termico</div>
                                                <div className={`text-sm font-bold ${selectedPoi.altitude > geoAnalysis.weather.freezingLevel ? 'text-blue-300' : 'text-white'}`}>{geoAnalysis.weather.freezingLevel}m</div>
                                            </div>
                                        </div>

                                        {/* Meteoblue & Weather Provider Info */}
                                        <div className="mt-4 pt-3 border-t border-blue-900/40 flex flex-col gap-2">
                                            <div className="flex items-center justify-between text-[11px] text-zinc-400">
                                                <span className="flex items-center gap-1.5 text-zinc-300">
                                                    <span className="w-2 h-2 rounded-full bg-emerald-400"></span>
                                                    Dati Live: Open-Meteo (DWD ICON-D2 2.2km / ECMWF)
                                                </span>
                                            </div>
                                            <a 
                                                href={`https://www.meteoblue.com/it/tempo/settimana/${selectedPoi.coordinates.lat.toFixed(4)}N${selectedPoi.coordinates.lng.toFixed(4)}E`}
                                                target="_blank" 
                                                rel="noopener noreferrer"
                                                className="w-full py-2.5 px-3 bg-blue-600/20 hover:bg-blue-600/30 border border-blue-500/40 hover:border-blue-400 text-blue-200 rounded-xl text-xs font-bold flex items-center justify-center gap-2 transition-all shadow-sm cursor-pointer"
                                            >
                                                <Globe size={14} className="text-blue-400"/>
                                                <span>Confronta con Meteoblue ({selectedPoi.coordinates.lat.toFixed(2)}°, {selectedPoi.coordinates.lng.toFixed(2)}°) ↗</span>
                                            </a>
                                        </div>
                                    </div>
                                )}
                            </div>
                        ) : (
                            <div className="text-zinc-500 text-sm p-4 text-center border border-dashed border-zinc-800 rounded-xl">Dati offline non disponibili.</div>
                        )}
                    </div>

                    {/* Note Personali & Tag Rapidi da Campo */}
                    <div className="pb-8">
                        <div className="flex items-center justify-between mb-3">
                            <h3 className="text-sm font-bold text-zinc-400 uppercase tracking-wider">Le tue note da campo</h3>
                            <span className="text-[10px] font-mono text-emerald-400 bg-emerald-950/40 border border-emerald-800/40 px-2 py-0.5 rounded-md">
                                Salvate Offline + Backup
                            </span>
                        </div>
                        <div className="flex flex-wrap gap-1.5 mb-3">
                            {[
                                'Acqua attiva',
                                'Fonte secca',
                                'Legna presente',
                                'Coperte presenti',
                                'Stufa funzionante',
                                'Sentiero agibile',
                            ].map(tag => (
                                <button
                                    key={tag}
                                    type="button"
                                    onClick={() => {
                                        setUserNoteDraft(prev => {
                                            const clean = prev.trim();
                                            if (clean.includes(tag)) return prev;
                                            return clean ? `${clean} • ${tag}` : tag;
                                        });
                                    }}
                                    className="px-2.5 py-1 rounded-lg bg-zinc-900 hover:bg-zinc-800 border border-zinc-800 text-[11px] text-zinc-300 hover:text-white transition-colors cursor-pointer"
                                >
                                    + {tag}
                                </button>
                            ))}
                        </div>
                        <textarea 
                            value={userNoteDraft}
                            onChange={(e) => setUserNoteDraft(e.target.value)}
                            className="w-full bg-zinc-900 border border-zinc-800 rounded-2xl p-4 text-base text-zinc-200 focus:border-orange-500 outline-none min-h-[120px] resize-none"
                            placeholder="Scrivi qui appunti, condizioni sentiero, legna, stato fonte, ricordi..."
                        />
                        <div className="flex gap-2 mt-3">
                            <button onClick={saveUserNote} className="flex-1 bg-orange-600 hover:bg-orange-500 text-white text-sm font-bold py-3 px-4 rounded-xl transition-colors cursor-pointer shadow">
                                Salva Nota Personale
                            </button>
                            {userNoteDraft.trim().length > 0 && (
                                <button
                                    onClick={() => exportPoisToGpx('single', { ...selectedPoi, userNote: userNoteDraft })}
                                    className="bg-zinc-800 hover:bg-zinc-700 text-zinc-200 text-xs font-bold py-3 px-4 rounded-xl transition-colors border border-zinc-700 flex items-center gap-1.5 cursor-pointer"
                                    title="Esporta questo Bivacco con la tua nota in formato GPX"
                                >
                                    <Download size={15} className="text-orange-400"/> .GPX
                                </button>
                            )}
                        </div>
                    </div>
                </>
            )}
        </div>
      </div>

      {/* --- [LOCKED FEATURE] WEATHER PANEL (FULL SCREEN) --- */}
      {/* DO NOT MODIFY WITHOUT PERMISSION */}
      {isWeatherPanelOpen && (
        <div className="fixed inset-0 z-[6000] bg-zinc-950 flex flex-col animate-in fade-in slide-in-from-bottom-10 duration-300">
            {/* Header */}
            <div className="p-4 flex justify-between items-center bg-zinc-950/80 backdrop-blur z-10 sticky top-0 border-b border-zinc-900">
                <h2 className="font-bold text-xl flex items-center gap-3"><CloudSun size={24} className="text-blue-400"/> Meteo Area</h2>
                <button onClick={() => setIsWeatherPanelOpen(false)} className="p-2 bg-zinc-900 hover:bg-zinc-800 rounded-full text-zinc-400 transition-colors border border-zinc-800"><X size={24}/></button>
            </div>
            
            {/* Content */}
            <div className="flex-1 overflow-y-auto p-6 pb-20">
                {isLoadingAreaWeather ? (
                    <div className="flex flex-col items-center justify-center h-full gap-4 text-zinc-500">
                        <Loader2 size={48} className="animate-spin text-blue-500"/>
                        <p className="text-lg">Analisi meteo in corso...</p>
                    </div>
                ) : areaWeatherInfo?.weather ? (
                    <div className="space-y-6 max-w-lg mx-auto">
                        {/* Main Status */}
                        <div className="text-center py-6">
                            <div className="inline-flex items-center justify-center p-6 bg-blue-500/10 rounded-full mb-6 text-blue-400 ring-1 ring-blue-500/20 shadow-2xl shadow-blue-900/20">
                                {getWeatherIconLarge(areaWeatherInfo.weather.conditionCode)}
                            </div>
                            <h3 className="text-6xl font-bold text-white mb-2 tracking-tighter">{Math.round(areaWeatherInfo.weather.temp)}°</h3>
                            <p className="text-zinc-400 text-xl font-medium">{areaWeatherInfo.weather.description}</p>
                            <p className="text-sm text-zinc-500 mt-2">Percepita: {areaWeatherInfo.weather.apparentTemp}°C</p>
                        </div>

                        {/* HOURLY FORECAST (Weather Panel Version) */}
                        {areaWeatherInfo.weather.hourly && areaWeatherInfo.weather.hourly.length > 0 && (
                            <div className="bg-zinc-900 p-4 rounded-2xl border border-zinc-800 mb-6">
                                <h4 className="text-xs font-bold text-zinc-500 uppercase tracking-wider mb-4 flex items-center gap-2"><Clock size={14}/> Previsione Oraria</h4>
                                <div className="flex overflow-x-auto pb-2 gap-4 hide-scrollbar snap-x">
                                    {areaWeatherInfo.weather.hourly.map((h, i) => (
                                        <div key={i} className="flex flex-col items-center min-w-[50px] snap-start">
                                            <span className="text-xs text-zinc-400 font-mono mb-2">{h.time}</span>
                                            <div className="mb-2 scale-110">{getWeatherIcon(h.conditionCode)}</div>
                                            <span className="text-sm font-bold text-white mb-1">{Math.round(h.temp)}°</span>
                                            {h.precipProb > 0 && (
                                                <span className="text-[10px] text-blue-400 font-bold">{h.precipProb}%</span>
                                            )}
                                        </div>
                                    ))}
                                </div>
                            </div>
                        )}

                        {/* EXPANDED GRID DETAILS */}
                        <div className="grid grid-cols-2 gap-3">
                            {/* Wind Extended */}
                            <div className="bg-zinc-900 p-4 rounded-2xl border border-zinc-800">
                                <div className="flex justify-between items-start mb-2">
                                    <span className="text-xs font-bold text-zinc-500 uppercase flex items-center gap-2"><Wind size={14}/> Vento</span>
                                    <span className="text-xs font-mono text-zinc-400">{areaWeatherInfo.weather.windDirText}</span>
                                </div>
                                <div className="text-2xl font-bold text-white">{areaWeatherInfo.weather.windSpeed} <span className="text-sm font-normal text-zinc-500">km/h</span></div>
                                <div className="text-xs text-zinc-500 mt-1">Raffiche: <span className="text-zinc-300">{areaWeatherInfo.weather.windGusts} km/h</span></div>
                            </div>

                            {/* Precipitation / Clouds */}
                            <div className="bg-zinc-900 p-4 rounded-2xl border border-zinc-800">
                                <div className="flex justify-between items-start mb-2">
                                    <span className="text-xs font-bold text-zinc-500 uppercase flex items-center gap-2"><CloudRain size={14}/> Cielo</span>
                                    <span className="text-xs font-mono text-zinc-400">{areaWeatherInfo.weather.cloudCover}% Cop.</span>
                                </div>
                                <div className="text-2xl font-bold text-blue-400">{areaWeatherInfo.weather.precipProb}% <span className="text-sm font-normal text-zinc-500">Prob.</span></div>
                                {areaWeatherInfo.weather.snowDepth > 0 && (
                                    <div className="text-xs text-zinc-500 mt-1">Neve: <span className="text-white">{areaWeatherInfo.weather.snowDepth}m</span></div>
                                )}
                            </div>

                            {/* Atmosphere (Pressure + Vis) */}
                            <div className="bg-zinc-900 p-4 rounded-2xl border border-zinc-800">
                                <div className="flex justify-between items-start mb-2">
                                    <span className="text-xs font-bold text-zinc-500 uppercase flex items-center gap-2"><Gauge size={14}/> Atmosfera</span>
                                </div>
                                <div className="text-xl font-bold text-white">{areaWeatherInfo.weather.pressure} <span className="text-sm font-normal text-zinc-500">hPa</span></div>
                                <div className="text-xs text-zinc-500 mt-1">Visibilità: <span className="text-zinc-300">{(areaWeatherInfo.weather.visibility / 1000).toFixed(1)} km</span></div>
                            </div>

                            {/* Air (Hum + Dew) */}
                            <div className="bg-zinc-900 p-4 rounded-2xl border border-zinc-800">
                                <div className="flex justify-between items-start mb-2">
                                    <span className="text-xs font-bold text-zinc-500 uppercase flex items-center gap-2"><Droplets size={14}/> Aria</span>
                                </div>
                                <div className="text-xl font-bold text-white">{areaWeatherInfo.weather.humidity}% <span className="text-sm font-normal text-zinc-500">Umid.</span></div>
                                <div className="text-xs text-zinc-500 mt-1">Dew Point: <span className="text-zinc-300">{areaWeatherInfo.weather.dewPoint}°</span></div>
                            </div>

                            {/* AQI + UV */}
                            <div className="bg-zinc-900 p-4 rounded-2xl border border-zinc-800">
                                <div className="flex justify-between items-start mb-2">
                                    <span className="text-xs font-bold text-zinc-500 uppercase flex items-center gap-2"><Leaf size={14}/> Qualità</span>
                                </div>
                                <div className="flex items-end justify-between">
                                    <div>
                                        <div className="text-xl font-bold text-white">AQI {areaWeatherInfo.aqi}</div>
                                        <div className="text-xs text-zinc-500 mt-1">UV Index: <span className={areaWeatherInfo.weather.uvIndex > 6 ? "text-orange-400" : "text-zinc-300"}>{areaWeatherInfo.weather.uvIndex}</span></div>
                                    </div>
                                </div>
                            </div>

                            {/* Zero Termico */}
                            <div className="bg-zinc-900 p-4 rounded-2xl border border-zinc-800">
                                <div className="flex justify-between items-start mb-2">
                                    <span className="text-xs font-bold text-zinc-500 uppercase flex items-center gap-2"><ThermometerSun size={14}/> 0° Termico</span>
                                </div>
                                <div className="text-2xl font-bold text-white">{areaWeatherInfo.weather.freezingLevel} <span className="text-sm font-normal text-zinc-500">m</span></div>
                            </div>
                        </div>

                        {/* Sun Cycle */}
                        <div className="bg-zinc-900 p-6 rounded-3xl border border-zinc-800 flex justify-between items-center">
                            <div className="flex flex-col items-center">
                                <Sunrise size={28} className="text-orange-400 mb-2"/>
                                <span className="text-xs text-zinc-500 uppercase font-bold">Alba</span>
                                <span className="text-xl font-bold text-white">{areaWeatherInfo.weather.sunrise}</span>
                            </div>
                            <div className="h-12 w-px bg-zinc-800"></div>
                            <div className="flex flex-col items-center">
                                <Sunset size={28} className="text-purple-400 mb-2"/>
                                <span className="text-xs text-zinc-500 uppercase font-bold">Tramonto</span>
                                <span className="text-xl font-bold text-white">{areaWeatherInfo.weather.sunset}</span>
                            </div>
                        </div>

                        {/* Meteoblue & Weather Provider Reference */}
                        <div className="bg-zinc-900 p-4 rounded-2xl border border-zinc-800 space-y-2.5">
                            <div className="text-left">
                                <span className="text-[10px] font-bold uppercase tracking-wider text-zinc-500">Fonti Previsioni</span>
                                <p className="text-xs text-zinc-300 font-medium">Open-Meteo (DWD ICON-D2 2.2km / ECMWF) & Radar RainViewer</p>
                            </div>
                            <a 
                                href={`https://www.meteoblue.com/it/tempo/settimana/${(mapRef.current ? mapRef.current.getCenter().lat : 46.2).toFixed(4)}N${(mapRef.current ? mapRef.current.getCenter().lng : 11.4).toFixed(4)}E`}
                                target="_blank" 
                                rel="noopener noreferrer"
                                className="w-full py-2.5 px-3 bg-blue-600/20 hover:bg-blue-600/30 border border-blue-500/40 hover:border-blue-400 text-blue-200 rounded-xl text-xs font-bold flex items-center justify-center gap-2 transition-all cursor-pointer shadow-sm"
                            >
                                <Globe size={14} className="text-blue-400"/>
                                <span>Apri Meteogramma Meteoblue per quest'area ↗</span>
                            </a>
                        </div>
                    </div>
                ) : (
                    <div className="flex flex-col items-center justify-center h-full text-zinc-500">
                        <WifiOff size={48} className="mb-4 opacity-50"/>
                        <p className="text-lg">Nessun dato meteo disponibile.</p>
                        <p className="text-sm opacity-60 mt-2">Controlla la connessione internet.</p>
                    </div>
                )}
            </div>
        </div>
      )}

      {/* iOS Safari Install Guide Modal */}
      {showIOSGuide && (
        <div className="fixed inset-0 z-[9500] flex items-center justify-center bg-black/75 backdrop-blur-sm p-4 animate-in fade-in duration-200">
          <div className="w-full max-w-sm rounded-2xl bg-zinc-900 border border-zinc-700 p-6 shadow-2xl">
            <div className="flex justify-between items-start mb-4">
              <div className="flex items-center gap-3">
                <div className="w-10 h-10 rounded-xl bg-orange-600 flex items-center justify-center text-white shadow-md">
                  <Download size={20}/>
                </div>
                <div>
                  <h3 className="font-bold text-base text-white">Installa su iPhone</h3>
                  <p className="text-xs text-zinc-400">Usa MountPro come vera app</p>
                </div>
              </div>
              <button onClick={() => setShowIOSGuide(false)} className="p-1 rounded-lg text-zinc-400 hover:text-white">
                <X size={18}/>
              </button>
            </div>
            <div className="space-y-3 text-xs text-zinc-300 bg-zinc-950 p-4 rounded-xl border border-zinc-800">
              <div className="flex items-start gap-2.5">
                <span className="w-5 h-5 rounded-full bg-orange-600/30 text-orange-400 font-bold flex items-center justify-center shrink-0 text-[11px]">1</span>
                <span>In basso su Safari, tocca il pulsante <strong>Condividi</strong> (quadrato con freccia verso l'alto).</span>
              </div>
              <div className="flex items-start gap-2.5">
                <span className="w-5 h-5 rounded-full bg-orange-600/30 text-orange-400 font-bold flex items-center justify-center shrink-0 text-[11px]">2</span>
                <span>Scorri l'elenco verso il basso e seleziona <strong>"Aggiungi alla schermata Home"</strong>.</span>
              </div>
              <div className="flex items-start gap-2.5">
                <span className="w-5 h-5 rounded-full bg-orange-600/30 text-orange-400 font-bold flex items-center justify-center shrink-0 text-[11px]">3</span>
                <span>Tocca <strong>"Aggiungi"</strong> in alto a destra: troverai l'icona MountPro nella tua Home.</span>
              </div>
            </div>
            <button
              onClick={() => setShowIOSGuide(false)}
              className="mt-4 w-full py-2.5 rounded-xl bg-orange-600 hover:bg-orange-500 text-white font-bold text-xs transition-colors cursor-pointer"
            >
              Ho capito
            </button>
          </div>
        </div>
      )}

      {/* Toast Notification Banner */}
      {toastMessage && (
        <div className="fixed top-20 left-1/2 -translate-x-1/2 z-[9000] bg-zinc-900/95 backdrop-blur border border-orange-500/60 text-white px-4 py-2.5 rounded-xl shadow-2xl text-xs font-bold flex items-center gap-2 animate-in fade-in slide-in-from-top-3 pointer-events-none">
          <CheckCircle2 size={16} className="text-orange-500 shrink-0"/>
          <span>{toastMessage}</span>
        </div>
      )}
    </div>
  );
}