'use client';

import {
  useEffect, useState, useRef, useCallback, memo,
  Component, type ErrorInfo, type ReactNode, useMemo,
} from 'react';
import { useParams } from 'next/navigation';
import type { Flight } from '@/types/flight';
import { fetchFlightData } from '@/lib/flight-service';
import {
  getEnhancedCheckInStatus, checkFlightStatus,
  type CheckInStatus,
} from '@/lib/check-in-service';

const REFRESH_INTERVAL_MS    = 60_000;
const HARD_RESET_INTERVAL_MS = 6 * 60 * 60 * 1000;

interface EBState { hasError: boolean; message: string }
class GateErrorBoundary extends Component<{ children: ReactNode }, EBState> {
  constructor(props: { children: ReactNode }) {
    super(props);
    this.state = { hasError: false, message: '' };
  }
  static getDerivedStateFromError(e: Error) { return { hasError: true, message: e.message }; }
  componentDidCatch(e: Error, i: ErrorInfo) {
    console.error('🚨 Gate ErrorBoundary:', e, i);
    setTimeout(() => this.setState({ hasError: false, message: '' }), 10_000);
  }
  render() {
    if (this.state.hasError) return (
      <div style={styles.splash}>
        <div style={styles.splashIcon}>⚠</div>
        <div style={styles.splashTitle}>Reconnecting…</div>
        <div style={styles.splashSub}>{this.state.message}</div>
      </div>
    );
    return this.props.children;
  }
}

const AirlineLogo = memo(function AirlineLogo(
  { icao, flightNumber, name }: { icao: string; flightNumber: string; name: string }
) {
  const code = icao || flightNumber?.substring(0, 2).toUpperCase() || '';
  const src = useMemo(() => {
    if (!code) return '';
    if (typeof window !== 'undefined') {
      try {
        const xhr = new XMLHttpRequest();
        for (const ext of ['jpg', 'png']) {
          xhr.open('HEAD', `/airlines/${code}.${ext}`, false);
          xhr.send();
          if (xhr.status === 200) return `/airlines/${code}.${ext}`;
        }
      } catch { /* ignore */ }
    }
    return `https://www.flightaware.com/images/airline_logos/180px/${code}.png`;
  }, [code]);
  const handleError = useCallback((e: React.SyntheticEvent<HTMLImageElement>) => {
    const el = e.currentTarget.parentElement;
    if (el) el.innerHTML = `<span style="color:#6b7280;font-size:14px;font-family:var(--font-mono);letter-spacing:.15em;font-weight:600">${name || code}</span>`;
  }, [code, name]);
  return (
    <div style={styles.logoCard}>
      {code
        ? <img src={src} alt={name} style={styles.logoImg} onError={handleError} />
        : <span style={styles.logoFallback}>{name || '—'}</span>
      }
    </div>
  );
});

const parseDepartureTime = (t: string): Date | null => {
  if (!t) return null;
  try {
    if (t.includes('T')) { const d = new Date(t); if (!isNaN(d.getTime())) return d; }
    const [h, m] = t.split(':').map(Number);
    if (isNaN(h) || isNaN(m)) return null;
    const d = new Date(); d.setHours(h, m, 0, 0);
    if (Date.now() - d.getTime() > 6 * 60 * 60 * 1000) d.setDate(d.getDate() + 1);
    return d;
  } catch { return null; }
};

const formatTimeRemaining = (min: number): string => {
  if (min <= 0) return 'Now';
  if (min >= 60) { const h = Math.floor(min / 60), m = min % 60; return m ? `${h}h ${m}m` : `${h}h`; }
  return `${min}m`;
};

const flightChanged = (a: Flight | null, b: Flight | null): boolean =>
  a?.FlightNumber !== b?.FlightNumber ||
  a?.ScheduledDepartureTime !== b?.ScheduledDepartureTime ||
  a?.StatusEN !== b?.StatusEN;

interface FlightDisplayState {
  flight: Flight | null;
  checkInStatus: CheckInStatus | null;
  nextFlight: Flight | null;
  gateChangedAt: number | undefined;
  manualGateStatus: string | null;
}
const EMPTY_STATE: FlightDisplayState = {
  flight: null, checkInStatus: null, nextFlight: null,
  gateChangedAt: undefined, manualGateStatus: null,
};

