// =============================================================
//  lib/tgd-flight-adapter.ts  —  v2 (sa lookup tablicama)
//
//  Adapter za Podgoricu (TGD) — PADS4 OData format
//  Mapira na egzaktni Flight tip iz types/flight.ts
//  API URL: https://montenegroairports.com/aerodromixs/cache-flights.php?airport=pg
// =============================================================

import type { Flight } from '@/types/flight';
import {
  getAirlineICAO,
  getAirportIATA,
  getICAOFromFlightNumber,
} from '@/lib/airport-lookups';

// ----------------------------------------------------------
// 1.  TIP: sirovi PADS4 objekat koji stiže sa TGD API-ja
// ----------------------------------------------------------
export interface TGDRawFlight {
  ID: string;
  FlightType: 'Arrival' | 'Departure';
  ScheduledDateTime: string;
  EstimatedDateTime: string | null;
  ActualDateTime: string | null;
  FlightNumberIATA: string | null;
  FlightNumberICAO: string | null;
  StatusID: string | null;
  PrivateRemarkID: string | null;
  PrivateRemarkAdhoc: string | null;
  PublicRemarkID: string | null;
  PublicRemarkAdhoc: string | null;
  Airline: string;
  Airport: string;
  Checkins: string[];
  Gates: string[];
  BaggageBelts: string[];
  Codeshares: string[];
}

export interface TGDApiResponse {
  '@odata.context'?: string;
  value: TGDRawFlight[];
}

// ----------------------------------------------------------
// 2.  POMOĆNE FUNKCIJE
// ----------------------------------------------------------
function isoToHHMM(iso: string | null | undefined): string {
  if (!iso) return '';
  const match = iso.match(/T(\d{2}):(\d{2})/);
  return match ? `${match[1]}:${match[2]}` : '';
}

function mapStatusEN(statusID: string | null): string {
  if (!statusID) return '';
  const s = statusID.trim();
  if (/^arrived/i.test(s))     return 'Arrived';
  if (/^departed/i.test(s))    return 'Departed';
  if (/^landed/i.test(s))      return 'Landed';
  if (/^boarding/i.test(s))    return 'Boarding';
  if (/^gate closed/i.test(s)) return 'Gate Closed';
  if (/^delayed/i.test(s))     return 'Delayed';
  if (/^cancelled/i.test(s))   return 'Cancelled';
  return s;
}

function airlineCodeFromFlight(iata: string | null): string {
  if (!iata) return '';
  const m = iata.match(/^([A-Z]{2}|[A-Z]\d|\d[A-Z])/);
  return m ? m[1] : iata.slice(0, 2);
}

// ----------------------------------------------------------
// 3.  MAPPER: TGDRawFlight → Flight
// ----------------------------------------------------------
export function mapTGDFlight(raw: TGDRawFlight): Flight {
  const isDeparture  = raw.FlightType === 'Departure';
  const flightNumber = raw.FlightNumberIATA ?? raw.FlightNumberICAO ?? 'UNKNOWN';
  const airlineCode  = airlineCodeFromFlight(flightNumber);

  // ICAO kôd: lookup tablica → izvlačenje iz broja leta → PADS4 ICAO polje
  const airlineICAO =
    getAirlineICAO(airlineCode) ||
    getICAOFromFlightNumber(flightNumber) ||
    raw.FlightNumberICAO?.substring(0, 3).toUpperCase() ||
    '';

  // IATA kôd odredišta: lookup tablica po nazivu aerodroma/grada
  const destinationIATA = getAirportIATA(raw.Airport);

  const scheduledTime = raw.ScheduledDateTime ?? '';
  const estimatedTime = raw.EstimatedDateTime  ?? '';
  const actualTime    = raw.ActualDateTime     ?? '';
  const statusEN      = mapStatusEN(raw.StatusID);

  const gate    = raw.Gates.length      > 0 ? raw.Gates[0]           : '';
  const checkin = raw.Checkins.length   > 0 ? raw.Checkins.join(',') : '';
  const baggage = raw.BaggageBelts.length > 0 ? raw.BaggageBelts[0] : '';

  return {
    id:             raw.ID,
    FlightNumber:   flightNumber,
    AirlineCode:    airlineCode,
    AirlineICAO:    airlineICAO,       // ✅ popunjeno iz lookup tablice
    AirlineName:    raw.Airline,
    AirlineLogoURL: airlineICAO
      ? `https://www.flightaware.com/images/airline_logos/180px/${airlineICAO}.png`
      : '',

    FlightType: isDeparture ? 'departure' : 'arrival',

    DestinationAirportName: raw.Airport,
    DestinationAirportCode: destinationIATA, // ✅ popunjeno iz lookup tablice
    DestinationCityName:    raw.Airport,

    ScheduledDepartureTime: scheduledTime,
    EstimatedDepartureTime: estimatedTime,
    ActualDepartureTime:    actualTime,

    StatusEN: statusEN,
    StatusMN: '',

    Terminal:        'T1',
    GateNumber:      gate,
    GateNumbers:     gate    ? [gate]                              : [],
    CheckInDesk:     checkin,
    CheckInDesks:    checkin ? checkin.split(',').map(d => d.trim()) : [],
    BaggageReclaim:  baggage,
    CodeShareFlights: raw.Codeshares ?? [],

    IsBackupData:     false,
    AutoProcessed:    false,
    ProcessingStage:  'none',
    LastStatusUpdate: new Date().toISOString(),
    OriginalStatus:   raw.StatusID ?? '',
    IsOfflineMode:    false,
    BackupTimestamp:  '',

    Airline:      raw.Airline,
    Destination:  isDeparture ? raw.Airport : '',
    Origin:       isDeparture ? '' : raw.Airport,
    ScheduleTime: isoToHHMM(scheduledTime),
    Status:       statusEN,
    Gate:         gate,
  };
}

