import type { Metadata, Viewport } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Uncharted Builds",
  description: "An RPG where the game watches how you play and rewards your habits with hidden skills.",
};

export const viewport: Viewport = { width: "device-width", initialScale: 1, themeColor: "#0f1412" };

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="en">
      <body className="font-sans antialiased">{children}</body>
    </html>
  );
}
