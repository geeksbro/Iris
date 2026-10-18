import type { Metadata } from "next";
import { Fraunces, Geist, Poppins } from "next/font/google";
import { isBeta } from "@/features/beta/beta";
import { themeScript } from "@/features/settings/theme-script";
import { IconTips } from "@/features/tips/IconTips";

import "./globals.css";

// The interface's typeface: headings, body, labels and amounts all resolve to
// it — see the typography layer at the end of globals.css. Geist replaced
// Inter on 27 Sep 2026 (owner), with one pixel more tracking everywhere
// (--tracking-extra).
const sans = Geist({
  variable: "--font-sans",
  subsets: ["latin"],
});

// The other interface typeface, chosen in Settings (owner, 10 Oct 2026):
// globals.css points --font-sans at it under html[data-font="poppins"].
// Static, so its weights are listed; 650 rounds to 600.
const poppins = Poppins({
  variable: "--font-poppins",
  subsets: ["latin"],
  weight: ["400", "500", "600", "700"],
});

// The wordmark's face, and nothing else (owner, 27 Sep 2026): "Iris" in the
// rail is set as a logo, apart from the interface type. Variable, with its
// optical-size and softness axes, which .brand__wordmark sets.
const brand = Fraunces({
  variable: "--font-brand",
  subsets: ["latin"],
  style: "italic",
  axes: ["opsz", "SOFT"],
});

export const metadata: Metadata = {
  title: isBeta ? "IRIS (beta)" : "Sistema Patrimoniale Personale",
  description: "Un sistema privato e locale per comprendere patrimonio personale, flussi di cassa, investimenti, capitale di trading e obiettivi.",
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    // data-theme is set by the script below before React hydrates, so the
    // attribute legitimately differs from the server's markup.
    <html
      lang="it"
      className={`${sans.variable} ${poppins.variable} ${brand.variable}`}
      suppressHydrationWarning
    >
      <head>
        {/* The stored theme and typeface, applied before the first paint: no flash. */}
        <script dangerouslySetInnerHTML={{ __html: themeScript }} />
      </head>
      <body>
        {children}
        {/* An icon's name after a second of rest (owner, 18 Oct 2026). */}
        <IconTips />
      </body>
    </html>
  );
}
