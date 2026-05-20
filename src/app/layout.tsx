import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "PzP Finance",
  description: "Community treasury & developer hub",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en" className="h-full antialiased">
      <body className="min-h-full flex flex-col">
        <div className="grain" />
        {children}
      </body>
    </html>
  );
}