// ----------------------------------------------------------
// 4.  FILTER, SORT, DEDUP, PARSE, PIPELINE
// ----------------------------------------------------------
export function filterTodayFlightsTGD(flights: Flight[]): Flight[] {
  const now       = new Date();
  const todayStr  = now.toISOString().slice(0, 10);
  const yesterday = new Date(now);
  yesterday.setDate(yesterday.getDate() - 1);
  const yestStr   = yesterday.toISOString().slice(0, 10);

  return flights.filter(f => {
    const dateStr = f.ScheduledDepartureTime?.slice(0, 10);
    if (!dateStr) return false;
    if (dateStr === todayStr) return true;
    if (dateStr === yestStr) {
      const scheduled = new Date(f.ScheduledDepartureTime);
      if (isNaN(scheduled.getTime())) return false;
      return (now.getTime() - scheduled.getTime()) / 3_600_000 < 4;
    }
    return false;
  });
}

export function sortFlightsByTimeTGD(flights: Flight[]): Flight[] {
  return [...flights].sort((a, b) =>
    (a.ScheduledDepartureTime ?? '').localeCompare(b.ScheduledDepartureTime ?? '')
  );
}

export function removeDuplicatesTGD(flights: Flight[]): Flight[] {
  const seen = new Map<string, Flight>();
  flights.forEach(f => {
    const key = `${f.FlightNumber}-${f.ScheduledDepartureTime?.slice(0, 16)}-${f.FlightType}`;
    if (!seen.has(key)) {
      seen.set(key, f);
    } else {
      const existing = seen.get(key)!;
      if ((f.GateNumber && !existing.GateNumber) ||
          (f.CheckInDesk && !existing.CheckInDesk)) {
        seen.set(key, f);
      }
    }
  });
  return Array.from(seen.values());
}

export function parseTGDApiResponse(data: unknown): TGDRawFlight[] {
  if (Array.isArray(data)) return data as TGDRawFlight[];
  const odata = data as TGDApiResponse;
  if (odata && Array.isArray(odata.value)) return odata.value;
  throw new Error('TGD API: nepoznat format odgovora (očekivan OData { value: [] } ili array)');
}

export function processTGDFlights(rawData: unknown): {
  departures: Flight[];
  arrivals:   Flight[];
  total:      number;
} {
  const rawFlights = parseTGDApiResponse(rawData);
  const mapped     = rawFlights.map(mapTGDFlight);
  const filtered   = filterTodayFlightsTGD(mapped);
  const deduped    = removeDuplicatesTGD(filtered);

  const departures = sortFlightsByTimeTGD(
    deduped.filter(f => f.FlightType === 'departure')
  );
  const arrivals = sortFlightsByTimeTGD(
    deduped.filter(f => f.FlightType === 'arrival')
  );

  return { departures, arrivals, total: departures.length + arrivals.length };
}