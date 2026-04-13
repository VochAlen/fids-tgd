// app/api/flights/route.ts  —  TGD (Podgorica) verzija (BEZ REDISA)
import { NextResponse } from 'next/server';
// Uklonjen Redis import
// import { getRedisClient } from '@/lib/redis'; 
import { FlightBackupService } from '@/lib/backup/flight-backup-service';
import { FlightAutoProcessor, type AutoProcessedFlight } from '@/lib/backup/flight-auto-processor';
import type { Flight, FlightData } from '@/types/flight';
import { processTGDFlights } from '@/lib/tgd-flight-adapter';

// ── TGD (Podgorica) API endpoint ───────────────────────────────────────────────
const FLIGHT_API_URL =
  'https://montenegroairports.com/aerodromixs/cache-flights.php?airport=pg';

// Retry konfiguracija
const MAX_RETRIES = 2;
const RETRY_DELAY = 1000;

const userAgents = {
  chrome:  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/117.0.5938.132 Safari/537.36',
  firefox: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:117.0) Gecko/20100101 Firefox/117.0',
  safari:  'Mozilla/5.0 (Macintosh; Intel Mac OS X 13_5) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Safari/605.1.15',
};

// ==============================================================================
// FETCH SA RETRY
// ==============================================================================
async function fetchWithQuickRetry(
  url: string,
  options: RequestInit,
  retries = MAX_RETRIES
): Promise<Response> {
  for (let attempt = 1; attempt <= retries; attempt++) {
    try {
      const controller = new AbortController();
      const timeoutId  = setTimeout(() => controller.abort(), 10000);

      const response = await fetch(url, { ...options, signal: controller.signal });
      clearTimeout(timeoutId);

      if (response.ok) return response;

      if (attempt < retries) {
        console.log(`Quick retry ${attempt}/${retries}...`);
        await new Promise(resolve => setTimeout(resolve, RETRY_DELAY));
      }
    } catch (error) {
      if (attempt === retries) throw error;
      console.log(`Quick retry after error ${attempt}/${retries}...`);
      await new Promise(resolve => setTimeout(resolve, RETRY_DELAY));
    }
  }
  throw new Error(`Live API fetch failed after ${retries} attempts`);
}

// ==============================================================================
// EMERGENCY FETCH (manji skup podataka, bez obrade)
// ==============================================================================
async function performEmergencyFetch(): Promise<Flight[] | null> {
  try {
    const emergencyResponse = await fetch(FLIGHT_API_URL, {
      method: 'GET',
      headers: {
        'User-Agent':      userAgents.chrome,
        'Accept':          'application/json, text/javascript, */*; q=0.01',
        'Accept-Language': 'en-US,en;q=0.9',
        'Referer':         'https://montenegroairports.com/',
        'Origin':          'https://montenegroairports.com',
      },
      signal: AbortSignal.timeout(10000),
    });

    if (!emergencyResponse.ok) return null;

    const rawData: unknown = await emergencyResponse.json();
    const { departures, arrivals } = processTGDFlights(rawData);
    return [...departures, ...arrivals];

  } catch (error) {
    console.error('❌ Emergency fetch failed:', error);
    return null;
  }
}

// ==============================================================================
// SORTIRANJE (koristi se za backup mode gdje letovi već imaju Flight tip)
// ==============================================================================
function sortFlightsByTime(flights: Flight[]): Flight[] {
  return [...flights].sort((a, b) =>
    (a.ScheduledDepartureTime ?? '').localeCompare(b.ScheduledDepartureTime ?? '')
  );
}

