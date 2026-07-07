import type { MetadataRoute } from "next";

export default function manifest(): MetadataRoute.Manifest {
  return {
    name: "CSTL",
    short_name: "CSTL",
    description: "Phoenix Tanner — CSTL booking & documentation",
    start_url: "/",
    display: "standalone",
    background_color: "#f6f0e6",
    theme_color: "#b46a4a",
    icons: [
      { src: "/icon", sizes: "512x512", type: "image/png" },
      { src: "/apple-icon", sizes: "180x180", type: "image/png" },
    ],
  };
}
