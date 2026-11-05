
export enum POIType {
  BIVOUAC = 'Bivacco',
  FOUNTAIN = 'Fontana',
  REFUGE = 'Rifugio',
  PICNIC = 'Area Picnic',
  VIEWPOINT = 'Punto Panoramico'
}

export enum Exposure {
  NORTH = 'Nord',
  SOUTH = 'Sud',
  EAST = 'Est',
  WEST = 'Ovest',
  VARIOUS = 'Vario'
}

export enum SignalStrength {
  NONE = '/',
  LOW = 'H+',
  MEDIUM = '3G',
  HIGH = '4G',
  EXCELLENT = '5G'
}

export interface POI {
  id: string;
  name: string;
  type: POIType;
  altitude: number;
  coordinates: { lat: number; lng: number };
  exposure: Exposure;
  signal: SignalStrength;
  hasWater: boolean;
  hasRoof: boolean;
  hasElectricity: boolean;
  hasFireplace: boolean;
  description: string;
  imageUrl: string;
  
  // Extended OSM Data
  capacity?: number;       // Number of beds/seats
  operator?: string;       // e.g. "CAI Torino"
  website?: string;        // URL
  access?: string;         // e.g. "yes", "private", "permit"
  fee?: boolean;           // true if paid
  material?: string;       // e.g. "stone", "wood"
  
  // New enrichments
  wikipediaLink?: string;  // Link to wikipedia article
  hikingDifficulty?: string; // T1, T2, etc. (sac_scale)
  surfaceType?: string;    // grass, rock, etc.

  // User Data
  userNote?: string;       // Personal user comment/note
  isFree?: boolean;
  isOpen?: boolean;
  source?: string;

  // OsmAnd-style Search Metadata (opzionali, non alterano la logica POI pre-esistente)
  categoryLabel?: string;  // es. "Picco montuoso", "Ruscello", "Riserva naturale", "Valle", "Pensilina o ricovero", "Strada"
  locality?: string;       // es. "Castello Tesino"
  osmSubkind?: 'peak' | 'saddle' | 'valley' | 'stream' | 'water' | 'reserve' | 'shelter' | 'bivouac' | 'refuge' | 'road' | 'fountain' | 'place';
}

export interface HourlyForecast {
  time: string;
  temp: number;
  conditionCode: number;
  precipProb: number;
  windSpeed: number;
}

export interface HourlyForecastData {
  time: string;
  temp: string;
  condition: string;
}

export interface LiveConditions {
  temperature: string;
  feels_like: string; 
  condition: string;
  wind: string;
  humidity: string;   
  pressure: string;   
  uv_index: string;   
  visibility: string; 
  sunrise: string;
  sunset: string;
  hourly_forecast: HourlyForecastData[]; 
  connectivity_info: {
    type: string; 
    strength: number; 
    description: string;
  };
  snow_ice_alert: boolean;
  summary: string;
}

export interface Trail {
  id: string;
  name: string;
  difficulty: 'Easy' | 'Medium' | 'Hard' | 'Expert';
  lengthKm: number;
  gainM: number;
  duration: string;
}
