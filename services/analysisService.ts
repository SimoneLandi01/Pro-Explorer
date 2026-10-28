
import { POI, Exposure, SignalStrength, HourlyForecast } from '../types.ts';

// Config
const ELEVATION_API = 'https://api.open-meteo.com/v1/elevation';
const WEATHER_API = 'https://api.open-meteo.com/v1/forecast';
const AIR_QUALITY_API = 'https://air-quality-api.open-meteo.com/v1/air-quality';

export interface GeoAnalysis {
  exposure: string;
  terrainType: string; // Cresta, Valle, Versante
  signalEstimate: {
    level: SignalStrength;
    reason: string;
  };
  aqi: number; // European AQI (0-100+)
  weather: {
    temp: number;
    apparentTemp: number;
    conditionCode: number;
    windSpeed: number;
    windGusts: number; // Raffiche
    windDirection: number;
    windDirText: string;
    humidity: number;
    pressure: number;
    visibility: number; // metri
    precipProb: number;
    uvIndex: number;
    cloudCover: number; // % nuvole
    snowDepth: number; // metri
    isSnowing: boolean;
    dewPoint: number; // Punto di rugiada
    freezingLevel: number; // Zero termico
    sunrise: string;
    sunset: string;
    description: string;
    hourly: HourlyForecast[]; // New Hourly Data
  } | null;
}

const getWeatherDescription = (code: number): string => {
  if (code === 0) return "Cielo sereno";
  if (code <= 3) return "Nuvolosità variabile";
  if (code <= 48) return "Nebbia o nubi basse";
  if (code <= 67) return "Pioggia";
  if (code <= 77) return "Neve o nevischio";
  if (code >= 95) return "Temporali";
  return "Variabile";
};

const getWindDirection = (degrees: number): string => {
    const directions = ['N', 'NE', 'E', 'SE', 'S', 'SO', 'O', 'NO'];
    const index = Math.round(degrees / 45) % 8;
    return directions[index];
};