function getStatusConfig(raw: string): { label: string; color: string; pulse: boolean; priority: boolean } {
  const s = (raw || '').toLowerCase().trim();
  if (s.includes('final call'))                                  return { label: raw, color: '#ef4444', pulse: true,  priority: true  };
  if (s.includes('boarding') || s.includes('gate open'))        return { label: raw, color: '#22c55e', pulse: false, priority: true  };
  if (s.includes('delay') || s.includes('kasni'))               return { label: raw, color: '#f59e0b', pulse: false, priority: false };
  if (s.includes('cancelled') || s.includes('canceled') || s.includes('otkazan')) return { label: raw, color: '#ef4444', pulse: false, priority: false };
  if (s.includes('diverted') || s.includes('preusmjeren'))      return { label: raw, color: '#f97316', pulse: false, priority: false };
  if (s.includes('departed') || s.includes('poletio'))          return { label: raw, color: '#6b7280', pulse: false, priority: false };
  return { label: raw, color: '#eab308', pulse: false, priority: false };
}

function LiveClock() {
  const [time, setTime] = useState('');
  useEffect(() => {
    const tick = () => setTime(new Date().toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false }));
    tick();
    const id = setInterval(tick, 1000);
    return () => clearInterval(id);
  }, []);
  return <span style={styles.clock}>{time}</span>;
}

function Divider() { return <div style={styles.divider} />; }

export default function GatePage() {
  return <GateErrorBoundary><GateDisplay /></GateErrorBoundary>;
}

