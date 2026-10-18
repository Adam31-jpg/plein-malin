import type { Metadata, Viewport } from "next";
import { Barlow, Barlow_Condensed } from "next/font/google";
import Analytics from "@/components/Analytics";
import "maplibre-gl/dist/maplibre-gl.css";
import "./globals.css";

const barlow = Barlow({ variable: "--font-barlow", subsets: ["latin"], weight: ["400", "500", "600", "700"] });
const barlowCondensed = Barlow_Condensed({ variable: "--font-barlow-condensed", subsets: ["latin"], weight: ["600", "700"] });

export const metadata: Metadata = {
  title: "Plein Malin — prix des carburants autour de moi",
  description: "Prix des carburants en temps réel, historique par station et conseils pour faire le plein au meilleur moment.",
  applicationName: "Plein Malin",
  appleWebApp: { capable: true, title: "Plein Malin", statusBarStyle: "black-translucent" },
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  viewportFit: "cover",
  themeColor: [
    { media: "(prefers-color-scheme: dark)", color: "#101214" },
    { media: "(prefers-color-scheme: light)", color: "#f6f5f1" },
  ],
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html lang="fr" className={`${barlow.variable} ${barlowCondensed.variable}`}>
      <body>
        {children}
        <Analytics />
      </body>
    </html>
  );
}
