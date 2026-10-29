import { NextRequest } from "next/server";
import { isOrganizer } from "@/lib/organizer-auth";
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
      supabase.from("costume_entries").select("id, contestant_name, display_name, category, is_group, planned_order").order("planned_order"),
      supabase.from("event_control").select("*").eq("id", 1).single(),
    ]);
    if (entriesError || controlError) throw entriesError ?? controlError;

    let voteCount = 0;
    let average = 0;
    let myScore: number | null = null;
    const voterKey = request.nextUrl.searchParams.get("voterKey");
    if (control.current_entry_id) {
      const { data: votes, error } = await supabase
        .from("costume_votes")
        .select("score, voter_key")
        .eq("entry_id", control.current_entry_id);
      if (error) throw error;
      voteCount = votes.length;
      average = voteCount ? votes.reduce((total, vote) => total + vote.score, 0) / voteCount : 0;
      myScore = voterKey ? votes.find((vote) => vote.voter_key === voterKey)?.score ?? null : null;
    }

    let status = control.status;
    let remainingMs = control.paused_remaining_ms ?? 0;
    if (control.status === "voting" && control.ends_at) {
      remainingMs = Math.max(0, Date.parse(control.ends_at) - Date.now());
      if (remainingMs <= 0) status = "waiting";
    }
    // Guests never see the average; only a signed-in host gets it.
    const organizer = await isOrganizer().catch(() => false);
    return json({
      configured: true,
      entries: (entries ?? []).map((entry) => ({ id: entry.id, contestantName: entry.contestant_name, costumeName: entry.display_name, category: entry.category, isGroup: entry.is_group })),
      control: { ...control, status, remaining_ms: remainingMs },
      voteCount,
      average: organizer && voteCount ? Number(average.toFixed(2)) : null,
      myScore,
      hasVoted: myScore !== null,
    });
  } catch (error) {
    console.error("Could not load the event state", error);
    return json({ error: "Could not load event state." }, 500);
  }
}
