import { getSupabaseAdmin, isSupabaseConfigured } from "@/lib/supabase-admin";

export const dynamic = "force-dynamic";

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export async function POST(request: Request) {
  if (!isSupabaseConfigured()) return Response.json({ error: "Voting is not configured yet." }, { status: 503 });
  try {
    const body = await request.json();
    const { entryId, sessionId, voterKey, score } = body as Record<string, unknown>;
    if (typeof entryId !== "string" || !UUID_PATTERN.test(entryId) ||
        typeof sessionId !== "string" || !UUID_PATTERN.test(sessionId) ||
        typeof voterKey !== "string" || !UUID_PATTERN.test(voterKey) ||
        !Number.isInteger(score) || Number(score) < 1 || Number(score) > 5) {
      return Response.json({ error: "Choose one score from 1 to 5." }, { status: 400 });
    }

    const supabase = getSupabaseAdmin();
    const { data: control, error: controlError } = await supabase
      .from("event_control")
      .select("status, current_entry_id, session_id, ends_at")
      .eq("id", 1)
      .single();
    if (controlError) throw controlError;
    if (control.status !== "voting" || control.current_entry_id !== entryId || control.session_id !== sessionId ||
        !control.ends_at || Date.parse(control.ends_at) <= Date.now()) {
      return Response.json({ error: "This voting session has ended." }, { status: 409 });
    }

    // One row per guest per costume; tapping another pumpkin replaces the score until the timer ends.
    const { error: upsertError } = await supabase.from("costume_votes").upsert(
      { entry_id: entryId, voter_key: voterKey, score: Number(score), updated_at: new Date().toISOString() },
      { onConflict: "entry_id,voter_key" },
    );
    if (upsertError) throw upsertError;

    const { count, error: countError } = await supabase
      .from("costume_votes")
      .select("id", { count: "exact", head: true })
      .eq("entry_id", entryId);
    if (countError) throw countError;
    return Response.json({ accepted: true, score: Number(score), voteCount: count ?? 0 });
  } catch (error) {
    console.error("Could not save the vote", error);
    return Response.json({ error: "Could not save your vote. Please try once more." }, { status: 500 });
  }
}
