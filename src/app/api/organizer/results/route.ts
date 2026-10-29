import { isOrganizer } from "@/lib/organizer-auth";
import { loadResults } from "@/lib/results";
import { isSupabaseConfigured } from "@/lib/supabase-admin";

export const dynamic = "force-dynamic";

export async function GET() {
  if (!(await isOrganizer())) return Response.json({ error: "Organizer sign-in required." }, { status: 401 });
  if (!isSupabaseConfigured()) return Response.json({ error: "Supabase is not configured yet." }, { status: 503 });
  try {
    return Response.json({ results: await loadResults() }, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    console.error("Could not load the private results", error);
    return Response.json({ error: "Could not load results." }, { status: 500 });
  }
}
