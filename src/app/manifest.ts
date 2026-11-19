import type { MetadataRoute } from "next";

export default function manifest(): MetadataRoute.Manifest {
  return {
    id: "/",
    name: "אוצר · אוצר מילים לפסיכומטרי",
    short_name: "אוצר",
    description: "תרגול אוצר מילים בעברית לפסיכומטרי",
    start_url: "/",
    scope: "/",
    display: "standalone",
    lang: "he",
    dir: "rtl",
    background_color: "#111110",
    theme_color: "#111110",
    icons: [
      { src: "/ozar-192.png", sizes: "192x192", type: "image/png", purpose: "any" },
      { src: "/ozar-512.png", sizes: "512x512", type: "image/png", purpose: "any" },
      { src: "/ozar-maskable.png", sizes: "512x512", type: "image/png", purpose: "maskable" },
    ],
  };
}
