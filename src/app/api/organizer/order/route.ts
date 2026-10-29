import { isOrganizer } from "@/lib/organizer-auth";
import { getSupabaseAdmin, isSupabaseConfigured } from "@/lib/supabase-admin";

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export async function POST(request: Request) {
  if (!(await isOrganizer())) return Response.json({ error: "Organizer sign-in required." }, { status: 401 });
  if (!isSupabaseConfigured()) return Response.json({ error: "Supabase is not configured yet." }, { status: 503 });

  try {
    const body = await request.json();
    const entryIds = body.entryIds;
    if (!Array.isArray(entryIds) || !entryIds.every((entryId) => typeof entryId === "string" && UUID_PATTERN.test(entryId))) {
      return Response.json({ error: "Send the complete planned order." }, { status: 400 });
    }

    const { error } = await getSupabaseAdmin().rpc("reorder_costume_entries", { p_entry_ids: entryIds });
    if (error) throw error;
    return Response.json({ saved: true });
  } catch (error) {
    console.error("Could not save the planned order", error);
    return Response.json({ error: "Could not save the planned order." }, { status: 500 });
  }
}
