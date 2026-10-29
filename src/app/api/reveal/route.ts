import { loadResults } from "@/lib/results";
import { getSupabaseAdmin, isSupabaseConfigured } from "@/lib/supabase-admin";

export const dynamic = "force-dynamic";

// Public results, but only once the host has switched the winner reveal on for everyone.
export async function GET() {
  if (!isSupabaseConfigured()) return Response.json({ error: "Supabase is not configured yet." }, { status: 503 });
  try {
    const { data: control, error } = await getSupabaseAdmin().from("event_control").select("*").eq("id", 1).single();
    if (error) throw error;
    if (!control.reveal_active) return Response.json({ error: "The winners haven't been revealed yet." }, { status: 403 });
    return Response.json({ results: await loadResults() }, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    console.error("Could not load the reveal results", error);
    return Response.json({ error: "Could not load results." }, { status: 500 });
  }
}
