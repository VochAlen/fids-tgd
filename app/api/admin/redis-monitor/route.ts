// app/api/admin/redis-health/route.ts
//
// Redis health check i memory guard.
// Poziva se:
//   GET /api/admin/redis-health          → prikaz stanja
//   POST /api/admin/redis-health         → čišćenje + fix TTL-ova
//
// Možeš pozvati ručno iz admin panela ili jednom dnevno via cron.
// Na Vercelu: dodaj u vercel.json cron koji poziva POST svakih 6h.

import { NextResponse } from 'next/server';
import { getRedisClient } from '@/lib/redis';

// ── TTL pravila po prefiksu ključa (u sekundama) ─────────────
const TTL_RULES: Record<string, number> = {
  'cache:flights':  180,    // 3 minute  — letovi se često mjenjaju
  'override:':      21_600, // 6 sati    — admin override-i
  'gate-status:':   21_600, // 6 sati
  'desk-status:':   21_600, // 6 sati
  'desk-class:':    21_600, // 6 sati
};

// Maksimalna veličina za upozorenje (u bajtovima) — 5MB od 10MB limita
const WARN_THRESHOLD_BYTES = 5 * 1024 * 1024;

function getTtlForKey(key: string): number {
  for (const [prefix, ttl] of Object.entries(TTL_RULES)) {
    if (key.startsWith(prefix)) return ttl;
  }
  // Nepoznati ključ — daj mu 1 sat da se sam obriše
  return 3_600;
}

// ── GET: Prikaz stanja ────────────────────────────────────────
export async function GET() {
  try {
    const client = getRedisClient();

    // Dohvati sve ključeve
    const keys = await client.keys('*');

    // Provjeri TTL za svaki ključ
    const keyDetails = await Promise.all(
      keys.map(async (key) => {
        const ttl  = await client.ttl(key);
        const type = await client.type(key);
        return { key, ttl, type, noTtl: ttl === -1 };
      })
    );

    const noTtlKeys  = keyDetails.filter(k => k.noTtl).map(k => k.key);
    const totalKeys  = keys.length;

    // Procjena memorije (gruba — Redis nema MEMORY USAGE na svim free tier-ima)
    let memoryInfo: Record<string, string> = {};
    try {
      const info = await client.info('memory');
      const usedMatch   = info.match(/used_memory:(\d+)/);
      const humanMatch  = info.match(/used_memory_human:([^\r\n]+)/);
      const peakMatch   = info.match(/used_memory_peak_human:([^\r\n]+)/);
      memoryInfo = {
        used:      usedMatch?.[1]  || 'N/A',
        usedHuman: humanMatch?.[1]?.trim() || 'N/A',
        peakHuman: peakMatch?.[1]?.trim()  || 'N/A',
      };
    } catch {
      memoryInfo = { used: 'N/A', usedHuman: 'N/A', peakHuman: 'N/A' };
    }

    const usedBytes     = parseInt(memoryInfo.used) || 0;
    const isWarning     = usedBytes > WARN_THRESHOLD_BYTES;
    const usedPercent   = usedBytes > 0
      ? ((usedBytes / (10 * 1024 * 1024)) * 100).toFixed(1)
      : '0';

    return NextResponse.json({
      status:        isWarning ? 'warning' : 'ok',
      memory: {
        used:        memoryInfo.usedHuman,
        peak:        memoryInfo.peakHuman,
        limitMb:     10,
        usedPercent: `${usedPercent}%`,
        isWarning,
      },
      keys: {
        total:       totalKeys,
        withoutTtl:  noTtlKeys.length,
        noTtlList:   noTtlKeys,
        details:     keyDetails.map(k => ({
          key:  k.key,
          type: k.type,
          ttl:  k.ttl === -1 ? 'NO TTL ⚠️' : k.ttl === -2 ? 'EXPIRED' : `${k.ttl}s`,
        })),
      },
      recommendation: noTtlKeys.length > 0
        ? `Pozovi POST /api/admin/redis-health da popraviš ${noTtlKeys.length} ključeva bez TTL-a`
        : 'Sve je u redu — svi ključevi imaju TTL',
    });
  } catch (error: unknown) {
    const msg = error instanceof Error ? error.message : String(error);
    return NextResponse.json({ status: 'error', error: msg }, { status: 503 });
  }
}

// ── POST: Čišćenje i fix TTL-ova ─────────────────────────────
export async function POST() {
  try {
    const client = getRedisClient();
    const keys   = await client.keys('*');

    let fixedTtl    = 0;
    let deletedOld  = 0;
    const skipped: string[] = [];

    for (const key of keys) {
      const ttl = await client.ttl(key);

      // Ključ nema TTL → postavi odgovarajući
      if (ttl === -1) {
        const newTtl = getTtlForKey(key);
        await client.expire(key, newTtl);
        fixedTtl++;
        console.log(`[redis-health] TTL postavljen: ${key} → ${newTtl}s`);
        continue;
      }

      // Ključ je već istekao (ne bi trebalo biti, ali just in case)
      if (ttl === -2) {
        skipped.push(key);
        continue;
      }

      // Ključ ima TTL — sve je ok
    }

    // Provjeri memoriju nakon čišćenja
    let memoryAfter = 'N/A';
    try {
      const info       = await client.info('memory');
      const humanMatch = info.match(/used_memory_human:([^\r\n]+)/);
      memoryAfter      = humanMatch?.[1]?.trim() || 'N/A';
    } catch { /* ignoriši */ }

    return NextResponse.json({
      success: true,
      actions: {
        fixedTtl,
        deletedOld,
        skipped: skipped.length,
      },
      memoryAfter,
      message: fixedTtl > 0
        ? `Popravljeno ${fixedTtl} ključeva bez TTL-a`
        : 'Svi ključevi su imali ispravan TTL — ništa nije promijenjeno',
    });
  } catch (error: unknown) {
    const msg = error instanceof Error ? error.message : String(error);
    console.error('[redis-health] POST error:', msg);
    return NextResponse.json({ success: false, error: msg }, { status: 503 });
  }
}