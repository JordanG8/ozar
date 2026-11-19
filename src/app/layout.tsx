import type { Metadata } from "next";
import "@fontsource-variable/assistant";
import "./globals.css";

export const metadata: Metadata = {
  title: "אוצר · אוצר מילים לפסיכומטרי",
  description: "תרגול אוצר מילים בעברית לפסיכומטרי.",
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html lang="he" dir="rtl">
      <body>{children}</body>
    </html>
  );
}
