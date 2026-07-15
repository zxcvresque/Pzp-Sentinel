import type { Metadata } from "next";
import Script from "next/script";
import { Inter, Playfair_Display, IBM_Plex_Mono } from "next/font/google";
import "./globals.css";

const inter = Inter({
  subsets: ["latin"],
  variable: "--font-inter",
});

const playfair = Playfair_Display({
  subsets: ["latin"],
  style: "italic",
  variable: "--font-playfair",
});

const ibmPlexMono = IBM_Plex_Mono({
  subsets: ["latin"],
  weight: ["400", "500", "600"],
  variable: "--font-ibm-plex-mono",
});


export const metadata: Metadata = {
  title: "Sentinel — PzP Finance & Developers Hub",
  description: "Community treasury and developer hub for PzP",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  const bmcAccountSlug = process.env.BMC_ACCOUNT_SLUG?.trim();

  return (
    <html lang="en" className={`h-full antialiased ${inter.variable} ${playfair.variable} ${ibmPlexMono.variable}`}>
      {bmcAccountSlug && (
        <Script
          id="bmc-widget"
          strategy="beforeInteractive"
          src="https://cdnjs.buymeacoffee.com/1.0.0/widget.prod.min.js"
          data-name="BMC-Widget"
          data-cfasync="false"
          data-id={bmcAccountSlug}
          data-description="Support Sentinel on Buy Me a Coffee"
          data-message=""
          data-color="#FBBF24"
          data-position="Right"
          data-x_margin="18"
          data-y_margin="82"
        />
      )}
      <body className="min-h-full flex flex-col">
        <div className="grain" />
        {children}
      </body>
    </html>
  );
}
