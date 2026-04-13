// =============================================================
//  lib/airport-lookups.ts
//
//  Dvije lookup tablice za TGD (Podgorica) PADS4 format:
//
//  1. AIRLINE_IATA_TO_ICAO  — IATA kôd aviokompanije → ICAO kôd
//     Koristi se za dohvat logoa s FlightAware-a i iz /public/airlines/
//     Primjer: "W6" → "WZZ",  "4O" → "MNE",  "FR" → "RYR"
//
//  2. AIRPORT_NAME_TO_IATA  — naziv aerodroma/grada → IATA kôd
//     PADS4 vraća samo string "Ljubljana", "Vienna" itd.
//     Koristi se za dohvat slike grada iz /public/city-images/
//     Primjer: "Ljubljana" → "LJU",  "Vienna" → "VIE"
//
//  Dodavanje novih unosa:
//    - Aviokompanije: https://www.icao.int/Pages/doc8585.aspx
//    - Aerodromu:     https://www.iata.org/en/publications/directories/code-search/
// =============================================================

// ----------------------------------------------------------
// 1.  AIRLINE IATA → ICAO
//     Ključ: 2-slovna (ili 2-char) IATA oznaka aviokompanije
//     Vrijednost: 3-slovna ICAO oznaka (za FlightAware logo URL
//     i za lokalni fajl /public/airlines/{ICAO}.jpg|.png)
// ----------------------------------------------------------
export const AIRLINE_IATA_TO_ICAO: Record<string, string> = {
  // ── Redovne linije na TGD / TIV ───────────────────────────
  '4O': 'MNE',   // Air Montenegro
  'JU': 'ASL',   // Air Serbia
  'TK': 'THY',   // Turkish Airlines
  'OS': 'AUA',   // Austrian Airlines
  'FR': 'RYR',   // Ryanair
  'W6': 'WZZ',   // Wizz Air
  'W9': 'WUK',   // Wizz Air UK  (nekad "W9", nekad "W4")
  'W4': 'WUK',   // Wizz Air UK  (alternativna IATA oznaka)
  'PC': 'PGT',   // Pegasus Airlines
  'LO': 'LOT',   // LOT Polish Airlines
  'LS': 'EXS',   // Jet2.com
  'U2': 'EZY',   // easyJet
  'IZ': 'AIZ',   // Arkia Israeli Airlines
  '3F': 'FIE',   // FlyOne Armenia
  'ZI': 'AAF',   // Aigle Azur (historijska, za svaki slučaj)
  'A3': 'AEE',   // Aegean Airlines
  'QR': 'QTR',   // Qatar Airways
  'EK': 'UAE',   // Emirates
  'LH': 'DLH',   // Lufthansa
  'BA': 'BAW',   // British Airways
  'AF': 'AFR',   // Air France
  'KL': 'KLM',   // KLM
  'AY': 'FIN',   // Finnair
  'SK': 'SAS',   // SAS
  'DY': 'NAX',   // Norwegian
  'VY': 'VLG',   // Vueling
  'IB': 'IBE',   // Iberia
  'TP': 'TAP',   // TAP Air Portugal
  'SN': 'BEL',   // Brussels Airlines
  'LX': 'SWR',   // Swiss
  'EW': 'EWG',   // Eurowings
  'EN': 'DLA',   // Air Dolomiti
  'BT': 'BTI',   // airBaltic
  'PS': 'AUI',   // Ukraine International
  'GF': 'GFA',   // Gulf Air
  'MS': 'MSR',   // EgyptAir
  'RO': 'ROT',   // TAROM
  'FB': 'LZB',   // Bulgaria Air
  'JP': 'ADR',   // Adria Airways (historijska)
  'OU': 'CTN',   // Croatia Airlines
  'JT': 'JSA',   // Lion Air (za slučaj charter-a)
  'NK': 'NKS',   // Spirit Airlines
  'B6': 'JBU',   // JetBlue
  '6H': 'ISV',   // Israir Airlines
  'FZ': 'FDB',   // flydubai
  'G9': 'ABY',   // Air Arabia
  'HY': 'UZB',   // Uzbekistan Airways
  'S7': 'SBI',   // S7 Airlines
  'SU': 'AFL',   // Aeroflot (historijska)
  'ET': 'ETH',   // Ethiopian Airlines
  'CM': 'CMP',   // Copa Airlines
};

