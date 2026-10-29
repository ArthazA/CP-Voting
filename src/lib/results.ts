import "server-only";
import { getSupabaseAdmin } from "@/lib/supabase-admin";

// Every contestant with their vote count and average, in planned order.
export async function loadResults() {
  const supabase = getSupabaseAdmin();
  const [{ data: entries, error: entriesError }, { data: votes, error: votesError }] = await Promise.all([
    supabase.from("costume_entries").select("id, contestant_name, display_name, category, is_group, planned_order").order("planned_order"),
    supabase.from("costume_votes").select("entry_id, score"),
  ]);
  if (entriesError || votesError) throw entriesError ?? votesError;
  return (entries ?? []).map((entry) => {
    const entryVotes = (votes ?? []).filter((vote) => vote.entry_id === entry.id);
    const total = entryVotes.reduce((sum, vote) => sum + vote.score, 0);
    return { id: entry.id, contestantName: entry.contestant_name, costumeName: entry.display_name, category: entry.category, isGroup: entry.is_group, votes: entryVotes.length, average: entryVotes.length ? Number((total / entryVotes.length).toFixed(2)) : null };
  });
}
