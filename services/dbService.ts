import { POI } from '../types.ts';

const DB_NAME = 'MountProDB';
const DB_VERSION = 2;
const STORE_NAME = 'pois';
const OFFLINE_STATE_STORE = 'offline_state';

export const dbService = {
  openDB: (): Promise<IDBDatabase> => {
    return new Promise((resolve, reject) => {
      const request = indexedDB.open(DB_NAME, DB_VERSION);

      request.onerror = () => reject(request.error);
      request.onsuccess = () => resolve(request.result);

      request.onupgradeneeded = (event) => {
        const db = (event.target as IDBOpenDBRequest).result;
        if (!db.objectStoreNames.contains(STORE_NAME)) {
          db.createObjectStore(STORE_NAME, { keyPath: 'id' });
        }
        if (!db.objectStoreNames.contains(OFFLINE_STATE_STORE)) {
          db.createObjectStore(OFFLINE_STATE_STORE, { keyPath: 'key' });
        }
      };
    });
  },

  savePois: async (pois: POI[]): Promise<void> => {
    const db = await dbService.openDB();
    return new Promise((resolve, reject) => {
      const transaction = db.transaction([STORE_NAME], 'readwrite');
      const store = transaction.objectStore(STORE_NAME);

      pois.forEach(poi => {
        store.put(poi);
      });

      transaction.oncomplete = () => resolve();
      transaction.onerror = () => reject(transaction.error);
    });
  },

  getAllPois: async (): Promise<POI[]> => {
    const db = await dbService.openDB();
    return new Promise((resolve, reject) => {
      const transaction = db.transaction([STORE_NAME], 'readonly');
      const store = transaction.objectStore(STORE_NAME);
      const request = store.getAll();

      request.onsuccess = () => resolve(request.result || []);
      request.onerror = () => reject(request.error);
    });
  },

  // --- [OFFLINE PERSISTENCE EXTENSION] Salvataggio/Lettura stato offline (Tracce GPX, Reti Sentieri OSM, Meteo Cache) ---
  setOfflineItem: async (key: string, value: any): Promise<void> => {
    try {
      const db = await dbService.openDB();
      await new Promise<void>((resolve, reject) => {
        const transaction = db.transaction([OFFLINE_STATE_STORE], 'readwrite');
        const store = transaction.objectStore(OFFLINE_STATE_STORE);
        store.put({ key, value, updatedAt: Date.now() });
        transaction.oncomplete = () => resolve();
        transaction.onerror = () => reject(transaction.error);
      });
    } catch (e) {
      console.warn('IndexedDB setOfflineItem fallback:', e);
    }
  },

  getOfflineItem: async <T = any>(key: string): Promise<T | null> => {
    try {
      const db = await dbService.openDB();
      return await new Promise<T | null>((resolve, reject) => {
        const transaction = db.transaction([OFFLINE_STATE_STORE], 'readonly');
        const store = transaction.objectStore(OFFLINE_STATE_STORE);
        const request = store.get(key);
        request.onsuccess = () => resolve(request.result ? (request.result.value as T) : null);
        request.onerror = () => reject(request.error);
      });
    } catch (e) {
      console.warn('IndexedDB getOfflineItem fallback:', e);
      return null;
    }
  },
  
  clearAll: async (): Promise<void> => {
      const db = await dbService.openDB();
      return new Promise((resolve, reject) => {
        const storesToClear = [STORE_NAME];
        if (db.objectStoreNames.contains(OFFLINE_STATE_STORE)) {
          storesToClear.push(OFFLINE_STATE_STORE);
        }
        const transaction = db.transaction(storesToClear, 'readwrite');
        storesToClear.forEach(s => transaction.objectStore(s).clear());
        
        transaction.oncomplete = () => resolve();
        transaction.onerror = () => reject(transaction.error);
      });
  }
};