import type { Metadata } from "next";
import RevealScreen from "./reveal-screen";

export const metadata: Metadata = {
  title: "Winners · Scare to Impress",
  robots: { index: false, follow: false },
};

export default function RevealPage() {
  return <RevealScreen />;
}