function GateDisplay() {
  const params = useParams();
  const gateNumber = params.gateNumber as string;

  const [display, setDisplay]               = useState<FlightDisplayState>(EMPTY_STATE);
  const [loading, setLoading]               = useState(true);
  const [lastUpdate, setLastUpdate]         = useState('');
  const [nextUpdate, setNextUpdate]         = useState('');
  const [timeUntilDeparture, setTimeUntilDeparture] = useState<number | null>(null);

  const isMountedRef        = useRef(true);
  const currentFlightRef    = useRef<Flight | null>(null);
  const currentStatusRef    = useRef<CheckInStatus | null>(null);
  const prevGateRef         = useRef<string | undefined>(undefined);
  const manualGateStatusRef = useRef<string | null>(null);
  const stdSwitchTimerRef   = useRef<ReturnType<typeof setTimeout> | null>(null);

  const fetchGateStatusOverride = useCallback(async (gate: string): Promise<string | null> => {
    // Ako nema API-ja za gate status, odmah vrati null
    // Ovo sprečava greške u konzoli i čeka se samo na letove
    return null; 
  }, []);

  const shouldDisplayFlight = useCallback((f: Flight): boolean => {
    if (manualGateStatusRef.current === 'open') return true;
    const s = (f.StatusEN || '').toLowerCase().trim();
    if (s.includes('cancelled') || s.includes('canceled') || s.includes('otkazan')) return false;
    if (s.includes('diverted')  || s.includes('preusmjeren'))                        return false;
    if (s.includes('departed')  || s.includes('poletio'))                            return false;
    return true;
  }, []);

  useEffect(() => {
    const id = setTimeout(() => window.location.reload(), HARD_RESET_INTERVAL_MS);
    return () => clearTimeout(id);
  }, []);

  useEffect(() => {
    const p = (e: Event) => e.preventDefault();
    document.addEventListener('contextmenu', p);
    document.addEventListener('selectstart', p);
    document.addEventListener('dragstart', p);
    return () => {
      document.removeEventListener('contextmenu', p);
      document.removeEventListener('selectstart', p);
      document.removeEventListener('dragstart', p);
    };
  }, []);

  const updateCountdown = useCallback((f: Flight | null) => {
    if (!f) { setTimeUntilDeparture(null); return; }
    const dep = parseDepartureTime(f.ScheduledDepartureTime || '');
    if (dep) setTimeUntilDeparture(Math.floor((dep.getTime() - Date.now()) / 60_000));
  }, []);

  const getFlightCheckInStatus = useCallback(async (f: Flight): Promise<CheckInStatus | null> => {
    try { return await getEnhancedCheckInStatus(f.FlightNumber, f.ScheduledDepartureTime || '', f.StatusEN || ''); }
    catch { return null; }
  }, []);

  const loadFlights = useCallback(async () => {
    if (!isMountedRef.current) return;
    try {
      const data = await fetchFlightData();
      const now  = new Date();
   const allForGate = data.departures.filter((f: Flight) => {
    if (!f.GateNumber) return false;
    
    // Konvertujemo stringove u brojeve radi poređenja (npr. "07" -> 7, "7" -> 7)
    // Ovo rešava problem različitog formata broja gata
    const targetGateNum = parseInt(gateNumber, 10);
    
    const gates = f.GateNumber.split(',').map((g: string) => g.trim());
    
    // Proverava da li ijedan gate iz leta odgovara traženom (kao broj)
    return gates.some(g => parseInt(g, 10) === targetGateNum);
  });
      const withStatus = await Promise.all(allForGate.map(async f => ({ ...f, checkInStatus: await getFlightCheckInStatus(f) })));
      const withTime   = withStatus
        .map(f => ({ ...f, departureTime: parseDepartureTime(f.ScheduledDepartureTime || '') }))
        .filter(f => f.departureTime !== null) as (Flight & { departureTime: Date; checkInStatus: CheckInStatus | null })[];
      const sorted = withTime.sort((a, b) => a.departureTime.getTime() - b.departureTime.getTime());

      if (manualGateStatusRef.current === 'closed') {
        if (!isMountedRef.current) return;
        currentFlightRef.current = null;
        currentStatusRef.current = null;
        setDisplay({ flight: null, checkInStatus: null, nextFlight: null, gateChangedAt: undefined, manualGateStatus: 'closed' });
        setLastUpdate(new Date().toLocaleTimeString('en-GB'));
        setNextUpdate(new Date(Date.now() + REFRESH_INTERVAL_MS).toLocaleTimeString('en-GB'));
        setLoading(false);
        return;
      }

      let current: (typeof sorted)[number] | null = null;
      if (manualGateStatusRef.current === 'open') {
        current = sorted[0] || null;
      } else {
        for (const f of sorted) {
          if (!shouldDisplayFlight(f)) continue;
          if (Math.floor((now.getTime() - f.departureTime.getTime()) / 60_000) >= 0) continue;
          current = f; break;
        }
        if (!current) current = sorted.find(f => shouldDisplayFlight(f)) ?? null;
      }

      const idx        = sorted.findIndex(f => f.FlightNumber === current?.FlightNumber);
      const nextFlight = idx >= 0 && idx < sorted.length - 1 ? sorted[idx + 1] : null;

      let gateChangedAt: number | undefined;
      if (current?.GateNumber && currentFlightRef.current?.GateNumber !== current.GateNumber) {
        const prev = currentFlightRef.current?.GateNumber;
        if (prev && prev !== '-') gateChangedAt = Date.now();
      }

      if (!isMountedRef.current) return;
      if (flightChanged(current, currentFlightRef.current) || gateChangedAt) {
        currentFlightRef.current = current;
        currentStatusRef.current = current?.checkInStatus ?? null;
        prevGateRef.current      = current?.GateNumber;
        setDisplay({ flight: current, checkInStatus: current?.checkInStatus ?? null, nextFlight, gateChangedAt, manualGateStatus: null });
        updateCountdown(current);
      }
      setLastUpdate(new Date().toLocaleTimeString('en-GB'));
      setNextUpdate(new Date(Date.now() + REFRESH_INTERVAL_MS).toLocaleTimeString('en-GB'));
      setLoading(false);
    } catch (err) {
      console.error('Gate load error:', err);
      if (isMountedRef.current) setLoading(false);
    }
  }, [gateNumber, getFlightCheckInStatus, updateCountdown, shouldDisplayFlight]);

  useEffect(() => {
    isMountedRef.current = true;
    let tid: ReturnType<typeof setTimeout>;
    const schedule = () => { tid = setTimeout(async () => { if (isMountedRef.current) { await loadFlights(); schedule(); } }, REFRESH_INTERVAL_MS); };
    loadFlights().then(schedule);
    return () => { isMountedRef.current = false; clearTimeout(tid); };
  }, [loadFlights]);

  useEffect(() => {
    if (stdSwitchTimerRef.current) { clearTimeout(stdSwitchTimerRef.current); stdSwitchTimerRef.current = null; }
    if (!display.flight?.ScheduledDepartureTime) return;
    const dep = parseDepartureTime(display.flight.ScheduledDepartureTime);
    if (!dep) return;
    const ms = dep.getTime() - Date.now();
    if (ms > 0) {
      stdSwitchTimerRef.current = setTimeout(async () => {
        await new Promise(r => setTimeout(r, 1000));
        if (isMountedRef.current) loadFlights();
      }, ms);
    }
    return () => { if (stdSwitchTimerRef.current) { clearTimeout(stdSwitchTimerRef.current); stdSwitchTimerRef.current = null; } };
  }, [display.flight?.ScheduledDepartureTime, display.flight?.FlightNumber, gateNumber, loadFlights]);

  useEffect(() => {
    const poll = async () => {
      try {
        const s = await fetchGateStatusOverride(gateNumber);
        if (manualGateStatusRef.current !== s) { manualGateStatusRef.current = s; loadFlights(); }
      } catch (e) { console.error('Gate status poll error:', e); }
    };
    poll();
    const id = setInterval(poll, 30_000);
    return () => clearInterval(id);
  }, [gateNumber, fetchGateStatusOverride, loadFlights]);

  useEffect(() => {
    const id = setInterval(() => updateCountdown(currentFlightRef.current), REFRESH_INTERVAL_MS);
    return () => clearInterval(id);
  }, [updateCountdown]);

  // ── DERIVED STATE ────────────────────────────────────────────
  const { isCancelled, isDiverted } = checkFlightStatus(display.flight?.StatusEN || '');
  const isGateChanged = !!(display.gateChangedAt && (Date.now() - display.gateChangedAt < 15_000));
  const hasDel = display.flight?.EstimatedDepartureTime &&
    display.flight.EstimatedDepartureTime !== display.flight.ScheduledDepartureTime;

  // ── AUTO-BOARDING ────────────────────────────────────────────
  const effectiveStatus = (() => {
    const raw = display.flight?.StatusEN || '';
    if (!display.flight) return raw;
    if (isCancelled || isDiverted) return raw;
    const s = raw.toLowerCase();
    if (s.includes('departed') || s.includes('poletio'))   return raw;
    if (s.includes('final call'))                           return raw;
    if (s.includes('boarding') || s.includes('gate open')) return raw;
    const refTimeStr = (hasDel ? display.flight.EstimatedDepartureTime : null)
      || display.flight.ScheduledDepartureTime || '';
    const dep = parseDepartureTime(refTimeStr);
    if (!dep) return raw;
    const minUntil = Math.floor((dep.getTime() - Date.now()) / 60_000);
    if (minUntil <= 30 && minUntil > 5) return 'Boarding';
    return raw;
  })();

  const statusCfg = getStatusConfig(effectiveStatus);

  // ── RENDER: Loading ──────────────────────────────────────────
  if (loading) return (
    <div style={styles.splash}>
      <div style={styles.spinner} />
      <div style={styles.splashTitle}>Loading gate information…</div>
    </div>
  );

  // ── RENDER: No flight ────────────────────────────────────────
  if (!display.flight) {
    const closed = display.manualGateStatus === 'closed';
    return (
      <div style={styles.splash}>
        <div style={{ ...styles.gateLabel, fontSize: 'clamp(5rem,18vw,14rem)', lineHeight: 1 }}>{gateNumber}</div>
        <div style={{ fontSize: '2rem', fontWeight: 600, letterSpacing: '.08em', color: closed ? '#ef4444' : '#475569', marginTop: '1rem' }}>
          {closed ? 'GATE CLOSED' : 'NO FLIGHTS SCHEDULED'}
        </div>
        <div style={styles.metaRow}>
          <span>Updated {lastUpdate}</span><span style={{ opacity: .4 }}>•</span><span>Next {nextUpdate}</span>
        </div>
      </div>
    );
  }

  // ── RENDER: Main ─────────────────────────────────────────────
  const f = display.flight;
  return (
    <div style={styles.root}>

      {/* TOP BAR */}
      <div style={styles.topBar}>
        <div style={styles.topBarLeft}>
          <span style={styles.topBarLabel}>GATE</span>
          <span style={styles.topBarGate}>{gateNumber}</span>
          {f.Terminal && (
            <>
              <span style={styles.topBarSep}>|</span>
              <span style={styles.topBarLabel}>TERMINAL</span>
              <span style={styles.topBarTerminal}>{f.Terminal.replace('T0', 'T')}</span>
            </>
          )}
        </div>
        <LiveClock />
      </div>

      <Divider />

      {/* MAIN CONTENT */}
      <div style={styles.main}>

        {/* ── LEFT COLUMN ── */}
        <div style={styles.leftCol}>

          <AirlineLogo icao={f.AirlineICAO} flightNumber={f.FlightNumber} name={f.AirlineName} />

          <div style={styles.flightNumber}>{f.FlightNumber}</div>

          {f.CodeShareFlights?.length > 0 && (
            <div style={styles.codeshare}>
              Also operating as:&nbsp;
              <span style={styles.codeshareList}>{f.CodeShareFlights.join(' · ')}</span>
            </div>
          )}

          <Divider />

          <div style={styles.destCode}>{f.DestinationAirportCode}</div>
          <div style={styles.destCity}>{f.DestinationCityName}</div>

          {/* ── PORTABLE CHARGERS WARNING ── */}
          <div style={styles.chargerWarning}>
            <span style={styles.chargerIcon}>⚠</span>
            <span style={styles.chargerText}>
              Portable chargers: CABIN BAGGAGE ONLY! Not in overhead bins. No charging during flight.
            </span>
          </div>
          {/* ── BOARDING NOTICE ── */}
<div style={styles.boardingNotice}>
  <span style={styles.boardingIcon}>✈️</span>
  <span style={styles.boardingText}>
If you see two stairs on the aircraft: passengers in the rear half of the plane board via the rear stairs, others via the front. Thank you!  </span>
</div>

        </div>

        {/* VERTICAL DIVIDER */}
        <div style={styles.vDivider} />

        {/* ── RIGHT COLUMN ── */}
        <div style={styles.rightCol}>

  {/* Scheduled departure */}
          <div style={styles.timeBlock}>
            <div style={styles.timeLabel}>SCHEDULED DEPARTURE</div>
            {/* PROMENA: Koristi ScheduleTime (HH:MM) umesto ScheduledDepartureTime */}
            <div style={styles.timeValue}>{f.ScheduleTime}</div> 
          </div>

          {/* Estimated departure */}
      {/* Estimated departure */}
          {hasDel && (
            <div style={{ ...styles.timeBlock, marginTop: '1rem' }}>
              <div style={{ ...styles.timeLabel, color: '#f59e0b' }}>ESTIMATED DEPARTURE</div>
              
              {/* ZA ESTIMATED: Moramo formatirati "u letu" jer nemamo posebno polje u adapteru */}
              {/* Dodaj ovu pomoćnu liniju iznad rendera ili koristi male promene: */}
              <div style={{ ...styles.timeValue, color: '#f59e0b' }}>
                 {f.EstimatedDepartureTime ? new Date(f.EstimatedDepartureTime).toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' }) : ''}
              </div>
            </div>
          )}

          {/* Countdown */}
          {!isCancelled && !isDiverted && timeUntilDeparture !== null && timeUntilDeparture > 0 && (
            <div style={styles.countdown}>
              <span style={styles.countdownVal}>{formatTimeRemaining(timeUntilDeparture)}</span>
              <span style={styles.countdownLabel}>until departure</span>
            </div>
          )}

          <Divider />

          {/* Status badge */}
          <div style={styles.statusBlock}>
            {isCancelled ? (
              <div style={{ ...styles.statusBadge, background: '#7f1d1d', color: '#fca5a5' }}>CANCELLED</div>
            ) : isDiverted ? (
              <div style={{ ...styles.statusBadge, background: '#7c2d12', color: '#fdba74' }}>DIVERTED</div>
            ) : (
              <div style={{
                ...styles.statusBadge,
                background: statusCfg.priority ? `${statusCfg.color}22` : '#1e293b',
                color: statusCfg.color,
                border: `1.5px solid ${statusCfg.color}44`,
                animation: statusCfg.pulse ? 'fidsPulse 1.2s ease-in-out infinite' : 'none',
              }}>
                {effectiveStatus.toUpperCase()}
              </div>
            )}
          </div>

          {/* Gate changed */}
          {isGateChanged && (
            <div style={styles.gateChangedBanner}>⚠ GATE CHANGED TO {f.GateNumber}</div>
          )}

          {/* Check-in closing */}
          {display.checkInStatus?.checkInCloseTime && timeUntilDeparture !== null && timeUntilDeparture <= 30 && timeUntilDeparture > 0 && (
            <div style={styles.checkInBanner}>
              FLIGHT CLOSES IN {formatTimeRemaining(Math.max(0, timeUntilDeparture - 5))}
            </div>
          )}

          {/* ── DANGEROUS GOODS IMAGE ── */}
          <div style={styles.dangerousGoodsWrapper}>
            <img
              src="/dgr-gate.png"
              alt="Dangerous Goods — Not Allowed"
              style={styles.dangerousGoodsImg}
              onError={(e) => { e.currentTarget.style.display = 'none'; }}
            />
          </div>

        </div>
      </div>

      <Divider />

      {/* FOOTER */}
      <div style={styles.footer}>
        <div style={styles.footerMeta}>
          <span>LAST UPDATE&nbsp;&nbsp;{lastUpdate}</span>
          <span style={{ opacity: .35 }}>│</span>
          <span>NEXT UPDATE&nbsp;&nbsp;{nextUpdate}</span>
        </div>
        {display.nextFlight && (
          <div style={styles.nextFlight}>
            <span style={styles.nextLabel}>NEXT FLIGHT</span>
            <span style={styles.nextFN}>{display.nextFlight.FlightNumber}</span>
            <span style={styles.nextDest}>{display.nextFlight.DestinationAirportCode} — {display.nextFlight.DestinationCityName}</span>
            
            {/* --- PROMENA: Formatiranje vremena za Next Flight --- */}
            <span style={styles.nextTime}>
              {display.nextFlight.ScheduledDepartureTime 
                ? new Date(display.nextFlight.ScheduledDepartureTime).toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' }) 
                : ''}
            </span>
            
          </div>
        )}
      </div>

      <style>{`
        @import url('https://fonts.googleapis.com/css2?family=Share+Tech+Mono&family=Rajdhani:wght@500;600;700&display=swap');
        * { box-sizing: border-box; margin: 0; padding: 0; }
        @keyframes fidsPulse { 0%,100%{opacity:1} 50%{opacity:.55} }
        @keyframes spin { to { transform: rotate(360deg); } }
        html,body,#__next { width:100vw; height:100vh; overflow:hidden; background:#070d1a; }
      `}</style>
    </div>
  );
}

// ── STYLES ───────────────────────────────────────────────────
const FONT_DISPLAY = `'Rajdhani', 'Share Tech Mono', monospace`;
const FONT_MONO    = `'Share Tech Mono', 'Courier New', monospace`;
const C = {
  bg: '#070d1a', panel: '#0d1629', border: '#1e3a5f',
  accent: '#1e90ff', gold: '#e6a817', text: '#cfe4ff',
  textMuted: '#4a6fa5', white: '#f0f8ff',
};

const styles: Record<string, React.CSSProperties> = {
  root: { width: '100vw', height: '100vh', display: 'flex', flexDirection: 'column', background: C.bg, fontFamily: FONT_DISPLAY, color: C.white, padding: '0', overflow: 'hidden' },
  topBar: { display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '0.9rem 2.5rem', background: C.panel, borderBottom: `1px solid ${C.border}`, flexShrink: 0 },
  topBarLeft: { display: 'flex', alignItems: 'baseline', gap: '0.7rem' },
  topBarLabel: { fontSize: '0.95rem', fontWeight: 600, letterSpacing: '.18em', color: C.textMuted, fontFamily: FONT_MONO },
  topBarGate: { fontSize: '3.2rem', fontWeight: 700, lineHeight: 1, color: C.gold, letterSpacing: '.04em' },
  topBarTerminal: { fontSize: '2rem', fontWeight: 600, color: C.text, letterSpacing: '.06em' },
  topBarSep: { color: C.border, fontSize: '1.8rem', margin: '0 0.4rem' },
  clock: { fontFamily: FONT_MONO, fontSize: '2.2rem', fontWeight: 400, color: C.accent, letterSpacing: '.08em' },
  divider: { height: '1px', background: `linear-gradient(90deg, transparent 0%, ${C.border} 20%, ${C.border} 80%, transparent 100%)`, flexShrink: 0 },
  main: { display: 'flex', flex: 1, overflow: 'visible', padding: '1.5rem 2.5rem', gap: '0', minHeight: 0 },
  leftCol: { display: 'flex', flexDirection: 'column', justifyContent: 'space-evenly', flex: '0 0 52%', gap: '.8rem', paddingRight: '2.5rem', overflow: 'visible' },
  logoCard: { width: '100%', height: 'clamp(120px, 14vh, 200px)', background: '#ffffff', borderRadius: '12px', display: 'flex', alignItems: 'center', justifyContent: 'center', overflow: 'hidden', boxShadow: `0 0 0 1px ${C.border}, 0 4px 40px rgba(30,144,255,0.12)`, flexShrink: 0 },
  logoImg: { width: '100%', height: '100%', objectFit: 'contain', padding: '10px 20px' },
  logoFallback: { color: '#6b7280', fontSize: '14px', fontFamily: FONT_MONO, fontWeight: 600, letterSpacing: '.12em' },
  flightNumber: { fontSize: 'clamp(4.5rem, 9vw, 8rem)', fontWeight: 700, letterSpacing: '.05em', color: C.white, lineHeight: 1 },
  codeshare: { fontSize: '1rem', color: C.textMuted, letterSpacing: '.08em', fontFamily: FONT_MONO },
  codeshareList: { color: C.text, fontWeight: 600 },
  destCode: { fontSize: 'clamp(2.8rem, 5.5vw, 5rem)', fontWeight: 700, letterSpacing: '.12em', color: C.accent, lineHeight: 1 },
  destCity: { fontSize: 'clamp(4.5rem, 9vw, 9rem)', fontWeight: 700, color: C.white, letterSpacing: '.03em', lineHeight: 1, wordBreak: 'break-word' as const, overflowWrap: 'break-word' as const },

  // ── PORTABLE CHARGERS WARNING ────────────────────────────────
  chargerWarning: { display: 'flex', alignItems: 'flex-start', gap: '.7rem', background: 'rgba(234,179,8,0.12)', border: '1px solid rgba(234,179,8,0.35)', borderRadius: '10px', padding: '.7rem 1rem' },
  chargerIcon: { fontSize: '1.3rem', color: '#eab308', flexShrink: 0, lineHeight: '1.3' as unknown as number },
  chargerText: { fontSize: 'clamp(0.85rem, 1.4vw, 1.25rem)', fontWeight: 600, color: '#fde047', letterSpacing: '.04em', lineHeight: '1.4' as unknown as number, fontFamily: FONT_DISPLAY },

  vDivider: { width: '1px', alignSelf: 'stretch', flexShrink: 0, background: `linear-gradient(180deg, transparent 0%, ${C.border} 15%, ${C.border} 85%, transparent 100%)`, margin: '0 2.5rem' },
  rightCol: { flex: 1, display: 'flex', flexDirection: 'column', justifyContent: 'space-between', gap: '1rem' },
  timeBlock: { display: 'flex', flexDirection: 'column', gap: '.3rem' },
  timeLabel: { fontSize: '0.85rem', fontWeight: 600, letterSpacing: '.18em', color: C.textMuted, fontFamily: FONT_MONO },
  timeValue: { fontFamily: FONT_MONO, fontSize: 'clamp(3.5rem, 7vw, 6.5rem)', fontWeight: 400, letterSpacing: '.1em', color: C.white, lineHeight: 1 },
  countdown: { display: 'flex', alignItems: 'baseline', gap: '.7rem' },
  countdownVal: { fontFamily: FONT_MONO, fontSize: 'clamp(1.6rem, 3vw, 2.8rem)', color: C.gold, fontWeight: 400 },
  countdownLabel: { fontSize: '0.85rem', color: C.textMuted, letterSpacing: '.12em', fontFamily: FONT_MONO },
  statusBlock: { display: 'flex', alignItems: 'flex-start' },
  statusBadge: { display: 'inline-block', fontSize: 'clamp(1.6rem, 3vw, 2.8rem)', fontWeight: 700, letterSpacing: '.12em', padding: '.45em 1.2em', borderRadius: '8px', fontFamily: FONT_DISPLAY },
  gateChangedBanner: { background: '#431407', border: '1px solid #ea580c', borderRadius: '8px', padding: '.6rem 1.2rem', color: '#fed7aa', fontSize: '1.1rem', fontWeight: 700, letterSpacing: '.12em', fontFamily: FONT_MONO },
  checkInBanner: { background: '#3b0764', border: '1px solid #a855f7', borderRadius: '8px', padding: '.5rem 1.2rem', color: '#e9d5ff', fontSize: '1rem', fontWeight: 600, letterSpacing: '.1em', fontFamily: FONT_MONO },

  // ── DANGEROUS GOODS IMAGE ────────────────────────────────────
  dangerousGoodsWrapper: { flex: 1, display: 'flex', alignItems: 'flex-end', justifyContent: 'flex-end', paddingTop: '0.5rem', minHeight: 0 },
  dangerousGoodsImg: { maxWidth: '100%', maxHeight: '100%', width: 'auto', height: 'auto', objectFit: 'contain', borderRadius: '8px' },

  footer: { display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '1rem 2.5rem', background: C.panel, borderTop: `1px solid ${C.border}`, flexShrink: 0, gap: '2rem' },
  footerMeta: { display: 'flex', gap: '1.2rem', alignItems: 'center', color: C.textMuted, fontSize: '.8rem', letterSpacing: '.12em', fontFamily: FONT_MONO, flexShrink: 0 },
  nextFlight: { display: 'flex', alignItems: 'center', gap: '1.8rem', overflow: 'hidden' },
  nextLabel: { fontSize: '1rem', fontWeight: 600, color: C.textMuted, letterSpacing: '.16em', fontFamily: FONT_MONO, flexShrink: 0 },
  nextFN: { fontSize: '2.5rem', fontWeight: 700, color: C.text, letterSpacing: '.08em', flexShrink: 0 },
  nextDest: { fontSize: '2.3rem', fontWeight: 600, color: C.textMuted, letterSpacing: '.04em', overflow: 'hidden', whiteSpace: 'nowrap' as const, textOverflow: 'ellipsis' },
  nextTime: { fontFamily: FONT_MONO, fontSize: '2.3rem', color: C.gold, letterSpacing: '.08em', flexShrink: 0 },
  splash: { width: '100vw', height: '100vh', background: C.bg, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', fontFamily: FONT_DISPLAY, gap: '1rem' },
  splashIcon: { fontSize: '4rem', color: C.gold, opacity: .6 },
  splashTitle: { fontSize: '2.2rem', color: C.text, fontWeight: 600, letterSpacing: '.1em' },
  splashSub: { fontSize: '1rem', color: C.textMuted, letterSpacing: '.08em', fontFamily: FONT_MONO },
  gateLabel: { fontWeight: 800, color: C.gold, letterSpacing: '.06em', fontFamily: FONT_DISPLAY },
  spinner: { width: 56, height: 56, border: `3px solid ${C.border}`, borderTop: `3px solid ${C.accent}`, borderRadius: '50%', animation: 'spin 1s linear infinite' },
  metaRow: { display: 'flex', gap: '1rem', alignItems: 'center', marginTop: '1.2rem', color: C.textMuted, fontSize: '.9rem', letterSpacing: '.1em', fontFamily: FONT_MONO },
};