# Piano di Implementazione: Impostazioni Utente, Modulo SOS 112 & Migliorie GPX/Mappa

## 1. Analisi dell'Impatto (Protocollo di Preservazione)
- **Bivacchi & POI (`POI`, `dbService`, `osmService`, `filteredPois`)**: **Invariati**. Nessuna modifica a nomi di variabili, chiavi database o filtri esistenti.
- **Meteo & Analisi Fisica (`analyzeLocationPhysics`, `GeoAnalysis`, Radar)**: **Invariati**.
- **Lettura e Analisi GPX (`gpxTracks`, `analyzeGpxTrailAndPeaks`, `computeHikingTourRoute`)**: **Preservati al 100%**. L'aggiunta della proprietà opzionale `hidden?: boolean` sulle tracce GPX e dei parametri del passo CAI utente avviene in modo retrocompatibile con fallback ai valori standard CAI (`4.0 km/h`, `+350 m/h`, `-500 m/h`, `75 kg`).

---

## 2. Architettura Modulare: Nuovo Servizio `/services/settingsService.ts`
Creazione di un modulo dedicato e tipizzato (`UserAppSettings`) salvato in `localStorage` (`mountpro_user_settings_v1`) per gestire:
1. **Profilo Escursionista & Passo CAI / Munter**:
   - Nome/Nickname escursionista e contatto ICE (In Case of Emergency).
   - Preset Passo (*Tranquillo 300 m/h*, *Standard CAI 350 m/h*, *Esperto/Alpinistico 450 m/h*, *Trail Running 600 m/h*, *Personalizzato*) con velocità orizzontale (`km/h`), salita (`m/h`) e discesa (`m/h`).
   - Peso corporeo (`kg`) e peso zaino (`kg`) collegati ai calcoli di tempi, calorie (`kcal`) e idratazione consigliata (`L`).
2. **Rete & Modalità Offline Forzata**:
   - Flag `forceOfflineMode: boolean` per forzare l'app a operare 100% offline (zero richieste di rete e risparmio batteria in quota con segnale debole/instabile).
3. **Preferenze Avvio & Persistenza Stato**:
   - Salvataggio e ripristino automatico di ultima posizione/zoom mappa (`lastMapView`), stile mappa (`defaultMapStyle`) e filtri POI (`rememberFiltersOnStartup`).
4. **Backup & Ripristino Completo JSON (`exportFullBackupJson` / `importFullBackupJson`)**:
   - Esportazione in un unico file `.json` di Impostazioni, Preferiti, Note personali sui bivacchi, Waypoint custom, Tracce GPX e Tappe Tour, con funzione di ripristino immediato.
5. **Generatore Coordinate & Report SOS 112 (`formatDmsCoordinates` / `buildSosEmergencyReport`)**:
   - Conversione coordinate in formato **Gradi Decimali (DD)** e **Gradi Minuti Secondi (DMS)**, calcolo del punto d'appoggio (Bivacco/Rifugio) più vicino con distanza e azimut, e formattazione messaggio SOS pronto da copiare per il 112 / Soccorso Alpino.

---

## 3. Pagina Intera Dedicata "Impostazioni & Configurazione" (`/App.tsx`)
Realizzazione di una vista a pagina intera (`100vw × 100dvh`), accessibile sia dalla **barra superiore** (icona Impostazioni) sia dal pannello **Filtri**, organizzata in 4 schede chiare:
1. **Profilo & Passo CAI**: Configurazione passo escursionistico, peso corporeo, peso zaino e anteprima in tempo reale dei tempi CAI.
2. **Emergenza SOS 112**: Pannello ad alta visibilità con coordinate GPS/Centro Mappa in DD e DMS, quota DEM, struttura più vicina, contatto ICE e pulsante **"Copia Messaggio SOS Georeferenziato"**.
3. **Mappa & Avvio**: Scelta stile mappa predefinito, attivazione automatica salvataggio ultima posizione/zoom e filtri preferiti al riavvio.
4. **Offline, Memoria & Backup**: Interruttore **Modalità Offline Forzata**, diagnostica memoria locale e pulsanti **Esporta Backup Completo (.JSON)** / **Importa Backup (.JSON)**.

---

## 4. Correzioni Funzionali su GPX e Mappa (`/App.tsx`)
1. **Rimozione Limite 2 Tracce GPX + Toggle Mostra/Nascondi**:
   - Rimozione del blocco `tracks.length < 2` nel menu *Gestione Percorsi* per consentire il caricamento multiplo di tracce GPX.
   - Aggiunta del pulsante **Mostra/Nascondi traccia** (icona Occhio) su ogni traccia caricata per accenderla o spegnerla sulla mappa senza doverla eliminare.
2. **Persistenza Automatica Posizione Mappa e Filtri al Riavvio**:
   - Salvataggio automatico di coordinate/zoom correnti, stile mappa e filtri attivi così al successivo avvio l'utente ritrova esattamente la sua configurazione.
