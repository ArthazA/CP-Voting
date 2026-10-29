import type { Metadata } from "next";
import PartyApp from "../party-app";

export const metadata: Metadata = {
  title: "Host desk · Scare to Impress",
  robots: { index: false, follow: false },
};

export default function HostPage() {
  return <PartyApp mode="organizer" />;
}
