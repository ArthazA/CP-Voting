import { cookies } from "next/headers";
import { ORGANIZER_COOKIE } from "@/lib/organizer-auth";

export async function POST() {
  const cookieStore = await cookies();
  cookieStore.delete(ORGANIZER_COOKIE);
  return Response.json({ authenticated: false });
}
