import { Geist, Geist_Mono } from "next/font/google";
import "./globals.css";
import { ThemeProvider } from "@/components/theme-provider";
import { Toaster, BannerProvider, GlobalBanner } from "@geiger/ui";

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

export const metadata = {
  title: "Grey — Geiger",
  description:
    "Knowledge bases, graphs and RAG pipelines for your Geiger projects.",
};

export default function RootLayout({ children }) {
  return (
    <html lang="en" suppressHydrationWarning>
      <body
        suppressHydrationWarning
        className={`${geistSans.variable} ${geistMono.variable} antialiased`}
      >
        <ThemeProvider
          attribute="class"
          defaultTheme="system"
          enableSystem
          disableTransitionOnChange
        >
          <BannerProvider>
            <div className="flex flex-col min-h-screen">
              <GlobalBanner />
              {children}
            </div>
            <Toaster />
          </BannerProvider>
        </ThemeProvider>
      </body>
    </html>
  );
}
