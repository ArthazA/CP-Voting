import { randomUUID } from "node:crypto";
import { ROUND_SECONDS } from "@/lib/event-config";
import { isOrganizer } from "@/lib/organizer-auth";
import { getSupabaseAdmin, isSupabaseConfigured } from "@/lib/supabase-admin";

export async function POST(request: Request) {
  if (!(await isOrganizer())) return Response.json({ error: "Organizer sign-in required." }, { status: 401 });
  if (!isSupabaseConfigured()) return Response.json({ error: "Supabase is not configured yet." }, { status: 503 });
  try {
    const body = await request.json();
    const { action, entryId } = body;
    const supabase = getSupabaseAdmin();
    const { data: current, error: currentError } = await supabase.from("event_control").select("*").eq("id", 1).single();
    if (currentError) throw currentError;
    const now = Date.now();
    let update: Record<string, unknown>;

    if (action === "start") {
      if (typeof entryId !== "string") return Response.json({ error: "Choose a contestant first." }, { status: 400 });
      const { data: entry, error: entryError } = await supabase.from("costume_entries").select("id").eq("id", entryId).maybeSingle();
      if (entryError) throw entryError;
      if (!entry) return Response.json({ error: "That contestant is no longer on the lineup." }, { status: 404 });
      update = { status: "voting", current_entry_id: entryId, session_id: randomUUID(), started_at: new Date(now).toISOString(), ends_at: new Date(now + ROUND_SECONDS * 1000).toISOString(), paused_remaining_ms: null };
    } else if (action === "pause" && current.status === "voting" && current.ends_at) {
      update = { status: "paused", paused_remaining_ms: Math.max(0, Date.parse(current.ends_at) - now), ends_at: null };
    } else if (action === "resume" && current.status === "paused") {
      const remaining = Math.max(0, Number(current.paused_remaining_ms ?? 0));
      update = remaining > 0
        ? { status: "voting", started_at: new Date(now).toISOString(), ends_at: new Date(now + remaining).toISOString(), paused_remaining_ms: null }
        : { status: "waiting", last_entry_id: current.current_entry_id, current_entry_id: null, session_id: null, started_at: null, ends_at: null, paused_remaining_ms: null };
    } else if (action === "reveal_show") {
      update = { reveal_active: true, reveal_round: 0, reveal_step: 0 };
    } else if (action === "reveal_hide") {
      update = { reveal_active: false };
    } else if (action === "reveal_step") {
      const { round, step } = body as { round?: unknown; step?: unknown };
      if (!Number.isInteger(round) || !Number.isInteger(step) || Number(round) < 0 || Number(round) > 20 || Number(step) < 0 || Number(step) > 10) {
        return Response.json({ error: "Invalid reveal position." }, { status: 400 });
      }
      // Rehearsing on /reveal while the reveal is hidden doesn't touch the guests.
      if (!current.reveal_active) return Response.json({ control: current });
      update = { reveal_round: round, reveal_step: step };
    } else if (action === "stop") {
      update = { status: "waiting", last_entry_id: current.current_entry_id ?? current.last_entry_id, current_entry_id: null, session_id: null, started_at: null, ends_at: null, paused_remaining_ms: null };
    } else {
      return Response.json({ error: "That action isn’t available in the current session." }, { status: 409 });
    }

    const { data, error } = await supabase.from("event_control").update({ ...update, updated_at: new Date().toISOString() }).eq("id", 1).select().single();
    if (error) throw error;
    return Response.json({ control: data });
  } catch (error) {
    console.error("Could not update the voting session", error);
    return Response.json({ error: "Could not update the voting session." }, { status: 500 });
  }
}
