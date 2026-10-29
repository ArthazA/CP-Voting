import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Costume Party · Halloween Costume Walk",
  description: "Rate the costumes one pumpkin at a time.",
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
