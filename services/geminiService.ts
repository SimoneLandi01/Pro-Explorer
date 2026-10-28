import { GoogleGenAI, Type } from "@google/genai";
import { POI, LiveConditions } from "../types.ts";

export interface AIResponse {
  data: LiveConditions | null;
  sources: { title: string; uri: string }[];
}

// In-memory cache: Key = POI.id, Value = AIResponse
const infoCache = new Map<string, AIResponse>();
const areaCache = new Map<string, AIResponse>(); // Separate cache for area lookups

const getApiKey = () => (typeof process !== 'undefined' && process.env && process.env.API_KEY) ? process.env.API_KEY : '';

const COMMON_CONFIG = {
  tools: [{ googleSearch: {} }],
  responseMimeType: "application/json",
  responseSchema: {
    type: Type.OBJECT,
    properties: {
      temperature: { type: Type.STRING, description: "Temperatura attuale (es. '-2°C')" },
      feels_like: { type: Type.STRING, description: "Temperatura percepita (es. '-5°C')" },
      condition: { type: Type.STRING, description: "Condizione meteo breve (es. 'Nuvoloso')" },
      wind: { type: Type.STRING, description: "Velocità e direzione vento (es. '15 km/h N')" },
      humidity: { type: Type.STRING, description: "Umidità relativa (es. '45%')" },
      pressure: { type: Type.STRING, description: "Pressione atmosferica (es. '1013 hPa')" },
      uv_index: { type: Type.STRING, description: "Indice UV (es. '3 Moderato')" },
      visibility: { type: Type.STRING, description: "Visibilità in km (es. '>10km')" },
      sunrise: { type: Type.STRING, description: "Orario alba HH:MM" },
      sunset: { type: Type.STRING, description: "Orario tramonto HH:MM" },
      
      hourly_forecast: {
        type: Type.ARRAY,
        description: "Previsioni per le prossime 4 ore",
        items: {
            type: Type.OBJECT,
            properties: {
                time: { type: Type.STRING, description: "Ora (es. 14:00)" },
                temp: { type: Type.STRING, description: "Temp prevista" },
                condition: { type: Type.STRING, description: "Condizione breve" }
            }
        }
      },

      connectivity_info: {
         type: Type.OBJECT,
         properties: {
            type: { type: Type.STRING, description: "Tipo rete: '5G', '4G', '3G', 'H+', '/'" },
            strength: { type: Type.INTEGER, description: "Potenza segnale 0-4" },
            description: { type: Type.STRING, description: "Breve descrizione copertura" }
         },
         required: ["type", "strength", "description"]
      },
      
      snow_ice_alert: { type: Type.BOOLEAN, description: "True se neve/ghiaccio probabili" },
      summary: { type: Type.STRING, description: "Consiglio tecnico escursionista (max 150 caratteri)" }
    },
    required: ["temperature", "feels_like", "condition", "wind", "humidity", "pressure", "uv_index", "visibility", "sunrise", "sunset", "hourly_forecast", "connectivity_info", "snow_ice_alert", "summary"]
  }
};

export const getLiveOutdoorInfo = async (poi: POI): Promise<AIResponse> => {
  if (infoCache.has(poi.id)) return infoCache.get(poi.id)!;
  
  const apiKey = getApiKey();
  if (!apiKey) return { data: null, sources: [] };

  const ai = new GoogleGenAI({ apiKey: apiKey });
  
  try {
    const prompt = `Analizza la località outdoor "${poi.name}" a ${poi.altitude}m.
    Fornisci meteo completo attuale, percepito, umidità, pressione, indice UV.
    Fornisci previsioni orarie prossime 4 ore.
    Stima la copertura cellulare.`;

    const response = await ai.models.generateContent({
      model: "gemini-3-flash-preview",
      contents: prompt,
      config: COMMON_CONFIG,
    });

    const result = processResponse(response);
    if (result.data) infoCache.set(poi.id, result);
    return result;
  } catch (error) {
    console.error("Gemini POI Error:", error);
    return { data: null, sources: [] };
  }
};

export const getAreaWeatherAnalysis = async (lat: number, lng: number): Promise<AIResponse> => {
  const key = `${lat.toFixed(2)},${lng.toFixed(2)}`;
  if (areaCache.has(key)) return areaCache.get(key)!;

  const apiKey = getApiKey();
  if (!apiKey) return { data: null, sources: [] };

  const ai = new GoogleGenAI({ apiKey: apiKey });

  try {
    const prompt = `Analizza l'area geografica alle coordinate ${lat}, ${lng}.
    Fornisci un report meteo PROFESSIONALE per escursionisti.
    Includi: Temperatura reale e percepita, Vento, Umidità, Pressione, UV, Visibilità.
    Aggiungi una previsione oraria sintetica per le prossime 4 ore.
    Sii preciso su Alba e Tramonto locali.`;

    const response = await ai.models.generateContent({
      model: "gemini-3-flash-preview",
      contents: prompt,
      config: COMMON_CONFIG,
    });

    const result = processResponse(response);
    if (result.data) areaCache.set(key, result);
    return result;
  } catch (error) {
    console.error("Gemini Area Error:", error);
    return { data: null, sources: [] };
  }
};

// Helper to parse response
const processResponse = (response: any): AIResponse => {
    const sources = response.candidates?.[0]?.groundingMetadata?.groundingChunks
      ?.filter((chunk: any) => chunk.web)
      .map((chunk: any) => ({
        title: chunk.web?.title || "Fonte Web",
        uri: chunk.web?.uri || ""
      })) || [];

    let parsedData: LiveConditions | null = null;
    if (response.text) {
      try {
        parsedData = JSON.parse(response.text) as LiveConditions;
      } catch (e) { console.error("JSON Parse Error", e); }
    }

    return { data: parsedData, sources: sources };
};