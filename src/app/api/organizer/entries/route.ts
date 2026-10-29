import { isOrganizer } from "@/lib/organizer-auth";
import { getSupabaseAdmin, isSupabaseConfigured } from "@/lib/supabase-admin";

const categories = ["Scariest", "Prettiest", "Funniest"] as const;
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export async function POST(request: Request) {
  if (!(await isOrganizer())) return Response.json({ error: "Organizer sign-in required." }, { status: 401 });
  if (!isSupabaseConfigured()) return Response.json({ error: "Supabase is not configured yet." }, { status: 503 });
  try {
    const body = await request.json();
    const contestantName = typeof body.contestantName === "string" ? body.contestantName.trim().slice(0, 60) : "";
    const costumeName = typeof body.costumeName === "string" ? body.costumeName.trim().slice(0, 60) : "";
    const category = body.category;
    if (!contestantName || !costumeName || !categories.includes(category)) return Response.json({ error: "Enter a contestant name, costume name, and category." }, { status: 400 });
    const supabase = getSupabaseAdmin();
    const [{ count: categoryCount, error: categoryCountError }, { data: lastPlannedEntry, error: plannedOrderError }] = await Promise.all([
      supabase.from("costume_entries").select("id", { count: "exact", head: true }).eq("category", category),
      supabase.from("costume_entries").select("planned_order").order("planned_order", { ascending: false }).limit(1).maybeSingle(),
    ]);
    if (categoryCountError || plannedOrderError) throw categoryCountError ?? plannedOrderError;
    const { data, error } = await supabase.from("costume_entries").insert({ contestant_name: contestantName, display_name: costumeName, category, sort_order: categoryCount ?? 0, planned_order: (lastPlannedEntry?.planned_order ?? -1) + 1 }).select("id, contestant_name, display_name, category").single();
    if (error) throw error;
    return Response.json({ entry: { id: data.id, contestantName: data.contestant_name, costumeName: data.display_name, category: data.category } }, { status: 201 });
  } catch (error) {
    console.error("Could not add contestant", error);
    return Response.json({ error: "Could not add the contestant." }, { status: 500 });
  }
}

export async function DELETE(request: Request) {
  if (!(await isOrganizer())) return Response.json({ error: "Organizer sign-in required." }, { status: 401 });
  if (!isSupabaseConfigured()) return Response.json({ error: "Supabase is not configured yet." }, { status: 503 });
  try {
    const body = await request.json();
    const entryId = typeof body.entryId === "string" ? body.entryId : "";
    if (!UUID_PATTERN.test(entryId)) return Response.json({ error: "Choose a valid costume to delete." }, { status: 400 });

    const supabase = getSupabaseAdmin();
    const { data: control, error: controlError } = await supabase
      .from("event_control")
      .select("status, current_entry_id")
      .eq("id", 1)
      .single();
    if (controlError) throw controlError;
    if (control.current_entry_id === entryId && (control.status === "voting" || control.status === "paused")) {
      return Response.json({ error: "End this costume's round before deleting it." }, { status: 409 });
    }

    const { data, error } = await supabase
      .from("costume_entries")
      .delete()
      .eq("id", entryId)
      .select("id")
      .maybeSingle();
    if (error) throw error;
    if (!data) return Response.json({ error: "That costume was already removed." }, { status: 404 });
    return Response.json({ deletedId: data.id });
  } catch (error) {
    console.error("Could not delete costume", error);
    return Response.json({ error: "Could not delete this costume." }, { status: 500 });
  }
}
