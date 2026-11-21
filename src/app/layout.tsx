import type { Metadata, Viewport } from "next";
import "@fontsource-variable/assistant";
import "./globals.css";
import { KeyboardViewport } from "./keyboard-viewport";
import { RegisterWorker } from "./register-worker";

export const metadata: Metadata = {
  title: "אוצר · אוצר מילים לפסיכומטרי",
  description: "תרגול אוצר מילים בעברית לפסיכומטרי.",
  icons: { icon: "/ozar-192.png", apple: "/ozar-apple.png" },
  appleWebApp: { capable: true, title: "אוצר", statusBarStyle: "black" },
};

// The on-screen keyboard shrinks the layout instead of covering it (Chrome and Firefox on Android).
export const viewport: Viewport = { themeColor: "#111110", interactiveWidget: "resizes-content" };

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html lang="he" dir="rtl">
      <body>{children}<KeyboardViewport /><RegisterWorker /></body>
    </html>
  );
}
