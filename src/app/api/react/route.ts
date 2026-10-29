import { REACTIONS_TOPIC, isReactionKind, type ReactionCounts } from "@/lib/event-config";
import { getSupabaseAdmin, isSupabaseConfigured } from "@/lib/supabase-admin";

export const dynamic = "force-dynamic";

const FLUSH_MS = 500;
const MAX_PER_KIND_PER_REQUEST = 30;

// Every guest's taps are merged here and forwarded to the big screen at most twice a second,
// so Supabase sees ~2 messages/second however many people are spamming.
let pending: ReactionCounts = {};
let lastFlush = 0;
let flushTimer: ReturnType<typeof setTimeout> | null = null;
let channel: ReturnType<ReturnType<typeof getSupabaseAdmin>["channel"]> | null = null;

async function flush() {
  if (flushTimer) { clearTimeout(flushTimer); flushTimer = null; }
  const counts = pending;
  pending = {};
  lastFlush = Date.now();
  if (!Object.keys(counts).length) return;
  channel ??= getSupabaseAdmin().channel(REACTIONS_TOPIC, { config: { private: false } });
  await channel.httpSend("reactions", { counts }).catch((error) => console.error("Could not forward reactions", error));
}

export async function POST(request: Request) {
  if (!isSupabaseConfigured()) return Response.json({ accepted: false }, { status: 503 });
  const body = await request.json().catch(() => null);
  const counts = body && typeof body.counts === "object" && body.counts ? body.counts as Record<string, unknown> : {};
  let added = 0;
  for (const [kind, value] of Object.entries(counts)) {
    const amount = Math.min(MAX_PER_KIND_PER_REQUEST, Math.max(0, Math.floor(Number(value) || 0)));
    if (!isReactionKind(kind) || !amount) continue;
    pending[kind] = (pending[kind] ?? 0) + amount;
    added += amount;
  }
  if (!added) return Response.json({ accepted: false }, { status: 400 });

  const wait = FLUSH_MS - (Date.now() - lastFlush);
  if (wait <= 0) await flush();
  else flushTimer ??= setTimeout(() => { void flush(); }, wait);
  return Response.json({ accepted: true }, { status: 202 });
}
