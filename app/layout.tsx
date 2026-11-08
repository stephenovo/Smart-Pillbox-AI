import type { Metadata } from "next";
import localFont from "next/font/local";
import Script from "next/script";
import "./globals.css";

const figtree = localFont({
  src: "./fonts/Figtree-Variable.ttf",
  weight: "300 900",
  variable: "--font-figtree",
  display: "swap",
});

export const metadata: Metadata = {
  title: "Smart Pillbox | Medication care",
  description:
    "Calm medication monitoring for family caregivers and self-directed routines",
};

const themeInitializationScript = `
  try {
    var savedTheme = window.localStorage.getItem("smart-pillbox-theme");
    var theme = savedTheme === "dark" ? "dark" : "light";
    document.documentElement.dataset.theme = theme;
    document.documentElement.style.colorScheme = theme;
  } catch (error) {
    document.documentElement.dataset.theme = "light";
    document.documentElement.style.colorScheme = "light";
  }
`;

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en" suppressHydrationWarning>
      <body className={figtree.variable}>
        {children}
        <Script id="theme-initializer" strategy="beforeInteractive">
          {themeInitializationScript}
        </Script>
      </body>
    </html>
  );
}