// ----------------------------------------------------------
// 2.  AIRPORT NAME → IATA KÔD
//     Ključ: naziv koji PADS4 vraća u polju "Airport"
//     Vrijednost: IATA kôd aerodroma (za /public/city-images/{IATA}.jpg)
//
//     Napomena: Ako grad ima više aerodroma, stavi onaj koji
//     se najčešće koristi za letove na TGD/TIV ruti.
// ----------------------------------------------------------
export const AIRPORT_NAME_TO_IATA: Record<string, string> = {
  // ── Već prisutni na TGD rasporedu ─────────────────────────
  'Belgrade':           'BEG',
  'Vienna':             'VIE',
  'Istanbul':           'IST',
  'Dortmund':           'DTM',
  'Budapest':           'BUD',
  'Berlin':             'BER',
  'London Gatwick':     'LGW',
  'Gdansk':             'GDN',
  'Paris Beauvais':     'BVA',
  'Brussels Charleroi': 'CRL',
  'Ljubljana':          'LJU',
  'Rome':               'FCO',
  'Krakow':             'KRK',
  'Warsaw':             'WAW',
  'Ankara':             'ESB',
  'Malmo':              'MMX',
  'Milan':              'MXP',
  'Thessaloniki':       'SKG',
  'Yerevan':            'EVN',
  'London STN':         'STN',
  'London LTN':         'LTN',
  'Manchester':         'MAN',
  'Birmingham':         'BHX',
  'Bristol':            'BRS',
  'Tel Aviv':           'TLV',

  // ── Česti letovi s TIV ─────────────────────────────────────
  'Frankfurt':          'FRA',
  'Munich':             'MUC',
  'Zurich':             'ZRH',
  'Amsterdam':          'AMS',
  'Paris CDG':          'CDG',
  'Paris':              'CDG',
  'London Heathrow':    'LHR',
  'London':             'LHR',
  'Barcelona':          'BCN',
  'Madrid':             'MAD',
  'Lisbon':             'LIS',
  'Athens':             'ATH',
  'Dubrovnik':          'DBV',
  'Split':              'SPU',
  'Sarajevo':           'SJJ',
  'Skopje':             'SKP',
  'Tirana':             'TIA',
  'Sofia':              'SOF',
  'Bucharest':          'OTP',
  'Budapest Keleti':    'BUD',
  'Copenhagen':         'CPH',
  'Stockholm':          'ARN',
  'Oslo':               'OSL',
  'Helsinki':           'HEL',
  'Brussels':           'BRU',
  'Geneva':             'GVA',
  'Nice':               'NCE',
  'Lyon':               'LYS',
  'Marseille':          'MRS',
  'Dubai':              'DXB',
  'Abu Dhabi':          'AUH',
  'Doha':               'DOH',
  'Tel Aviv Ben Gurion':'TLV',
  'Moscow':             'SVO',
  'St. Petersburg':     'LED',
  'Kyiv':               'KBP',
  'Kyiv Boryspil':      'KBP',
  'Warsaw Chopin':      'WAW',
  'Riga':               'RIX',
  'Vilnius':            'VNO',
  'Tallinn':            'TLL',
  'Prague':             'PRG',
  'Vienna International':'VIE',
  'Rome Fiumicino':     'FCO',
  'Milan Malpensa':     'MXP',
  'Milan Bergamo':      'BGY',
  'Venice':             'VCE',
  'Naples':             'NAP',
  'Palermo':            'PMO',
  'Catania':            'CTA',
  'Berlin Brandenburg': 'BER',
  'Hamburg':            'HAM',
  'Dusseldorf':         'DUS',
  'Cologne':            'CGN',
  'Stuttgart':          'STR',
  'Nuremberg':          'NUE',
  'London City':        'LCY',
  'London Stansted':    'STN',
  'London Luton':       'LTN',
  'Edinburgh':          'EDI',
  'Glasgow':            'GLA',
  'Dublin':             'DUB',
  'Lisbon Humberto':    'LIS',
  'Porto':              'OPO',
  'Seville':            'SVQ',
  'Malaga':             'AGP',
  'Alicante':           'ALC',
  'Palma de Mallorca':  'PMI',
  'Ibiza':              'IBZ',
  'Tenerife':           'TFN',
  'Gran Canaria':       'LPA',
  'Lanzarote':          'ACE',
  'Fuerteventura':      'FUE',
};

// ----------------------------------------------------------
// 3.  HELPER FUNKCIJE
// ----------------------------------------------------------

/**
 * Iz IATA koda aviokompanije vrati ICAO kôd.
 * Ako nije u tablici, vrati prazan string.
 *
 * Koristi u: tgd-flight-adapter.ts → mapTGDFlight()
 * Zamjenjuje: airlineICAOFromFlight() koja je uvijek vraćala ''
 *
 * Primjer:
 *   getAirlineICAO("4O")  → "MNE"
 *   getAirlineICAO("W6")  → "WZZ"
 *   getAirlineICAO("XX")  → ""
 */
export function getAirlineICAO(iataCode: string): string {
  if (!iataCode) return '';
  return AIRLINE_IATA_TO_ICAO[iataCode.toUpperCase()] ?? '';
}

/**
 * Iz naziva aerodroma/grada (kako ga PADS4 vraća) vrati IATA kôd.
 * Ako nije u tablici, vrati prazan string.
 *
 * Koristi u: tgd-flight-adapter.ts → mapTGDFlight()
 * Popunjava: DestinationAirportCode koji PADS4 ne daje direktno.
 *
 * Primjer:
 *   getAirportIATA("Vienna")          → "VIE"
 *   getAirportIATA("Brussels Charleroi") → "CRL"
 *   getAirportIATA("Nepoznat Grad")   → ""
 */
export function getAirportIATA(airportName: string): string {
  if (!airportName) return '';
  return AIRPORT_NAME_TO_IATA[airportName] ?? '';
}

/**
 * Iz broja leta (npr. "4O210") izvuci IATA kôd aviokompanije,
 * pa vrati odgovarajući ICAO kôd.
 *
 * Primjer:
 *   getICAOFromFlightNumber("4O210")  → "MNE"
 *   getICAOFromFlightNumber("W67602") → "WZZ"
 *   getICAOFromFlightNumber("OS737")  → "AUA"
 */
export function getICAOFromFlightNumber(flightNumber: string): string {
  if (!flightNumber) return '';
  // IATA kôd aviokompanije = prva 2 znaka (slovo+slovo ili slovo+cifra ili cifra+slovo)
  const match = flightNumber.match(/^([A-Z]{2}|[A-Z]\d|\d[A-Z])/);
  if (!match) return '';
  return getAirlineICAO(match[1]);
}