// Calculate Exposure and Morphology based on 5 points elevation
// Center, North, South, East, West (offset ~100m)
export const analyzeLocationPhysics = async (lat: number, lng: number): Promise<GeoAnalysis> => {
  const offset = 0.001; // approx 110m
  const coords = [
    { lat: lat, lng: lng },           // 0: Center
    { lat: lat + offset, lng: lng },  // 1: North
    { lat: lat - offset, lng: lng },  // 2: South
    { lat: lat, lng: lng + offset },  // 3: East
    { lat: lat, lng: lng - offset }   // 4: West
  ];

  try {
    // 1. Fetch Elevation, Weather and Air Quality in parallel
    const lats = coords.map(c => c.lat).join(',');
    const lngs = coords.map(c => c.lng).join(',');
    
    // Expanded Weather Query with HOURLY DATA
    const weatherUrl = `${WEATHER_API}?latitude=${lat}&longitude=${lng}&current=temperature_2m,relative_humidity_2m,apparent_temperature,precipitation_probability,weather_code,surface_pressure,wind_speed_10m,wind_direction_10m,wind_gusts_10m,visibility,snow_depth,snowfall,cloud_cover,dew_point_2m&daily=sunrise,sunset,uv_index_max&hourly=temperature_2m,weather_code,precipitation_probability,wind_speed_10m,freezing_level_height&forecast_days=2`;
    const airQualityUrl = `${AIR_QUALITY_API}?latitude=${lat}&longitude=${lng}&current=european_aqi`;

    const [eleRes, weatherRes, aqiRes] = await Promise.all([
      fetch(`${ELEVATION_API}?latitude=${lats}&longitude=${lngs}`),
      fetch(weatherUrl),
      fetch(airQualityUrl)
    ]);

    const eleData = await eleRes.json();
    const weatherData = await weatherRes.json();
    const aqiData = await aqiRes.json();

    // --- PHYSICS CALCULATION ---
    const eles: number[] = eleData.elevation || [0,0,0,0,0];
    const [c, n, s, e, w] = eles;

    // Calculate Slopes (positive means terrain goes UP in that direction)
    const slopeN = n - c;
    const slopeS = s - c;
    const slopeE = e - c;
    const slopeW = w - c;

    // Determine Exposure (The side that looks 'down')
    let exposure = Exposure.VARIOUS;
    let maxDrop = -Infinity;

    if (-slopeN > maxDrop) { maxDrop = -slopeN; exposure = Exposure.NORTH; }
    if (-slopeS > maxDrop) { maxDrop = -slopeS; exposure = Exposure.SOUTH; }
    if (-slopeE > maxDrop) { maxDrop = -slopeE; exposure = Exposure.EAST; }
    if (-slopeW > maxDrop) { maxDrop = -slopeW; exposure = Exposure.WEST; }
    
    if (Math.abs(n-s) < 5 && Math.abs(e-w) < 5) exposure = Exposure.VARIOUS;

    // Determine Morphology & Signal Estimate
    let terrainType = "Versante";
    let signalLevel = SignalStrength.MEDIUM;
    let signalReason = "Copertura standard prevista.";

    const avgSurround = (n + s + e + w) / 4;
    const diff = c - avgSurround;

    if (diff > 10) {
        terrainType = "Cresta / Vetta";
        signalLevel = SignalStrength.HIGH;
        signalReason = "Posizione dominante, visuale libera verso i ripetitori.";
    } else if (diff < -10) {
        terrainType = "Conca / Valle Stretta";
        signalLevel = SignalStrength.NONE;
        signalReason = "Ostruzione orografica probabile.";
    } else {
        if (maxDrop > 15) {
             terrainType = "Versante Aperto";
             signalLevel = SignalStrength.MEDIUM;
             signalReason = `Esposto a ${exposure}, segnale dipendente dalla valle.`;
        }
    }

    // --- AQI PARSING ---
    const aqi = aqiData?.current?.european_aqi || 0;

    // --- WEATHER PARSING ---
    let weather = null;
    if (weatherData.current && weatherData.daily) {
        const current = weatherData.current;
        const daily = weatherData.daily;
        const currentHourIndex = new Date().getHours();
        const freezingLevel = weatherData.hourly?.freezing_level_height?.[currentHourIndex] || 0;

        // Process Hourly Data (Next 24h)
        const hourly: HourlyForecast[] = [];
        if (weatherData.hourly) {
            for (let i = currentHourIndex; i < currentHourIndex + 24; i++) {
                if (weatherData.hourly.time[i]) {
                    hourly.push({
                        time: weatherData.hourly.time[i].split('T')[1].substring(0, 5),
                        temp: weatherData.hourly.temperature_2m[i],
                        conditionCode: weatherData.hourly.weather_code[i],
                        precipProb: weatherData.hourly.precipitation_probability[i],
                        windSpeed: weatherData.hourly.wind_speed_10m[i]
                    });
                }
            }
        }

        weather = {
            temp: current.temperature_2m,
            apparentTemp: current.apparent_temperature,
            conditionCode: current.weather_code,
            windSpeed: current.wind_speed_10m,
            windGusts: current.wind_gusts_10m,
            windDirection: current.wind_direction_10m,
            windDirText: getWindDirection(current.wind_direction_10m),
            humidity: current.relative_humidity_2m,
            pressure: current.surface_pressure,
            visibility: current.visibility,
            precipProb: current.precipitation_probability,
            uvIndex: daily.uv_index_max?.[0] || 0,
            snowDepth: current.snow_depth || 0,
            isSnowing: (current.snowfall || 0) > 0,
            cloudCover: current.cloud_cover || 0,
            dewPoint: current.dew_point_2m || 0,
            freezingLevel: freezingLevel,
            sunrise: daily.sunrise[0]?.split('T')[1] || '--:--',
            sunset: daily.sunset[0]?.split('T')[1] || '--:--',
            description: getWeatherDescription(current.weather_code),
            hourly: hourly
        };
    }

    return {
        exposure: exposure,
        terrainType: terrainType,
        signalEstimate: {
            level: signalLevel,
            reason: signalReason
        },
        aqi: aqi,
        weather: weather
    };

  } catch (e) {
    console.error("Physics Analysis Failed", e);
    return {
        exposure: Exposure.VARIOUS,
        terrainType: "Sconosciuto",
        signalEstimate: { level: SignalStrength.NONE, reason: "Dati non disponibili" },
        aqi: 0,
        weather: null
    };
  }
};
