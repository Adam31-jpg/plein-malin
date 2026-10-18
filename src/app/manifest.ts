import type { MetadataRoute } from "next";

export default function manifest(): MetadataRoute.Manifest {
  return {
    name: "Plein Malin",
    short_name: "Plein Malin",
    description: "Prix des carburants autour de moi",
    start_url: "/",
    display: "standalone",
    background_color: "#101214",
    theme_color: "#101214",
    lang: "fr",
    icons: [{ src: "/icon.svg", sizes: "any", type: "image/svg+xml" }],
  };
}
