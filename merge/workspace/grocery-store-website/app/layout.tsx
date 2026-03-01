import type { Metadata } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import "./globals.css";

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

export const metadata: Metadata = {
  title: "FreshGrocer - Your Neighborhood Grocery Store",
  description: "FreshGrocer offers a wide selection of fresh produce, dairy, pantry staples and more",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en">
      <body
        className={`${geistSans.variable} ${geistMono.variable} antialiased`}
      >
        <nav className="bg-gradient-to-r from-green-600 to-emerald-600 text-white py-4 shadow-lg">
          <div className="container mx-auto px-4">
            <div className="flex justify-between items-center">
              <a href="/" className="text-2xl font-bold flex items-center gap-2">
                <span className="text-3xl">🥬</span>
                <span>FreshGrocer</span>
              </a>
              <div className="flex gap-8">
                <a href="/" className="nav-link">Home</a>
                <a href="/products" className="nav-link">Products</a>
                <a href="/about" className="nav-link">About</a>
                <a href="/contact" className="nav-link">Contact</a>
              </div>
            </div>
          </div>
        </nav>
        {children}
      </body>
    </html>
  );
}