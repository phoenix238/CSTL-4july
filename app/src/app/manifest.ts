import type { MetadataRoute } from "next";

export default function manifest(): MetadataRoute.Manifest {
  return {
    name: "CSTL Control Tower",
    short_name: "CSTL",
    description: "Phoenix Tanner — CSTL booking & documentation control tower",
    start_url: "/",
    display: "standalone",
    background_color: "#f6f0e6",
    theme_color: "#b46a4a",
    icons: [
      { src: "/icon", sizes: "512x512", type: "image/png" },
      { src: "/apple-icon", sizes: "180x180", type: "image/png" },
    ],
    // Lets an Android share (or an iOS Shortcut) drop a message straight into a new enquiry.
    share_target: {
      action: "/enquiries",
      method: "GET",
      params: { title: "title", text: "text", url: "url" },
    },
  };
}
