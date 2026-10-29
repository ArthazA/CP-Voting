import type { Metadata } from "next";
import LiveScreen from "./live-screen";

export const metadata: Metadata = {
  title: "Live · Scare to Impress",
  robots: { index: false, follow: false },
};

export default function LivePage() {
  return <LiveScreen />;
}
