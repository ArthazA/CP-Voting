import { isOrganizer } from "@/lib/organizer-auth";
import { getSupabaseAdmin, isSupabaseConfigured } from "@/lib/supabase-admin";

export const dynamic = "force-dynamic";

export async function GET() {
  if (!(await isOrganizer())) return Response.json({ error: "Organizer sign-in required." }, { status: 401 });
  if (!isSupabaseConfigured()) return Response.json({ error: "Supabase is not configured yet." }, { status: 503 });
  try {
    const supabase = getSupabaseAdmin();
    const [{ data: entries, error: entriesError }, { data: votes, error: votesError }] = await Promise.all([
      supabase.from("costume_entries").select("id, contestant_name, display_name, category, sort_order").order("sort_order"),
      supabase.from("costume_votes").select("entry_id, score"),
    ]);
    if (entriesError || votesError) throw entriesError ?? votesError;
    const results = (entries ?? []).map((entry) => {
      const entryVotes = (votes ?? []).filter((vote) => vote.entry_id === entry.id);
      const total = entryVotes.reduce((sum, vote) => sum + vote.score, 0);
      return { id: entry.id, contestantName: entry.contestant_name, costumeName: entry.display_name, category: entry.category, votes: entryVotes.length, average: entryVotes.length ? Number((total / entryVotes.length).toFixed(2)) : null };
    });
    return Response.json({ results }, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    console.error("Could not load the private results", error);
    return Response.json({ error: "Could not load results." }, { status: 500 });
  }
}
