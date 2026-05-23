import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Reel → AI Video",
  description: "Instagram Reel to AI-generated video pipeline",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
