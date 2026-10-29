import { NextRequest } from "next/server";
import { getSupabaseAdmin, isSupabaseConfigured } from "@/lib/supabase-admin";

export const dynamic = "force-dynamic";

function json(data: unknown, status = 200) {
  return Response.json(data, { status, headers: { "Cache-Control": "no-store" } });
}

export async function GET(request: NextRequest) {
  if (!isSupabaseConfigured()) return json({ configured: false });
  try {
    const supabase = getSupabaseAdmin();
    const [{ data: entries, error: entriesError }, { data: control, error: controlError }] = await Promise.all([
      supabase.from("costume_entries").select("id, contestant_name, display_name, category, sort_order, created_at").order("sort_order").order("created_at"),
      supabase.from("event_control").select("event_name, status, current_entry_id, session_id, started_at, ends_at, paused_remaining_ms, updated_at").eq("id", 1).single(),
    ]);
    if (entriesError || controlError) throw entriesError ?? controlError;

    let voteCount = 0;
    let average = 0;
    let hasVoted = false;
    const voterKey = request.nextUrl.searchParams.get("voterKey");
    if (control.current_entry_id) {
      const { data: votes, error } = await supabase
        .from("costume_votes")
        .select("score, voter_key")
        .eq("entry_id", control.current_entry_id);
      if (error) throw error;
      voteCount = votes.length;
      average = voteCount ? votes.reduce((total, vote) => total + vote.score, 0) / voteCount : 0;
      hasVoted = Boolean(voterKey && votes.some((vote) => vote.voter_key === voterKey));
    }

    let status = control.status;
    let remainingMs = control.paused_remaining_ms ?? 0;
    if (control.status === "voting" && control.ends_at) {
      remainingMs = Math.max(0, Date.parse(control.ends_at) - Date.now());
      if (remainingMs <= 0) status = "waiting";
    }
    const showLiveAverage = status === "voting" && remainingMs > 5_000;
    return json({
      configured: true,
      entries: (entries ?? []).map((entry) => ({ id: entry.id, contestantName: entry.contestant_name, costumeName: entry.display_name, category: entry.category })),
      control: { ...control, status, remaining_ms: remainingMs },
      voteCount,
      average: showLiveAverage ? Number(average.toFixed(2)) : null,
      hasVoted,
    });
  } catch (error) {
    console.error("Could not load the event state", error);
    return json({ error: "Could not load event state." }, 500);
  }
}
