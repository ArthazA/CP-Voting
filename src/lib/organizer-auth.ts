import "server-only";
import { createHmac, timingSafeEqual } from "node:crypto";
import { cookies } from "next/headers";

export const ORGANIZER_COOKIE = "cp_organizer";
const COOKIE_LIFETIME_SECONDS = 8 * 60 * 60;

function expectedToken() {
  const secret = process.env.SESSION_SECRET;
  if (!secret) throw new Error("SESSION_SECRET is not configured.");
  return createHmac("sha256", secret).update("costume-party-organizer").digest("hex");
}

export function createOrganizerCookieOptions() {
  return {
    httpOnly: true,
    sameSite: "strict" as const,
    secure: process.env.NODE_ENV === "production",
    path: "/",
    maxAge: COOKIE_LIFETIME_SECONDS,
  };
}

export async function isOrganizer() {
  const cookieStore = await cookies();
  const supplied = cookieStore.get(ORGANIZER_COOKIE)?.value;
  if (!supplied) return false;
  const expected = expectedToken();
  const actualBuffer = Buffer.from(supplied);
  const expectedBuffer = Buffer.from(expected);
  return actualBuffer.length === expectedBuffer.length && timingSafeEqual(actualBuffer, expectedBuffer);
}

export function organizerToken() {
  return expectedToken();
}
