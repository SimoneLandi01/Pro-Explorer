// --- MOUNTPRO EXPLORER - MAIN APP COMPONENT [LOCKED LOGIC] ---
// This file contains the core logic for Map, List, GPX, Weather, and UI.
// Modifications should be minimal to preserve established functionality.

import React, { useState, useMemo, useEffect, useRef } from 'react';
import { fetchOsmPois, searchOsmPoisByName, enrichPoisWithAltitude } from './services/osmService.ts'; 
import { MOCK_POIS } from './constants.tsx';
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
  if (isSelected) {
    const cardWidth = 180; 
    const cardHeight = 125;
    
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

    return L.divIcon({
      className: 'custom-poi-marker-expanded',
      html: `
        <div class="relative flex flex-col items-center origin-bottom transition-all duration-300 ease-out transform scale-100 opacity-100 z-[9999]">
            <div class="bg-zinc-900 border border-zinc-600 rounded-xl shadow-2xl p-3 flex flex-col justify-between cursor-default" style="width: ${cardWidth}px; min-height: ${cardHeight}px;">
                <div>
                   <div class="flex justify-between items-start mb-1">
                      <div class="text-xs font-bold text-orange-500 uppercase tracking-wide">${poi.type}</div>
                      <div class="text-xs font-mono text-zinc-400 border border-zinc-700 px-1.5 rounded">${poi.altitude}m</div>
                   </div>
                   <h3 class="font-bold text-sm text-white leading-tight mb-2 pr-4 line-clamp-2">${poi.name}</h3>
                   
                   <div class="flex items-center gap-2 mb-2">
                      <div class="flex items-center gap-1.5 bg-zinc-800/80 rounded-md px-2 py-1 border border-zinc-700/50">
                         <svg viewBox="0 0 24 24" fill="none" stroke="${signalIconColor}" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="w-3 h-3">
                            <path d="M2 20h.01"/><path d="M7 20v-4"/><path d="M12 20v-8"/><path d="M17 20V8"/><path d="M22 20V4"/>
                         </svg>
                         <span class="text-[10px] font-bold ${signalColor}">${signalText}</span>
                      </div>
                      ${analysis ? `<span class="text-[9px] text-zinc-500 italic truncate max-w-[80px]">Stimato</span>` : ''}
                   </div>
                </div>
                <div class="flex gap-2 mt-auto">
                    <button onclick="window.openMountProDetails(event, '${poi.id}')" class="flex-1 bg-orange-600 hover:bg-orange-700 text-white text-[10px] font-bold py-1.5 rounded-lg transition-colors flex items-center justify-center gap-1 cursor-pointer">
                       Vedi Dettagli
                    </button>
                    <button onclick="window.toggleMountProFavorite(event, '${poi.id}')" class="w-8 h-8 flex items-center justify-center rounded-full border transition-all cursor-pointer ${favBtnClass}">
                       <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="${favIconFill}" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                          <path d="M19 14c1.49-1.46 3-3.21 3-5.5A5.5 5.5 0 0 0 16.5 3c-1.76 0-3 .5-4.5 2-1.5-1.5-2.74-2-4.5-2A5.5 5.5 0 0 0 2 8.5c0 2.3 1.5 4.05 3 5.5l7 7Z"/>
                       </svg>
                    </button>
                </div>
            </div>
            <div class="w-0 h-0 border-l-[8px] border-l-transparent border-r-[8px] border-r-transparent border-t-[8px] border-t-zinc-600 -mt-px"></div>
            <div class="w-1 h-2"></div> 
        </div>
      `,
      iconSize: [cardWidth, cardHeight + 15], 
      iconAnchor: [cardWidth / 2, cardHeight + 15], 
    });
  }

  const size = poi.type === POIType.BIVOUAC ? 34 : 28;
  const baseColor = poi.type === POIType.BIVOUAC ? '#ea580c' : '#3b82f6';
  const color = isFavorite ? '#ef4444' : baseColor;
  
  return L.divIcon({
    className: 'custom-poi-marker',
    html: `
      <div class="w-full h-full drop-shadow-lg transition-all duration-300 origin-bottom hover:scale-110 cursor-pointer">
        <svg viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg" class="w-full h-full">
          ${poi.type === POIType.BIVOUAC 
            ? `<path d="M12 2C7.58 2 4 5.58 4 10C4 14.42 12 22 12 22C12 22 20 14.42 20 10C20 5.58 16.42 2 12 2Z" fill="${color}" stroke="white" stroke-width="1.5"/><path d="M8 8L12 4.5L16 8V12.5H8V8Z" fill="white"/><rect x="10.5" y="10.5" width="3" height="3" fill="${color}"/>`
            : `<circle cx="12" cy="12" r="10" fill="${color}" stroke="white" stroke-width="2"/><path d="M12 18a5 5 0 0 0 5-5c0-1.4-0.7-2.7-2.1-5.1-1.2-1.9-2.1-2.7-2.9-4.5-0.8 1.8-1.7 2.6-2.9 4.5-1.4 2.4-2.1 3.7-2.1 5.1a5 5 0 0 0 5 5z" fill="white"/>`
          }
          ${isFavorite ? `<circle cx="18" cy="6" r="3" fill="#ef4444" stroke="white" stroke-width="1"/>` : ''}
        </svg>
      </div>
    `,
    iconSize: [size, size],
    iconAnchor: [size / 2, size],
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

  // Load from DB on start
  useEffect(() => {
    const loadData = async () => {
      try {
        const storedPois = await dbService.getAllPois();
        if (storedPois.length > 0) {
          setAllPois(storedPois);
        } else {
          // Inizializza con i bivacchi alpini consolidati (MOCK_POIS) se il DB locale è vuoto
          setAllPois(MOCK_POIS);
          await dbService.savePois(MOCK_POIS);
        }
      } catch (e) {
        console.error("Failed to load from DB", e);
        setAllPois(MOCK_POIS);
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
    showToast("Nota salvata!");
  };

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
  }, [allPois]); 

  const [isSearchingArea, setIsSearchingArea] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');
  const [isGlobalSearching, setIsGlobalSearching] = useState(false);
  const [mapStyle, setMapStyle] = useState<'standard' | 'satellite'>('standard');
  const [isLayersMenuOpen, setIsLayersMenuOpen] = useState(false);
  
  // Filters
  const [selectedType, setSelectedType] = useState<POIType | 'All'>(POIType.BIVOUAC);
  const [minAltitude, setMinAltitude] = useState(0);
  const [maxAltitude, setMaxAltitude] = useState(4810);
  const [selectedExposures, setSelectedExposures] = useState<Exposure[]>([]); 
  const [filterWater, setFilterWater] = useState(false);
  const [filterRoof, setFilterRoof] = useState(false);
  const [minCapacity, setMinCapacity] = useState(0);
  const [filterFireplace, setFilterFireplace] = useState(false);
  const [filterFee, setFilterFee] = useState(false); 
  const [filterOpen, setFilterOpen] = useState(false); 
  
  // GPX & Trails State
  const [isTrailsMenuOpen, setIsTrailsMenuOpen] = useState(false);
  
  const [tracks, setTracks] = useState<LoadedTrack[]>([]);
  const [focusedTrackId, setFocusedTrackId] = useState<string | null>(null); 
  const [hoveredTrackIndex, setHoveredTrackIndex] = useState<number | null>(null);
  
  // Track Panel Expansion
  const [isTrackPanelOpen, setIsTrackPanelOpen] = useState(false);
  const [isTrackPanelExpanded, setIsTrackPanelExpanded] = useState(false);
  const touchStartRef = useRef<number | null>(null);
  
  // Memoized point from index
  const hoveredTrackPoint = useMemo(() => {
      if (hoveredTrackIndex === null || !focusedTrackId) return null;
      const track = tracks.find(t => t.id === focusedTrackId) || tracks[0];
      if (!track || !track.points) return null;
      return track.points[hoveredTrackIndex];
  }, [hoveredTrackIndex, focusedTrackId, tracks]);

  const [filterByTrack, setFilterByTrack] = useState(false);
  const [trackBuffer, setTrackBuffer] = useState(2); 

  const mapRef = useRef<L.Map | null>(null);
  const mapContainerRef = useRef<HTMLDivElement>(null);
  const markersRef = useRef<Map<string, L.Marker>>(new Map());
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
  const isOfflineRef = useRef(isOffline);
  const selectedTypeRef = useRef(selectedType);
  const weatherAbortController = useRef<AbortController | null>(null);

  useEffect(() => { isOfflineRef.current = isOffline; }, [isOffline]);
  useEffect(() => { selectedTypeRef.current = selectedType; }, [selectedType]);
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
    if (selectedPoi && !isOffline) {
      setGeoAnalysis(null);
      setIsLoadingAnalysis(true);
      analyzeLocationPhysics(selectedPoi.coordinates.lat, selectedPoi.coordinates.lng)
        .then(data => {
            setGeoAnalysis(data);
            setIsLoadingAnalysis(false);
        });
    } else {
      setGeoAnalysis(null);
    }
  }, [selectedPoi, isOffline]);

  useEffect(() => {
      if (searchTimeoutRef.current) clearTimeout(searchTimeoutRef.current);
      if (isOffline) return;

      if (searchQuery.length < 3) {
          setSearchSuggestions([]);
          setShowSuggestions(false);
          return;
      }

      searchTimeoutRef.current = setTimeout(async () => {
          const results = await searchOsmPoisByName(searchQuery, true);
          setSearchSuggestions(results);
          setShowSuggestions(true);
      }, 300); 
  }, [searchQuery, isOffline]);

  const ensureMarkerVisible = (poi: POI, map: L.Map, isSuggestion: boolean = false) => {
      const targetLatLng = L.latLng(poi.coordinates.lat, poi.coordinates.lng);
      
      if (isSuggestion || !map.getBounds().contains(targetLatLng)) {
          map.flyTo(targetLatLng, 14, { duration: 1.5 });
          return;
      }

      const point = map.latLngToContainerPoint(targetLatLng);
      const mapSize = map.getSize();
      
      const markerHeight = 145; 
      const markerWidth = 180;
      
      const markerTop = point.y - markerHeight;
      const markerBottom = point.y;
      const markerLeft = point.x - (markerWidth / 2);
      const markerRight = point.x + (markerWidth / 2);

      const safeTop = 120; 
      const safeBottom = 120; 
      const safeLeft = 20; 
      const safeRight = 80; 

      let dx = 0;
      let dy = 0;

      if (markerTop < safeTop) {
          dy = markerTop - safeTop;
      } else if (markerBottom > (mapSize.y - safeBottom)) {
          dy = markerBottom - (mapSize.y - safeBottom);
      }

      if (markerLeft < safeLeft) {
          dx = markerLeft - safeLeft;
      } else if (markerRight > (mapSize.x - safeRight)) {
          dx = markerRight - (mapSize.x - safeRight);
      }

      if (Math.abs(dx) > 5 || Math.abs(dy) > 5) {
          map.panBy([dx, dy], { animate: true, duration: 0.3 });
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
              mapRef.current.flyTo([poi.coordinates.lat, poi.coordinates.lng], 14, { duration: 1.5 });
          }
      }

      if (poi.altitude === 0 && !isOffline) {
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

  const downloadMapArea = async () => { if (!mapRef.current || isOffline) return; setIsDownloading(true); setDownloadProgress('fetching'); setDownloadCount(0); const b = mapRef.current.getBounds(); try { const newPois = await fetchOsmPois({ south: b.getSouth(), west: b.getWest(), north: b.getNorth(), east: b.getEast() }, 'All'); setDownloadCount(newPois.length); setDownloadProgress('saving'); await dbService.savePois(newPois); setAllPois(prev => { const ids = new Set(prev.map(p => p.id)); return [...prev, ...newPois.filter(p => !ids.has(p.id))]; }); setDownloadProgress('done'); setTimeout(() => { setIsDownloading(false); setDownloadProgress('idle'); setIsLayersMenuOpen(false); showToast(`Area scaricata: ${newPois.length} punti salvati`); }, 2000); } catch (e) { console.error("Download failed", e); setIsDownloading(false); setDownloadProgress('idle'); showToast("Errore durante il download dell'area."); } };
  
  // --- [LOCKED FEATURE] GLOBAL SEARCH ---
  // DO NOT MODIFY SEARCH LOGIC WITHOUT PERMISSION
  const handleGlobalSearch = async (e: React.FormEvent) => { 
      e.preventDefault(); 
      const query = searchQuery.trim().toLowerCase(); 
      if (!query) return; 
      
      if (isOffline) { 
          const localResults = allPois.filter(p => p.name.toLowerCase().includes(query)); 
          if (localResults.length > 0) { 
              const target = localResults[0];
              setSelectedPoi(target); 
              setIsDetailPanelOpen(false); 
              
              if (viewMode === 'list') {
                  setHighlightedPoiId(target.id);
                  setTimeout(() => {
                      const element = document.getElementById(`poi-card-${target.id}`);
                      if (element) element.scrollIntoView({ behavior: 'smooth', block: 'center' });
                  }, 100);
              } else if (mapRef.current) {
                  mapRef.current.flyTo([target.coordinates.lat, target.coordinates.lng], 15); 
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
          setSelectedPoi(target); 
          setIsDetailPanelOpen(false); 
          
          if (viewMode === 'list') {
              setHighlightedPoiId(target.id);
              setTimeout(() => {
                  const element = document.getElementById(`poi-card-${target.id}`);
                  if (element) element.scrollIntoView({ behavior: 'smooth', block: 'center' });
              }, 100);
          } else if (mapRef.current) {
              mapRef.current.flyTo([target.coordinates.lat, target.coordinates.lng], 14, { duration: 1.5 }); 
          }
      } else { 
          showToast("Nessun risultato trovato."); 
      } 
  };
  
  // --- [LOCKED FEATURE] GPX PARSER ---
  // DO NOT MODIFY WITHOUT PERMISSION
  const handleGpxUpload = (event: React.ChangeEvent<HTMLInputElement>) => { const file = event.target.files?.[0]; if (!file) return; if (tracks.length >= 2) { showToast("Massimo 2 tracce contemporaneamente."); event.target.value = ''; return; } const reader = new FileReader(); reader.onload = (e) => { try { const text = e.target?.result as string; const parser = new DOMParser(); const xmlDoc = parser.parseFromString(text, "text/xml"); const trkpts = xmlDoc.getElementsByTagName("trkpt"); if (trkpts.length === 0) { showToast("Nessuna traccia valida trovata."); return; } const points: TrackPoint[] = []; const latlngs: [number, number][] = []; let totalDist = 0, gain = 0, loss = 0, minEle = Infinity, maxEle = -Infinity; let maxGrade = 0; let gradeAccumulator = 0; let totalTime = 0; let hasTime = false; let sumHr = 0, maxHr = 0, hrCount = 0; let sumTemp = 0, tempCount = 0; let ascentTimeSeconds = 0; for (let i = 0; i < trkpts.length; i++) { const lat = parseFloat(trkpts[i].getAttribute("lat") || "0"); const lng = parseFloat(trkpts[i].getAttribute("lon") || "0"); const eleNode = trkpts[i].getElementsByTagName("ele")[0]; const ele = eleNode ? parseFloat(eleNode.textContent || "0") : 0; const timeNode = trkpts[i].getElementsByTagName("time")[0]; let timeTs = undefined; if (timeNode) { hasTime = true; timeTs = new Date(timeNode.textContent || "").getTime(); } let hr = undefined, temp = undefined, cadence = undefined; const extensions = trkpts[i].getElementsByTagName("extensions")[0]; if (extensions) { const hrNode = extensions.querySelector("hr, heartrate, *[nodeName='gpxtpx:hr'], *[nodeName='gpxtpx:heartrate']"); if (hrNode && hrNode.textContent) { hr = parseFloat(hrNode.textContent); sumHr += hr; if (hr > maxHr) maxHr = hr; hrCount++; } const tempNode = extensions.querySelector("atemp, temp, temperature, *[nodeName='gpxtpx:atemp'], *[nodeName='gpxtpx:temp']"); if (tempNode && tempNode.textContent) { temp = parseFloat(tempNode.textContent); sumTemp += temp; tempCount++; } const cadNode = extensions.querySelector("cad, cadence, *[nodeName='gpxtpx:cad'], *[nodeName='gpxtpx:cadence']"); if (cadNode && cadNode.textContent) { cadence = parseFloat(cadNode.textContent); } } latlngs.push([lat, lng]); let distStep = 0; if (i > 0) { const prev = points[i-1]; distStep = getDistance(prev.lat, prev.lng, lat, lng); totalDist += distStep; const eleDiff = ele - prev.ele; if (eleDiff > 0) { gain += eleDiff; if (hasTime && timeTs && prev.time) { const dt = (timeTs - prev.time) / 1000; if (dt > 0 && dt < 120) { ascentTimeSeconds += dt; } } } else { loss += Math.abs(eleDiff); } if (distStep > 0.01) { const grade = Math.abs((eleDiff / (distStep * 1000)) * 100); if (grade < 100) { if (grade > maxGrade) maxGrade = grade; gradeAccumulator += grade; } } if (hasTime && timeTs && prev.time) { totalTime += (timeTs - prev.time) / 1000; } } if (ele < minEle) minEle = ele; if (ele > maxEle) maxEle = ele; points.push({ lat, lng, ele, dist: totalDist, time: timeTs, hr, temp, cadence }); } const step = Math.ceil(points.length / 400); const simplifiedPoints = points.filter((_, i) => i % step === 0); let estimatedTime = 0; let isEstimated = false; if (!hasTime || totalTime === 0) { isEstimated = true; estimatedTime = (totalDist / 4) * 3600 + (gain / 600) * 3600; totalTime = estimatedTime; ascentTimeSeconds = (gain / 600) * 3600; } const avgSpeed = totalTime > 0 ? (totalDist / (totalTime / 3600)) : 0; const avgGrade = points.length > 1 ? gradeAccumulator / points.length : 0; let vam = 0; if (ascentTimeSeconds > 600 && gain > 50) { vam = (gain / (ascentTimeSeconds / 3600)); } const newTrack: LoadedTrack = { id: crypto.randomUUID(), name: file.name.replace(/\.gpx$/i, ''), latlngs: latlngs, points: simplifiedPoints, stats: { totalDistance: totalDist, elevationGain: gain, elevationLoss: loss, minElevation: minEle === Infinity ? 0 : minEle, maxElevation: maxEle === -Infinity ? 0 : maxEle, totalTimeSeconds: totalTime, avgSpeedKmh: avgSpeed, maxGrade: maxGrade, avgGrade: avgGrade, isEstimatedTime: isEstimated, vam: vam > 0 ? Math.round(vam) : undefined, avgHr: hrCount > 0 ? Math.round(sumHr / hrCount) : undefined, maxHr: maxHr > 0 ? Math.round(maxHr) : undefined, avgTemp: tempCount > 0 ? Math.round(sumTemp / tempCount) : undefined }, color: TRACK_COLORS[tracks.length] }; setTracks(prev => [...prev, newTrack]); setFocusedTrackId(newTrack.id); setFilterByTrack(true); setIsTrackPanelOpen(true); setIsTrackPanelExpanded(false); setIsTrailsMenuOpen(false); setIsSidebarOpen(false); setIsDetailPanelOpen(false); centerOnTrack(newTrack, true); } catch (err) { console.error("GPX Parse Error", err); showToast("Errore nel caricamento del file GPX."); } }; reader.readAsText(file); event.target.value = ''; };
  const removeTrack = (id: string) => { setTracks(prev => { const newTracks = prev.filter(t => t.id !== id); if (newTracks.length === 0) setFilterByTrack(false); return newTracks.map((t, idx) => ({...t, color: TRACK_COLORS[idx]})); }); if (focusedTrackId === id) setFocusedTrackId(null); setHoveredTrackIndex(null); };
  const centerOnTrack = (track: LoadedTrack, withOffset = false) => { if (!mapRef.current) return; const poly = L.polyline(track.latlngs); const options: L.FitBoundsOptions = { padding: [50, 50] }; if (withOffset) { options.paddingBottomRight = [0, window.innerHeight * 0.4]; } mapRef.current.fitBounds(poly.getBounds(), options); };
  const filteredPois = useMemo(() => { return allPois.filter(p => { if (showFavoritesOnly && !favorites.has(p.id)) return false; if (filterByTrack && tracks.length > 0) { const isNearAny = tracks.some(t => isPointNearPolyline(p.coordinates, t.latlngs, trackBuffer)); if (!isNearAny) return false; } const t = selectedType === 'All' || p.type === selectedType; const a = p.altitude >= minAltitude && p.altitude <= maxAltitude; const e = selectedExposures.length === 0 || selectedExposures.includes(p.exposure); const w = !filterWater || p.hasWater; const r = !filterRoof || p.hasRoof; const cap = minCapacity === 0 || (p.capacity !== undefined && p.capacity >= minCapacity); const fp = !filterFireplace || p.hasFireplace; const fee = !filterFee || (!p.fee); const op = !filterOpen || (p.access === 'yes' || p.access === 'public' || p.access === 'permissive' || !p.access); return t && a && e && w && r && cap && fp && fee && op; }); }, [allPois, selectedType, minAltitude, maxAltitude, selectedExposures, filterWater, filterRoof, showFavoritesOnly, favorites, minCapacity, filterFireplace, filterFee, filterOpen, filterByTrack, tracks, trackBuffer]);
  const executeFetch = async () => { if (!mapRef.current || isOfflineRef.current) return; setIsSearchingArea(true); const b = mapRef.current.getBounds(); try { const newPois = await fetchOsmPois({ south: b.getSouth(), west: b.getWest(), north: b.getNorth(), east: b.getEast() }, selectedTypeRef.current); setAllPois(prev => { const ids = new Set(prev.map(p => p.id)); const merged = [...prev, ...newPois.filter(p => !ids.has(p.id))]; saveToDb(merged); return merged; }); } finally { setIsSearchingArea(false); } };
  const updateCenterWeather = async () => { if (!mapRef.current || isOfflineRef.current) return; if (weatherAbortController.current) { weatherAbortController.current.abort(); } const controller = new AbortController(); weatherAbortController.current = controller; const center = mapRef.current.getCenter(); try { const res = await fetch( `https://api.open-meteo.com/v1/forecast?latitude=${center.lat.toFixed(4)}&longitude=${center.lng.toFixed(4)}&current=temperature_2m,relative_humidity_2m,weather_code`, { signal: controller.signal } ); if (!res.ok) { return; } const data = await res.json(); if (data.current) { setCenterWeather({ temp: data.current.temperature_2m, code: data.current.weather_code, humidity: data.current.relative_humidity_2m }); } } catch (e: any) { if (e.name === 'AbortError') return; } finally { if (weatherAbortController.current === controller) { weatherAbortController.current = null; } } };
  const handleOpenWeatherPanel = async () => { if (isOfflineRef.current) return; setIsWeatherPanelOpen(true); const center = mapRef.current ? mapRef.current.getCenter() : { lat: 46.2, lng: 11.4 }; if (!areaWeatherInfo) { setIsLoadingAreaWeather(true); try { const data = await analyzeLocationPhysics(center.lat, center.lng); setAreaWeatherInfo(data); } finally { setIsLoadingAreaWeather(false); } } };
  useEffect(() => { if (!isSidebarOpen && !isOfflineRef.current && viewMode === 'map') executeFetch(); }, [isSidebarOpen, viewMode]);
  
  useEffect(() => { 
      if (viewMode === 'map' && mapContainerRef.current) { 
          if (mapRef.current) return; 
          const { center, zoom } = mapViewState.current; 
          const map = L.map(mapContainerRef.current, { zoomControl: false, attributionControl: false }).setView([center.lat, center.lng], zoom); 
          mapRef.current = map; 
          L.control.scale({ position: 'bottomleft', imperial: false, metric: true }).addTo(map); 
          map.on('click', () => { setIsDetailPanelOpen(false); setIsTrackPanelOpen(false); setIsWeatherPanelOpen(false); setSelectedPoi(null); }); 
          map.on('moveend', () => { const c = map.getCenter(); mapViewState.current = { center: { lat: c.lat, lng: c.lng }, zoom: map.getZoom() }; if (!isOfflineRef.current) { executeFetch(); if (debounceRef.current) clearTimeout(debounceRef.current); debounceRef.current = setTimeout(updateCenterWeather, 1000); } }); 
          setIsMapReady(true); 
          
          if (pendingFocusRef.current) {
              const target = pendingFocusRef.current;
              map.setView([target.coordinates.lat, target.coordinates.lng], 14, { animate: true, duration: 1.5 });
              pendingFocusRef.current = null;
          }

          if (!isOfflineRef.current) { executeFetch(); updateCenterWeather(); } 
      } 
      return () => { 
          if (mapRef.current) { 
              const c = mapRef.current.getCenter(); 
              mapViewState.current = { center: { lat: c.lat, lng: c.lng }, zoom: mapRef.current.getZoom() }; 
              setIsMapReady(false); 
              mapRef.current.remove(); 
              mapRef.current = null; 
              markersRef.current.clear(); 
              gpxLayerGroupRef.current = null; 
              rainLayerRef.current = null; 
          } 
      }; 
  }, [viewMode]);
  
  useEffect(() => { if (!mapRef.current || !isMapReady) return; if (userLocationMarkerRef.current) { mapRef.current.removeLayer(userLocationMarkerRef.current); userLocationMarkerRef.current = null; } if (userLocation) { const userIcon = L.divIcon({ className: 'user-location-icon', html: `<div class="relative flex items-center justify-center w-6 h-6"><div style="transform: rotate(${userHeading}deg); transform-origin: center;" class="absolute w-12 h-12 flex items-start justify-center -top-3 transition-transform duration-200 ease-linear pointer-events-none"><div class="w-0 h-0 border-l-[6px] border-l-transparent border-r-[6px] border-r-transparent border-b-[8px] border-b-blue-500/80 filter drop-shadow-sm"></div></div><div class="relative w-4 h-4 bg-blue-500 border-2 border-white rounded-full shadow-md z-10"></div></div>`, iconSize: [24, 24], iconAnchor: [12, 12] }); const marker = L.marker([userLocation.lat, userLocation.lng], { icon: userIcon, zIndexOffset: 1000, interactive: false }).addTo(mapRef.current); userLocationMarkerRef.current = marker; } }, [userLocation, userHeading, viewMode, isMapReady]);
  useEffect(() => { if (weatherOverlayActive && radarFrames.length === 0) { fetch('https://api.rainviewer.com/public/weather-maps.json').then(res => res.json()).then(data => { if (data.radar && data.radar.past) { const frames: RadarFrame[] = []; if(data.radar.past) data.radar.past.forEach((f: any) => frames.push({ time: f.time, path: f.path, isForecast: false })); if(data.radar.nowcast) data.radar.nowcast.forEach((f: any) => frames.push({ time: f.time, path: f.path, isForecast: true })); frames.sort((a, b) => a.time - b.time); setRadarFrames(frames); if (mapRef.current) { radarLayersRef.current.forEach(layer => mapRef.current?.removeLayer(layer)); radarLayersRef.current = []; const newLayers = frames.map(frame => { const layer = L.tileLayer(`https://tile.rainviewer.com${frame.path}/256/{z}/{x}/{y}/2/1_1.png`, { opacity: 0, zIndex: 2000, className: 'rain-layer', pane: 'overlayPane' }); layer.addTo(mapRef.current!); return layer; }); radarLayersRef.current = newLayers; } let lastPastIndex = -1; for (let i = frames.length - 1; i >= 0; i--) { if (!frames[i].isForecast) { lastPastIndex = i; break; } } setCurrentFrameIndex(lastPastIndex >= 0 ? lastPastIndex : 0); setIsRadarPlaying(true); } }).catch(err => console.error("RainViewer Fetch Error", err)); } else if (!weatherOverlayActive) { if (mapRef.current) radarLayersRef.current.forEach(layer => mapRef.current?.removeLayer(layer)); radarLayersRef.current = []; setRadarFrames([]); setCurrentFrameIndex(-1); setIsRadarPlaying(false); } }, [weatherOverlayActive]);
  useEffect(() => { let interval: ReturnType<typeof setInterval>; if (isRadarPlaying && radarFrames.length > 0) { interval = setInterval(() => { setCurrentFrameIndex(prev => { const next = prev + 1; return next >= radarFrames.length ? 0 : next; }); }, 500); } return () => clearInterval(interval); }, [isRadarPlaying, radarFrames]);
  useEffect(() => { if (!mapRef.current || !isMapReady) return; radarLayersRef.current.forEach((layer, index) => { if (index === currentFrameIndex) layer.setOpacity(0.8); else layer.setOpacity(0); }); }, [currentFrameIndex, isMapReady]); 
  useEffect(() => { if (!mapRef.current || !isMapReady) return; mapRef.current.eachLayer((layer) => { if (layer instanceof L.TileLayer && !layer.options.className?.includes('rain')) { if ((mapStyle === 'standard' && layer.options.attribution === 'Esri') || (mapStyle === 'satellite' && layer.options.className?.includes('dark-tiles'))) { mapRef.current?.removeLayer(layer); } } }); let hasBase = false; mapRef.current.eachLayer(l => { if(l instanceof L.TileLayer && !l.options.className?.includes('rain')) hasBase = true; }); if(!hasBase) { if (mapStyle === 'satellite') { L.tileLayer('https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}', { maxZoom: 19, attribution: 'Esri', zIndex: 1 }).addTo(mapRef.current); L.tileLayer('https://server.arcgisonline.com/ArcGIS/rest/services/Reference/World_Boundaries_and_Places/MapServer/tile/{z}/{y}/{x}', { maxZoom: 19, zIndex: 3, attribution: 'Esri' }).addTo(mapRef.current); } else { L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', { className: 'dark-tiles', maxZoom: 19, zIndex: 1 }).addTo(mapRef.current); } } }, [mapStyle, isMapReady]);
  
  useEffect(() => { 
      if (viewMode === 'map' && mapRef.current && isMapReady) { 
          const map = mapRef.current; 
          const markers = markersRef.current; 
          const filteredIds = new Set(filteredPois.map(p => p.id)); 
          markers.forEach((marker, id) => { if (!filteredIds.has(id)) { map.removeLayer(marker); markers.delete(id); } }); 
          filteredPois.forEach(poi => { 
              const isSelected = selectedPoi?.id === poi.id; 
              const isFav = favorites.has(poi.id); 
              const analysis = isSelected ? geoAnalysis : null;
              if (markers.has(poi.id)) { 
                  const m = markers.get(poi.id)!; 
                  const prevState = (m as any)._customState || {}; 
                  const prevLevel = prevState.analysis?.signalEstimate?.level;
                  const currLevel = analysis?.signalEstimate?.level;
                  if (prevState.isSelected !== isSelected || prevState.isFav !== isFav || (isSelected && prevLevel !== currLevel)) { 
                      m.setIcon(createCustomIcon(poi, isSelected, isFav, analysis)); 
                      m.setZIndexOffset(isSelected ? 100000 : (isFav ? 500 : 0)); 
                      (m as any)._customState = { isSelected, isFav, analysis }; 
                  } 
              } else { 
                  const m = L.marker([poi.coordinates.lat, poi.coordinates.lng], { icon: createCustomIcon(poi, isSelected, isFav, analysis) }).addTo(map); 
                  m.setZIndexOffset(isSelected ? 100000 : (isFav ? 500 : 0)); 
                  (m as any)._customState = { isSelected, isFav, analysis }; 
                  m.on('click', (e) => { 
                      L.DomEvent.stopPropagation(e); 
                      setSelectedPoi(poi); 
                      setIsDetailPanelOpen(false); 
                      ensureMarkerVisible(poi, map); 
                  }); 
                  markers.set(poi.id, m); 
              } 
          }); 
      } 
  }, [filteredPois, selectedPoi, viewMode, favorites, isMapReady, geoAnalysis]); 

  const toggleExposure = (exp: Exposure) => { setSelectedExposures(prev => prev.includes(exp) ? prev.filter(e => e !== exp) : [...prev, exp]); };
  const handleZoomIn = () => { mapRef.current?.zoomIn(); };
  const handleZoomOut = () => { mapRef.current?.zoomOut(); };
  const handleLocateUser = () => { if (!navigator.geolocation) { showToast("Geolocalizzazione non supportata."); return; } shouldCenterRef.current = true; setIsLocating(true); if (userLocation && mapRef.current) { mapRef.current.flyTo([userLocation.lat, userLocation.lng], 16, { animate: true, duration: 1 }); setIsLocating(false); shouldCenterRef.current = false; } if (locationWatchId.current === null) { locationWatchId.current = navigator.geolocation.watchPosition( (position) => { const { latitude, longitude } = position.coords; const newLoc = { lat: latitude, lng: longitude }; setUserLocation(newLoc); if (shouldCenterRef.current && mapRef.current) { mapRef.current.flyTo([latitude, longitude], 16, { animate: true, duration: 1 }); setIsLocating(false); shouldCenterRef.current = false; } else { if (shouldCenterRef.current === false) setIsLocating(false); } }, (error) => { console.error(`Geolocation error: ${error.message} (Code: ${error.code})`); setUserLocation(null); if (shouldCenterRef.current) { let msg = "Impossibile recuperare la posizione."; if (error.code === 1) msg = "Permesso di localizzazione negato."; else if (error.code === 2) msg = "Posizione non disponibile. Verifica il GPS."; else if (error.code === 3) msg = "Timeout: segnale GPS debole."; showToast(msg); setIsLocating(false); shouldCenterRef.current = false; } }, { enableHighAccuracy: true, maximumAge: 10000, timeout: 10000 } ); } };
  const handleShowOnMap = () => { if (!selectedPoi) return; mapViewState.current = { center: { lat: selectedPoi.coordinates.lat, lng: selectedPoi.coordinates.lng }, zoom: 14 }; if (viewMode === 'list') setViewMode('map'); else mapRef.current?.flyTo([selectedPoi.coordinates.lat, selectedPoi.coordinates.lng], 14); setIsDetailPanelOpen(false); };
  const handleShowInList = () => { setViewMode('list'); setIsDetailPanelOpen(false); setTimeout(() => { const element = document.getElementById(`poi-card-${selectedPoi?.id}`); if (element) element.scrollIntoView({ behavior: 'smooth', block: 'center' }); }, 100); };
  const openGoogleMapsReview = () => { if (!selectedPoi) return; const query = `${selectedPoi.name} ${selectedPoi.coordinates.lat},${selectedPoi.coordinates.lng}`; const url = `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(query)}`; window.open(url, '_blank'); };
  const generateChartPath = (points: TrackPoint[], width: number, height: number, minEle: number, maxEle: number, totalDist: number) => { if (points.length < 2) return ''; const eleRange = maxEle - minEle || 1; const pts = points.map(p => { const x = (p.dist / totalDist) * width; const y = height - ((p.ele - minEle) / eleRange) * height; return `${x.toFixed(1)},${y.toFixed(1)}`; }); return pts.join(' '); };
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

  const elePadding = currentStatsTrack ? (currentStatsTrack.stats.maxElevation - currentStatsTrack.stats.minElevation) * 0.1 : 0; 
  const chartMaxEle = currentStatsTrack ? currentStatsTrack.stats.maxElevation + elePadding : 0;

  const handleChartMouseMove = (e: React.MouseEvent<HTMLDivElement> | React.TouchEvent<HTMLDivElement>) => {
      if (!currentStatsTrack || !currentStatsTrack.points) return;
      const rect = e.currentTarget.getBoundingClientRect();
      const clientX = 'touches' in e ? e.touches[0].clientX : (e as React.MouseEvent).clientX;
      const x = clientX - rect.left;
      const ratio = Math.max(0, Math.min(1, x / rect.width));
      const index = Math.floor(ratio * (currentStatsTrack.points.length - 1));
      setHoveredTrackIndex(index);
  };

  const handleChartMouseLeave = () => {
      setHoveredTrackIndex(null);
  };

  return (
    <div className="flex flex-col h-full w-full bg-zinc-950 text-zinc-200 overflow-hidden font-sans relative">
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
      `}</style>
      
      <aside className={`fixed inset-0 z-[6000] transition-transform duration-300 pointer-events-none ${isSidebarOpen ? 'translate-x-0' : '-translate-x-full'}`}>
        <div ref={sidebarContentRef} className="h-full w-full max-w-sm mr-auto bg-zinc-900 border-r border-zinc-800 pointer-events-auto flex flex-col shadow-2xl">
          <div className="p-4 border-b border-zinc-800 flex justify-between items-center bg-zinc-900/50 backdrop-blur">
            <h2 className="font-bold text-lg flex items-center gap-2"><Filter size={18} className="text-orange-500"/> Filtri</h2>
            <button onClick={() => setIsSidebarOpen(false)} className="p-2 hover:bg-zinc-800 rounded-lg text-zinc-400"><X size={20}/></button>
          </div>
          <div className="flex-1 overflow-y-auto p-6 space-y-6">
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
              <h3 className="text-xs font-bold text-zinc-500 uppercase mb-3 tracking-wider">Tipologia</h3>
              <div className="grid grid-cols-2 gap-2">
                {['All', POIType.BIVOUAC, POIType.REFUGE, POIType.FOUNTAIN].map(t => (
                  <button 
                    key={t} 
                    onClick={() => setSelectedType(t as any)} 
                    className={`py-2 px-3 text-xs font-medium rounded-lg border transition-all ${selectedType === t ? 'bg-orange-600 border-orange-500 text-white' : 'bg-zinc-800 border-zinc-700 text-zinc-400 hover:border-zinc-600'}`}
                  >
                    {t === 'All' ? 'Tutti' : t}
                  </button>
                ))}
              </div>
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
                  className={`w-full flex items-center justify-between p-2.5 rounded-xl border text-xs font-medium transition-all ${filterWater ? 'bg-blue-900/30 border-blue-500 text-white' : 'bg-zinc-800/60 border-zinc-700/60 text-zinc-400 hover:text-zinc-200'}`}
                >
                  <span className="flex items-center gap-2"><Droplets size={14} className={filterWater ? "text-blue-400" : "text-zinc-500"}/> Acqua potabile nelle vicinanze</span>
                  <div className={`w-4 h-4 rounded border flex items-center justify-center ${filterWater ? 'bg-blue-500 border-blue-400' : 'border-zinc-600'}`}>{filterWater && <CheckCircle2 size={12} className="text-white"/>}</div>
                </button>

                <button 
                  onClick={() => setFilterRoof(!filterRoof)} 
                  className={`w-full flex items-center justify-between p-2.5 rounded-xl border text-xs font-medium transition-all ${filterRoof ? 'bg-orange-900/30 border-orange-500 text-white' : 'bg-zinc-800/60 border-zinc-700/60 text-zinc-400 hover:text-zinc-200'}`}
                >
                  <span className="flex items-center gap-2"><Home size={14} className={filterRoof ? "text-orange-400" : "text-zinc-500"}/> Struttura con tetto / Chiusa</span>
                  <div className={`w-4 h-4 rounded border flex items-center justify-center ${filterRoof ? 'bg-orange-500 border-orange-400' : 'border-zinc-600'}`}>{filterRoof && <CheckCircle2 size={12} className="text-white"/>}</div>
                </button>

                <button 
                  onClick={() => setFilterFireplace(!filterFireplace)} 
                  className={`w-full flex items-center justify-between p-2.5 rounded-xl border text-xs font-medium transition-all ${filterFireplace ? 'bg-yellow-900/30 border-yellow-500 text-white' : 'bg-zinc-800/60 border-zinc-700/60 text-zinc-400 hover:text-zinc-200'}`}
                >
                  <span className="flex items-center gap-2"><Flame size={14} className={filterFireplace ? "text-yellow-400" : "text-zinc-500"}/> Stufa / Camino presente</span>
                  <div className={`w-4 h-4 rounded border flex items-center justify-center ${filterFireplace ? 'bg-yellow-500 border-yellow-400' : 'border-zinc-600'}`}>{filterFireplace && <CheckCircle2 size={12} className="text-white"/>}</div>
                </button>

                <button 
                  onClick={() => setFilterOpen(!filterOpen)} 
                  className={`w-full flex items-center justify-between p-2.5 rounded-xl border text-xs font-medium transition-all ${filterOpen ? 'bg-emerald-900/30 border-emerald-500 text-white' : 'bg-zinc-800/60 border-zinc-700/60 text-zinc-400 hover:text-zinc-200'}`}
                >
                  <span className="flex items-center gap-2"><Unlock size={14} className={filterOpen ? "text-emerald-400" : "text-zinc-500"}/> Accesso libero / Senza chiavi</span>
                  <div className={`w-4 h-4 rounded border flex items-center justify-center ${filterOpen ? 'bg-emerald-500 border-emerald-400' : 'border-zinc-600'}`}>{filterOpen && <CheckCircle2 size={12} className="text-white"/>}</div>
                </button>

                <button 
                  onClick={() => setFilterFee(!filterFee)} 
                  className={`w-full flex items-center justify-between p-2.5 rounded-xl border text-xs font-medium transition-all ${filterFee ? 'bg-emerald-900/30 border-emerald-500 text-white' : 'bg-zinc-800/60 border-zinc-700/60 text-zinc-400 hover:text-zinc-200'}`}
                >
                  <span className="flex items-center gap-2"><Coins size={14} className={filterFee ? "text-emerald-400" : "text-zinc-500"}/> Gratuito (senza tariffa)</span>
                  <div className={`w-4 h-4 rounded border flex items-center justify-center ${filterFee ? 'bg-emerald-500 border-emerald-400' : 'border-zinc-600'}`}>{filterFee && <CheckCircle2 size={12} className="text-white"/>}</div>
                </button>

                <button 
                  onClick={() => setShowFavoritesOnly(!showFavoritesOnly)} 
                  className={`w-full flex items-center justify-between p-2.5 rounded-xl border text-xs font-medium transition-all ${showFavoritesOnly ? 'bg-red-900/30 border-red-500 text-white' : 'bg-zinc-800/60 border-zinc-700/60 text-zinc-400 hover:text-zinc-200'}`}
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
                    className={`py-1.5 text-xs font-bold rounded-lg border transition-all ${minCapacity === cap ? 'bg-orange-600 border-orange-500 text-white' : 'bg-zinc-800 border-zinc-700 text-zinc-400 hover:border-zinc-600'}`}
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
                    className={`py-2 text-xs font-bold rounded-lg border transition-all ${selectedExposures.includes(exp) ? 'bg-orange-600 border-orange-500 text-white' : 'bg-zinc-800 border-zinc-700 text-zinc-400 hover:border-zinc-600'}`}
                  >
                    {exp}
                  </button>
                ))}
              </div>
            </section>

            <section className="pt-2 border-t border-zinc-800 space-y-2">
              <button
                onClick={() => {
                  setSelectedType('All');
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
                className="w-full py-2.5 bg-zinc-800 hover:bg-zinc-700 text-zinc-300 rounded-xl text-xs font-bold flex items-center justify-center gap-2 transition-colors border border-zinc-700"
              >
                <RefreshCw size={14}/> Reimposta Tutti i Filtri
              </button>
              
              <button 
                onClick={async () => { 
                  if(confirm("Sei sicuro di voler cancellare tutti i dati salvati?")) { 
                    await dbService.clearAll(); 
                    setAllPois([]); 
                    showToast("Database locale svuotato"); 
                  } 
                }} 
                className="w-full py-2 bg-red-900/20 hover:bg-red-900/40 border border-red-800/60 text-red-400 rounded-xl text-xs font-bold transition-colors"
              >
                Svuota Database Locale
              </button>
            </section>
          </div>
        </div>
      </aside>

      <main className="flex-1 relative h-full w-full">
        {/* Header Controls */}
        <header className="absolute top-4 left-4 right-4 z-[2000] flex flex-col gap-3 pointer-events-none">
           <div className="flex items-center gap-2 w-full max-w-lg mx-auto pointer-events-auto">
             <button onClick={() => setViewMode(v => v === 'list' ? 'map' : 'list')} className="w-11 h-11 bg-zinc-900 border border-zinc-800 rounded-xl flex items-center justify-center shadow-xl text-zinc-300 hover:text-white transition-all shrink-0"> {viewMode === 'list' ? <MapIcon size={20}/> : <List size={20}/>} </button>
             <div ref={searchContainerRef} className="flex-1 relative shadow-xl">
               <form onSubmit={handleGlobalSearch} className="w-full relative"> <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-zinc-400"/> <input type="text" value={searchQuery} onChange={e => setSearchQuery(e.target.value)} onFocus={() => searchQuery.length >= 3 && setShowSuggestions(true)} placeholder={isOffline ? "Cerca offline..." : "Cerca Luogo..."} className="w-full h-11 bg-zinc-900 border border-zinc-800 rounded-xl pl-10 pr-10 text-sm focus:ring-2 focus:ring-orange-500 outline-none text-zinc-200 placeholder:text-zinc-500 transition-all"/> {isGlobalSearching ? (<Loader2 className="absolute right-3 top-1/2 -translate-y-1/2 w-4 h-4 text-orange-500 animate-spin"/>) : isOffline ? (<WifiOff className="absolute right-3 top-1/2 -translate-y-1/2 w-4 h-4 text-orange-500"/>) : null} </form>
               {/* AUTOCOMPLETE DROPDOWN */}
               {showSuggestions && searchSuggestions.length > 0 && !isOffline && (
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
             <button onClick={() => setIsSidebarOpen(true)} className={`w-11 h-11 bg-zinc-900 border rounded-xl flex items-center justify-center shadow-xl transition-all shrink-0 ${selectedType !== 'All' || minAltitude > 0 || maxAltitude < 4810 || filterWater || filterRoof || showFavoritesOnly || filterByTrack ? 'border-orange-500 text-orange-500' : 'border-zinc-800 text-zinc-300 hover:text-white'}`}> <Filter size={18}/> </button>
          </div>
          <div className="flex justify-center flex-wrap gap-2 animate-in fade-in slide-in-from-top-2 pointer-events-auto"> 
             {(selectedType !== 'All' || filterWater || filterRoof || showFavoritesOnly || filterByTrack) && ( 
                 <> 
                    {showFavoritesOnly && (<span className="px-3 py-1 bg-red-600 shadow-md rounded-full text-[10px] font-bold text-white border border-red-500 flex items-center gap-1"><Heart size={10} className="fill-white"/> Preferiti</span>)} 
                    {selectedType !== 'All' && (<span className="px-3 py-1 bg-orange-600 shadow-md rounded-full text-[10px] font-bold text-white border border-orange-500 flex items-center gap-1"><Tent size={10}/> {selectedType}</span>)} 
                    {filterWater && <span className="px-3 py-1 bg-blue-600 shadow-md rounded-full text-[10px] font-bold text-white border border-blue-500">Acqua</span>} 
                    {filterByTrack && <span className="px-3 py-1 bg-purple-600 shadow-md rounded-full text-[10px] font-bold text-white border border-purple-500 flex items-center gap-1"><Route size={10}/> Sul Percorso</span>} 
                 </> 
             )} 
          </div>
        </header>

        {viewMode === 'list' ? (
          <div className="h-full w-full bg-zinc-950 overflow-y-auto touch-scroll">
            <div className="pt-32 px-6 pb-40 min-h-full">
              {filteredPois.length > 0 ? (
                <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-6">
                  {filteredPois.map(p => (
                    <div 
                      id={`poi-card-${p.id}`} 
                      key={p.id} 
                      onClick={() => { setSelectedPoi(p); setIsDetailPanelOpen(true); }} 
                      className={`bg-zinc-900 rounded-2xl overflow-hidden hover:border-zinc-600 transition-all cursor-pointer group shadow-lg relative p-5 flex flex-col h-full justify-between border ${highlightedPoiId === p.id ? 'border-orange-500 ring-2 ring-orange-500' : 'border-zinc-800'}`}
                    >
                      <div className="mb-4"> <div className="flex justify-between items-start mb-2"> <h4 className="font-bold text-lg text-zinc-100 leading-tight pr-2">{p.name}</h4> <button onClick={(e) => toggleFavorite(e, p)} className={`w-8 h-8 shrink-0 flex items-center justify-center rounded-full border transition-all ${favorites.has(p.id) ? 'bg-red-900/30 text-red-500 border-red-500/50' : 'bg-zinc-800 text-zinc-400 border-zinc-700 hover:text-zinc-200'}`}> <Heart size={16} className={favorites.has(p.id) ? "fill-red-500" : ""}/> </button> </div> <div className="flex items-center gap-2 mb-3"> <span className="bg-orange-600/20 text-orange-500 px-2 py-0.5 rounded text-[10px] font-bold uppercase tracking-wide border border-orange-600/30">{p.type}</span> <span className="text-zinc-500 text-xs font-mono">{p.altitude}m</span> </div> <p className="text-sm text-zinc-400 line-clamp-2">{p.description}</p> </div>
                      <div className="grid grid-cols-2 gap-2 mb-4"> {p.capacity ? ( <div className="flex items-center gap-2 text-xs text-zinc-300 bg-zinc-800/50 p-2 rounded-lg"> <BedDouble size={14} className="text-orange-500 shrink-0"/> <span>{p.capacity} Posti</span> </div> ) : ( <div className="flex items-center gap-2 text-xs text-zinc-500 bg-zinc-800/20 p-2 rounded-lg"> <Tent size={14} className="text-zinc-600 shrink-0"/> <span>N/D</span> </div> )} {p.hasFireplace || p.hasRoof ? ( <div className="flex items-center gap-2 text-xs text-zinc-300 bg-zinc-800/50 p-2 rounded-lg"> {p.hasFireplace ? <Flame size={14} className="text-yellow-500 shrink-0"/> : <Home size={14} className="text-zinc-400 shrink-0"/>} <span>{p.hasFireplace ? 'Stufa' : 'Chiuso'}</span> </div> ) : ( <div className="flex items-center gap-2 text-xs text-zinc-500 bg-zinc-800/20 p-2 rounded-lg"> <Home size={14} className="text-zinc-600 shrink-0"/> <span>Aperto</span> </div> )} {p.operator ? ( <div className="flex items-center gap-2 text-xs text-zinc-300 bg-zinc-800/50 p-2 rounded-lg"> <Building size={14} className="text-blue-400 shrink-0"/> <span className="truncate">Gestito</span> </div> ) : ( <div className="flex items-center gap-2 text-xs text-zinc-400 bg-zinc-800/30 p-2 rounded-lg"> <Building size={14} className="text-zinc-600 shrink-0"/> <span>Non gestito</span> </div> )} {p.hasWater ? ( <div className="flex items-center gap-2 text-xs text-zinc-300 bg-zinc-800/50 p-2 rounded-lg"> <Droplets size={14} className="text-blue-500 shrink-0"/> <span>Acqua</span> </div> ) : ( <div className="flex items-center gap-2 text-xs text-zinc-500 bg-zinc-800/20 p-2 rounded-lg"> <Droplets size={14} className="text-zinc-600 shrink-0"/> <span>No acqua</span> </div> )} </div>
                      {p.userNote && ( <div className="mt-auto bg-emerald-950/30 border border-emerald-900/50 rounded-lg p-2 flex items-start gap-2"> <Edit3 size={12} className="text-emerald-500 mt-0.5 shrink-0"/> <p className="text-[10px] text-emerald-200/80 italic line-clamp-2">{p.userNote}</p> </div> )}
                    </div>
                  ))}
                </div>
              ) : ( <div className="flex flex-col items-center justify-center py-20 text-zinc-500"> <Heart size={48} className="mb-4 text-zinc-700"/> <p className="text-sm font-medium">Nessun punto di interesse trovato.</p> </div> )}
            </div>
          </div>
        ) : (
          <div className="h-full w-full relative">
             <div ref={mapContainerRef} className="w-full h-full"/>
             {isSearchingArea && (
                <div className="absolute bottom-8 left-1/2 -translate-x-1/2 z-[3500] pointer-events-none animate-in fade-in slide-in-from-bottom-4">
                     <span className="px-3 py-1.5 bg-zinc-900/90 backdrop-blur shadow-xl rounded-full text-[11px] font-bold text-orange-400 border border-orange-500/50 flex items-center gap-2">
                        <Loader2 size={12} className="animate-spin"/> Aggiorno mappa...
                     </span>
                </div>
             )}
             {viewMode === 'map' && centerWeather && !isOffline && (
                 <div onClick={handleOpenWeatherPanel} className="absolute bottom-10 left-4 z-[1000] bg-zinc-900/90 backdrop-blur border border-zinc-700/50 rounded-2xl p-2.5 shadow-2xl flex items-center gap-3 animate-in fade-in slide-in-from-bottom-4 cursor-pointer hover:bg-zinc-800 transition-colors group">
                     <div className="bg-zinc-800 rounded-xl p-1.5 flex items-center justify-center group-hover:bg-zinc-700 transition-colors"> {getWeatherIcon(centerWeather.code)} </div>
                     <div> <div className="text-xs font-bold text-white leading-none mb-0.5">{centerWeather.temp}°C</div> <div className="text-[10px] text-blue-400 font-bold flex items-center gap-1"> <Droplets size={10} className="fill-blue-400"/> {centerWeather.humidity}% </div> </div>
                 </div>
             )}
          </div>
        )}

        {viewMode === 'map' && (
          <div className={`absolute bottom-6 right-4 z-[3000] flex flex-col items-end gap-3 pointer-events-auto transition-all ${weatherOverlayActive ? 'mb-24' : ''}`}>
             <div ref={trailsMenuRef} className="relative">
               {isTrailsMenuOpen && (
                  <div className="absolute bottom-full right-0 mb-4 w-72 bg-zinc-900 border border-zinc-700 rounded-2xl p-4 shadow-2xl animate-in fade-in slide-in-from-right-4">
                    <h4 className="text-[10px] font-bold uppercase text-zinc-500 mb-3 tracking-wider flex items-center gap-2"><Route size={12}/> Gestione Percorsi</h4>
                    {tracks.length === 0 ? (
                        <div className="text-center p-4 border border-dashed border-zinc-700 rounded-xl bg-zinc-800/30"> <p className="text-xs text-zinc-400 mb-3">Nessuna traccia caricata.</p> <button onClick={() => fileInputRef.current?.click()} className="w-full py-2 bg-orange-600 hover:bg-orange-700 text-white rounded-lg text-xs font-bold flex items-center justify-center gap-2 transition-colors"> <FileUp size={14}/> Carica GPX </button> </div>
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
                                      <button onClick={() => { setFocusedTrackId(track.id); setIsTrackPanelOpen(true); setIsTrailsMenuOpen(false); centerOnTrack(track, true); }} className="p-1.5 hover:bg-zinc-700 rounded text-zinc-400 hover:text-white transition-colors shrink-0" title="Statistiche"> <BarChart3 size={16}/> </button>
                                      <button onClick={() => removeTrack(track.id)} className="p-1.5 hover:bg-zinc-700 rounded text-zinc-400 hover:text-red-400 transition-colors shrink-0" title="Rimuovi"> <Trash2 size={16}/> </button> 
                                  </div>
                               </div>
                           ))}
                           
                           <div> <button onClick={() => setFilterByTrack(!filterByTrack)} className={`w-full flex items-center justify-between p-3 rounded-xl border transition-all mb-3 ${filterByTrack ? 'bg-purple-900/30 border-purple-500' : 'bg-zinc-800 border-zinc-700'}`}> <span className="flex items-center gap-2 text-xs font-bold"><Filter size={14} className={filterByTrack ? "text-purple-400" : "text-zinc-500"}/> Filtra vicino al percorso</span> <div className={`w-8 h-4 rounded-full relative transition-colors ${filterByTrack ? 'bg-purple-500' : 'bg-zinc-600'}`}> <div className={`absolute top-0.5 w-3 h-3 bg-white rounded-full transition-all ${filterByTrack ? 'left-4.5' : 'left-0.5'}`}/> </div> </button> {filterByTrack && ( <div className="px-1 animate-in slide-in-from-top-2 fade-in"> <div className="flex justify-between text-[10px] uppercase font-bold text-zinc-500 mb-2"> <span>Raggio di Ricerca</span> <span className="text-purple-400">{trackBuffer < 1 ? `${trackBuffer*1000}m` : `${trackBuffer}km`}</span> </div> <input type="range" min="0.5" max="10" step="0.5" value={trackBuffer} onChange={(e) => setTrackBuffer(parseFloat(e.target.value))} className="w-full h-1 bg-zinc-800 rounded-lg appearance-none cursor-pointer accent-purple-500" /> </div> )} </div>
                           
                           {tracks.length < 2 && (
                               <button onClick={() => fileInputRef.current?.click()} className="w-full py-2 border border-zinc-700 hover:bg-zinc-800 text-zinc-400 rounded-lg text-xs font-bold flex items-center justify-center gap-2 transition-colors"> <Plus size={12}/> Aggiungi GPX </button>
                           )}
                        </div>
                    )}
                  </div>
               )}
               <button onClick={() => setIsTrailsMenuOpen(!isTrailsMenuOpen)} className={`w-12 h-12 bg-zinc-900 border ${isTrailsMenuOpen || tracks.length > 0 ? 'border-orange-500 text-orange-500' : 'border-zinc-700 text-zinc-300'} rounded-2xl flex items-center justify-center shadow-lg hover:bg-zinc-800 transition-all`}> <Footprints size={22}/> </button>
             </div>
             
             <div ref={layersMenuRef} className="relative">
               {isLayersMenuOpen && (
                <div className="absolute bottom-full right-0 mb-4 w-72 bg-zinc-900 border border-zinc-700 rounded-2xl p-4 shadow-2xl animate-in fade-in slide-in-from-right-4">
                  <h4 className="text-[10px] font-bold uppercase text-zinc-500 mb-3 tracking-wider">Tipo Mappa</h4>
                  <div className="flex flex-col gap-3 mb-4">
                    <button onClick={() => setMapStyle('standard')} className={`relative flex items-center gap-3 p-2 rounded-xl transition-all ${mapStyle === 'standard' ? 'bg-zinc-800 ring-2 ring-orange-500' : 'bg-zinc-800/50 hover:bg-zinc-800'}`}> <div className="w-16 h-12 rounded-lg bg-zinc-700 relative overflow-hidden border border-zinc-600 shrink-0"> <div className="absolute top-1/2 left-0 w-full h-1.5 bg-zinc-500 -rotate-12"></div> <div className="absolute top-0 right-1/2 h-full w-1.5 bg-zinc-500 -rotate-12"></div> </div> <span className={`text-xs font-bold uppercase ${mapStyle === 'standard' ? 'text-orange-500' : 'text-zinc-400'}`}>OSM Standard</span> </button>
                    <button onClick={() => setMapStyle('satellite')} className={`relative flex items-center gap-3 p-2 rounded-xl transition-all ${mapStyle === 'satellite' ? 'bg-zinc-800 ring-2 ring-orange-500' : 'bg-zinc-800/50 hover:bg-zinc-800'}`}> <div className="w-16 h-12 rounded-lg bg-emerald-900 relative overflow-hidden border border-zinc-600 shrink-0"> <div className="absolute inset-0 bg-gradient-to-br from-emerald-900 to-amber-950 opacity-80"></div> <div className="absolute top-2 right-2 w-full h-full border-t-2 border-r-2 border-white/10 rounded-full"></div> </div> <span className={`text-xs font-bold uppercase ${mapStyle === 'satellite' ? 'text-orange-500' : 'text-zinc-400'}`}>Satellite</span> </button>
                  </div>
                  <div className="h-px bg-zinc-800 my-4" />
                  <h4 className="text-[10px] font-bold uppercase text-zinc-500 mb-3 tracking-wider">Sovrapposizioni</h4>
                  <button onClick={() => setWeatherOverlayActive(!weatherOverlayActive)} className={`w-full flex items-center justify-between p-3 rounded-xl border transition-all mb-3 ${weatherOverlayActive ? 'bg-blue-900/30 border-blue-500' : 'bg-zinc-800 border-zinc-700'}`}> <span className="flex items-center gap-2 text-xs font-bold"><CloudRain size={14} className={weatherOverlayActive ? "text-blue-400" : "text-zinc-500"}/> Precipitazioni (Radar)</span> <div className={`w-8 h-4 rounded-full relative transition-colors ${weatherOverlayActive ? 'bg-blue-500' : 'bg-zinc-600'}`}> <div className={`absolute top-0.5 w-3 h-3 bg-white rounded-full transition-all ${weatherOverlayActive ? 'left-4.5' : 'left-0.5'}`}/> </div> </button>
                  <div className="h-px bg-zinc-800 my-2" />
                  <button disabled={isOffline || isDownloading} onClick={downloadMapArea} className="w-full py-3 bg-zinc-800 hover:bg-zinc-700 disabled:opacity-50 disabled:cursor-not-allowed rounded-xl text-xs font-bold flex items-center justify-center gap-2 text-zinc-200 transition-all border border-zinc-700"> {isDownloading ? (downloadProgress === 'fetching' ? <><Loader2 size={14} className="animate-spin text-orange-500"/> Scarico dati...</> : downloadProgress === 'saving' ? <><Database size={14} className="animate-pulse text-emerald-500"/> Salvo {downloadCount} Punti...</> : <><CheckCircle2 size={14} className="text-emerald-500"/> Completato!</>) : <><Download size={14}/> Scarica Area Offline</>} </button>
                </div>
              )}
              <button onClick={() => setIsLayersMenuOpen(!isLayersMenuOpen)} className={`w-12 h-12 bg-zinc-900 border ${isLayersMenuOpen ? 'border-orange-500 text-orange-500' : 'border-zinc-700 text-zinc-300'} rounded-2xl flex items-center justify-center shadow-lg hover:bg-zinc-800 transition-all`}> <Layers size={22}/> </button>
            </div>
            
            <button onClick={handleLocateUser} className={`w-12 h-12 bg-zinc-900 border ${isLocating ? 'border-orange-500' : 'border-zinc-700'} rounded-2xl flex items-center justify-center shadow-lg hover:bg-zinc-800 transition-all text-zinc-200`} title="La mia posizione">
                {isLocating ? <Loader2 size={24} className="animate-spin text-orange-500"/> : <Locate size={24} className={userLocation ? "text-blue-500 fill-blue-500/20" : ""} />}
            </button>

            <div className="flex flex-col rounded-2xl overflow-hidden shadow-lg border border-zinc-700 bg-zinc-900">
               <button onClick={handleZoomIn} className="w-12 h-12 flex items-center justify-center hover:bg-zinc-800 active:bg-zinc-700 transition-colors text-zinc-200 border-b border-zinc-800"><Plus size={24} /></button>
               <button onClick={handleZoomOut} className="w-12 h-12 flex items-center justify-center hover:bg-zinc-800 active:bg-zinc-700 transition-colors text-zinc-200"><Minus size={24} /></button>
            </div>
          </div>
        )}
      </main>
      
      {/* Hidden File Input for GPX Upload */}
      <input type="file" ref={fileInputRef} accept=".gpx" className="hidden" onChange={handleGpxUpload} />

      {/* GPX TRACK PANEL */}
      <div className={`fixed bottom-0 left-0 right-0 z-[5500] bg-zinc-900 border-t border-zinc-800 shadow-2xl transition-all duration-300 ease-out flex flex-col ${isTrackPanelOpen && tracks.length > 0 ? (isTrackPanelExpanded ? 'h-[100dvh]' : 'h-[40vh]') : 'h-0 translate-y-full'}`}>
         
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
                        <span className={`text-zinc-500 uppercase font-bold transition-all ${isTrackPanelExpanded ? 'text-[10px] mb-1' : 'text-[9px]'}`}>Max Ele</span>
                        <span className={`font-bold text-white transition-all ${isTrackPanelExpanded ? 'text-lg' : 'text-xs'}`}>
                             {Math.round(currentStatsTrack.stats.maxElevation)}<span className="text-[9px] font-normal text-zinc-500 ml-0.5">m</span>
                        </span>
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
                 
                 {/* INTERACTIVE CHART */}
                 <div className={`w-full bg-zinc-900/50 rounded-xl border border-zinc-800 relative mt-2 overflow-hidden select-none transition-all duration-300 ${isTrackPanelExpanded ? 'h-64' : 'h-32'}`}
                      onMouseMove={handleChartMouseMove}
                      onTouchMove={handleChartMouseMove}
                      onMouseLeave={handleChartMouseLeave}
                 >
                    <svg className="w-full h-full" preserveAspectRatio="none" viewBox={`0 0 1000 200`}>
                        {/* Gradient Definition */}
                        <defs>
                            <linearGradient id="chartGradient" x1="0" x2="0" y1="0" y2="1">
                                <stop offset="0%" stopColor="#ea580c" stopOpacity="0.4"/>
                                <stop offset="100%" stopColor="#ea580c" stopOpacity="0.0"/>
                            </linearGradient>
                        </defs>
                        {/* Area */}
                        <path 
                           d={`M0,200 ${generateChartPath(currentStatsTrack.points, 1000, 200, currentStatsTrack.stats.minElevation - elePadding, chartMaxEle, currentStatsTrack.stats.totalDistance)} L1000,200Z`} 
                           fill="url(#chartGradient)" 
                        />
                        {/* Line */}
                        <path 
                           d={`M0,200 ${generateChartPath(currentStatsTrack.points, 1000, 200, currentStatsTrack.stats.minElevation - elePadding, chartMaxEle, currentStatsTrack.stats.totalDistance)}`} 
                           fill="none" 
                           stroke="#ea580c" 
                           strokeWidth="2"
                        />
                        {/* Hover Indicator */}
                        {hoveredTrackPoint && hoveredTrackIndex !== null && currentStatsTrack.points.length > 0 && (
                            <>
                                <line 
                                    x1={(hoveredTrackIndex / (currentStatsTrack.points.length - 1)) * 1000} 
                                    y1="0" 
                                    x2={(hoveredTrackIndex / (currentStatsTrack.points.length - 1)) * 1000} 
                                    y2="200" 
                                    stroke="white" 
                                    strokeWidth="1" 
                                    strokeDasharray="4 2"
                                />
                                <circle 
                                    cx={(hoveredTrackIndex / (currentStatsTrack.points.length - 1)) * 1000}
                                    cy={200 - ((hoveredTrackPoint.ele - (currentStatsTrack.stats.minElevation - elePadding)) / (chartMaxEle - (currentStatsTrack.stats.minElevation - elePadding))) * 200}
                                    r="6"
                                    fill="#3b82f6"
                                    stroke="white"
                                    strokeWidth="2"
                                />
                            </>
                        )}
                    </svg>
                    
                    {/* Hover Info Tooltip */}
                    {hoveredTrackPoint && (
                        <div className="absolute top-2 left-2 bg-zinc-900/90 border border-zinc-700 p-2 rounded text-[10px] font-mono shadow-xl pointer-events-none">
                             <div className="text-white font-bold">{Math.round(hoveredTrackPoint.ele)}m</div>
                             <div className="text-zinc-400">{hoveredTrackPoint.dist.toFixed(1)}km</div>
                             {hoveredTrackPoint.hr && <div className="text-red-400">♥ {Math.round(hoveredTrackPoint.hr)}</div>}
                             {hoveredTrackPoint.temp && <div className="text-blue-400">{Math.round(hoveredTrackPoint.temp)}°C</div>}
                        </div>
                    )}
                 </div>
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
                            <span className="text-orange-500 font-bold uppercase tracking-wider bg-orange-500/10 px-2 py-1 rounded border border-orange-500/20">{selectedPoi.type}</span>
                            <span className="font-mono bg-zinc-900 border border-zinc-800 px-2 py-1 rounded text-zinc-300">{selectedPoi.altitude}m</span>
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

                        {/* Link Esterni e Navigazione */}
                        <div className="flex flex-wrap gap-2 pt-3">
                            <button onClick={openGoogleMapsReview} className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-zinc-900 hover:bg-zinc-800 border border-zinc-800 text-xs text-zinc-300 hover:text-white transition-colors cursor-pointer">
                                <Navigation size={14} className="text-orange-500"/> Apri in Google Maps
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
                                    </div>
                                )}
                            </div>
                        ) : (
                            <div className="text-zinc-500 text-sm p-4 text-center border border-dashed border-zinc-800 rounded-xl">Dati offline non disponibili.</div>
                        )}
                    </div>

                    {/* Note Personali */}
                    <div className="pb-8">
                        <h3 className="text-sm font-bold text-zinc-400 uppercase tracking-wider mb-4">Le tue note</h3>
                        <textarea 
                            value={userNoteDraft}
                            onChange={(e) => setUserNoteDraft(e.target.value)}
                            className="w-full bg-zinc-900 border border-zinc-800 rounded-2xl p-4 text-base text-zinc-200 focus:border-orange-500 outline-none min-h-[120px] resize-none"
                            placeholder="Scrivi qui appunti, condizioni sentiero, ricordi..."
                        />
                        <button onClick={saveUserNote} className="mt-3 w-full bg-zinc-800 hover:bg-zinc-700 text-zinc-200 text-sm font-bold py-3 px-4 rounded-xl transition-colors border border-zinc-700">
                            Salva Nota
                        </button>
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