import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Scare to Impress · Vote",
  description: "Rate every costume on the catwalk, one pumpkin at a time.",
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html lang="en">
      <head>
        <link rel="preconnect" href="https://fonts.googleapis.com" />
        <link rel="preconnect" href="https://fonts.gstatic.com" crossOrigin="" />
        {/* eslint-disable-next-line @next/next/no-page-custom-font */}
        <link href="https://fonts.googleapis.com/css2?family=Pinyon+Script&display=swap" rel="stylesheet" />
      </head>
      <body>{children}</body>
    </html>
  );
}
