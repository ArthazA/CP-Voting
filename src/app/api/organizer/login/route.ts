import { cookies } from "next/headers";
import { createOrganizerCookieOptions, ORGANIZER_COOKIE, organizerToken } from "@/lib/organizer-auth";

export async function POST(request: Request) {
  const password = process.env.ORGANIZER_PASSWORD;
  if (!password || !process.env.SESSION_SECRET) {
    return Response.json({ error: "Organizer sign-in is not configured on the server." }, { status: 503 });
  }
  const body = await request.json().catch(() => ({}));
  if (typeof body.password !== "string" || body.password !== password) {
    return Response.json({ error: "That password didn’t match." }, { status: 401 });
  }
  const cookieStore = await cookies();
  cookieStore.set(ORGANIZER_COOKIE, organizerToken(), createOrganizerCookieOptions());
  return Response.json({ authenticated: true });
}