// ==============================================================================
// GLAVNI GET HANDLER
// ==============================================================================
export async function GET(): Promise<NextResponse> {
  const backupService = FlightBackupService.getInstance();

  // ────────────────────────────────────────────────────────────────────────────
  // 1. LIVE API FETCH
  // ────────────────────────────────────────────────────────────────────────────
  try {
    console.log('🔄 Attempting LIVE API fetch from Montenegro Airports (TGD)...');

    const response = await fetchWithQuickRetry(FLIGHT_API_URL, {
      method: 'GET',
      headers: {
        'User-Agent':      userAgents.chrome,
        'Accept':          'application/json, text/javascript, */*; q=0.01',
        'Accept-Language': 'en-US,en;q=0.9',
        'Referer':         'https://montenegroairports.com/',
        'Origin':          'https://montenegroairports.com',
        'Connection':      'keep-alive',
        'DNT':             '1',
      },
    });

    if (!response.ok) {
      throw new Error(`HTTP ${response.status}: ${response.statusText}`);
    }

    const rawData: unknown = await response.json();

    // ── Obrada podataka kroz TGD adapter ──────────────────────────────────────
    const { departures: mappedDep, arrivals: mappedArr, total } =
      processTGDFlights(rawData);

    console.log(`✅ TGD live fetch uspješan: ${mappedDep.length} odlazaka, ${mappedArr.length} dolazaka`);

    // ── Backup ────────────────────────────────────────────────────────────────
    try {
      const allFlights = [...mappedDep, ...mappedArr];
      const backupId   = backupService.saveBackup(allFlights);
      console.log(`💾 Backup sačuvan: ${backupId} (${allFlights.length} letova)`);
    } catch (backupError: unknown) {
      console.error('⚠️ Backup save failed:', backupError instanceof Error ? backupError.message : backupError);
    }

    // ── Default traka za dolaske (Direct processing, bez Redis-a) ─────────────
    const arrivals = mappedArr.map((flight: Flight) => {
      const statusLower = (flight.StatusEN || '').toLowerCase();
      const isArrived   = statusLower.includes('arrived') ||
                          statusLower.includes('sletio')  ||
                          statusLower.includes('landed');
      if (!isArrived && !flight.BaggageReclaim) {
        return { ...flight, BaggageReclaim: '2' };
      }
      return flight;
    });

    const departures = mappedDep; // Nema izmjena za odlaske

    const totalFlights = departures.length + arrivals.length;

    console.log(`📊 FINAL: ${departures.length} odlazaka, ${arrivals.length} dolazaka, ukupno: ${totalFlights}`);

    const flightData: FlightData = {
      departures,
      arrivals,
      lastUpdated:  new Date().toISOString(),
      source:       'live',
      totalFlights,
      isOfflineMode: false,
    };

    return NextResponse.json(flightData, {
      headers: {
        'Cache-Control':    'public, s-maxage=30, stale-while-revalidate=60',
        'X-Data-Source':    'live',
        'X-Backup-Available': 'true',
        'X-Total-Flights':  flightData.totalFlights.toString(),
        'X-Departures':     departures.length.toString(),
        'X-Arrivals':       arrivals.length.toString(),
      },
    });

  } catch (liveError: unknown) {
    const errorMessage = liveError instanceof Error ? liveError.message : 'Unknown live API error';
    console.error('❌ TGD live API fetch failed:', errorMessage);
    console.log('🔄 Switching to BACKUP + AUTO-PROCESSING mode...');

    // ──────────────────────────────────────────────────────────────────────────
    // 2. BACKUP + AUTO-PROCESSING MODE
    // ──────────────────────────────────────────────────────────────────────────
    try {
      const latestBackup = backupService.getLatestBackup();

      if (latestBackup.flights.length > 0) {
        console.log(`✅ Koristim BACKUP iz ${latestBackup.timestamp} (${latestBackup.flights.length} letova)`);

        const processor         = new FlightAutoProcessor(latestBackup.flights);
        const processedFlights  = processor.processFlights();
        const simulatedFlights  = FlightAutoProcessor.simulateRealTimeProgress(processedFlights);

        let autoProcessedDepartures = sortFlightsByTime(
          simulatedFlights.filter((f: AutoProcessedFlight) => f.FlightType === 'departure')
        );
        let autoProcessedArrivals = sortFlightsByTime(
          simulatedFlights.filter((f: AutoProcessedFlight) => f.FlightType === 'arrival')
        );

        // ── Default traka za backup mode (bez Redis-a) ────────────────────────
        autoProcessedArrivals = autoProcessedArrivals.map((flight: Flight) => {
          const statusLower = (flight.StatusEN || '').toLowerCase();
          const isArrived   = statusLower.includes('arrived') ||
                              statusLower.includes('sletio')  ||
                              statusLower.includes('landed');
          if (!isArrived && !flight.BaggageReclaim) {
            return { ...flight, BaggageReclaim: '2' };
          }
          return flight;
        });

        const autoProcessedCount = simulatedFlights.filter(
          (f: AutoProcessedFlight) => f.AutoProcessed
        ).length;

        const source = autoProcessedCount > 0 ? 'auto-processed' : 'backup';
        const totalFlights = autoProcessedDepartures.length + autoProcessedArrivals.length;

        const flightData: FlightData = {
          departures:         autoProcessedDepartures,
          arrivals:           autoProcessedArrivals,
          lastUpdated:        latestBackup.timestamp,
          source,
          backupTimestamp:    latestBackup.timestamp,
          autoProcessedCount,
          isOfflineMode:      true,
          totalFlights,
          warning:            'Koriste se backup podaci. Live API privremeno nedostupan.',
        };

        console.log(`📊 BACKUP spreman: ${autoProcessedDepartures.length} odlazaka, ${autoProcessedArrivals.length} dolazaka`);

        return NextResponse.json(flightData, {
          headers: {
            'Cache-Control':      'public, s-maxage=10, stale-while-revalidate=30',
            'X-Data-Source':      source,
            'X-Offline-Mode':     'true',
            'X-Backup-Timestamp': latestBackup.timestamp,
            'X-Total-Flights':    flightData.totalFlights.toString(),
          },
        });

      } else {
        // ──────────────────────────────────────────────────────────────────────
        // 3. EMERGENCY FETCH (backup prazan)
        // ──────────────────────────────────────────────────────────────────────
        console.log('⚠️ Backup prazan, pokušavam emergency fetch...');

        const emergencyFlights = await performEmergencyFetch();

        if (emergencyFlights && emergencyFlights.length > 0) {
          backupService.saveBackup(emergencyFlights);

          const processor       = new FlightAutoProcessor(emergencyFlights);
          const processedFlights = processor.processFlights();

          let departures = sortFlightsByTime(
            processedFlights.filter((f: AutoProcessedFlight) => f.FlightType === 'departure')
          );
          let arrivals = sortFlightsByTime(
            processedFlights.filter((f: AutoProcessedFlight) => f.FlightType === 'arrival')
          );

          // Default traka za emergency mode (bez Redis-a)
          arrivals = arrivals.map((flight: Flight) => {
            const statusLower = (flight.StatusEN || '').toLowerCase();
            const isArrived   = statusLower.includes('arrived') ||
                                statusLower.includes('sletio')  ||
                                statusLower.includes('landed');
            if (!isArrived && !flight.BaggageReclaim) {
              return { ...flight, BaggageReclaim: '2' };
            }
            return flight;
          });

          const totalFlights = departures.length + arrivals.length;

          const flightData: FlightData = {
            departures,
            arrivals,
            lastUpdated:   new Date().toISOString(),
            source:        'emergency',
            isOfflineMode: true,
            totalFlights,
            warning:       'Emergency mode: Koriste se direktno preuzeti podaci.',
          };

          console.log(`🚨 EMERGENCY spreman: ${departures.length} odlazaka, ${arrivals.length} dolazaka`);

          return NextResponse.json(flightData, {
            headers: {
              'Cache-Control':   'public, s-maxage=5, stale-while-revalidate=15',
              'X-Data-Source':   'emergency',
              'X-Offline-Mode':  'true',
              'X-Emergency':     'true',
              'X-Total-Flights': flightData.totalFlights.toString(),
            },
          });
        }

        // Sve metode iscrpljene — vrati prazan odgovor
        const emptyData: FlightData = {
          departures:    [],
          arrivals:      [],
          lastUpdated:   new Date().toISOString(),
          source:        'emergency',
          isOfflineMode: true,
          totalFlights:  0,
          error:   'Svi izvori podataka nedostupni. Provjerite konekciju.',
          warning: 'Sistem će se oporaviti kada se veza uspostavi.',
        };

        return NextResponse.json(emptyData, {
          status: 200,
          headers: {
            'Cache-Control':  'no-cache, no-store, must-revalidate',
            'X-Data-Source':  'critical-emergency',
            'X-Offline-Mode': 'true',
            'X-Emergency':    'true',
            'X-Total-Flights': '0',
          },
        });
      }

    } catch (backupError: unknown) {
      const backupErrorMessage =
        backupError instanceof Error ? backupError.message : 'Unknown backup system error';
      console.error('❌ KRITIČNO: Backup sistem zatajio:', backupErrorMessage);

      const emergencyData: FlightData = {
        departures:    [],
        arrivals:      [],
        lastUpdated:   new Date().toISOString(),
        source:        'emergency',
        isOfflineMode: true,
        totalFlights:  0,
        error:   'KRITIČNO: Svi sistemi zatajili.',
        warning: 'Sistem u emergency recovery modu. Osvježite stranicu.',
      };

      return NextResponse.json(emergencyData, {
        status: 200,
        headers: {
          'Cache-Control':  'no-cache, no-store, must-revalidate',
          'X-Data-Source':  'critical-emergency',
          'X-Offline-Mode': 'true',
          'X-Emergency':    'true',
          'X-Total-Flights': '0',
        },
      });
    }
  }
}

export const dynamic   = 'force-dynamic';
export const revalidate = 0;
