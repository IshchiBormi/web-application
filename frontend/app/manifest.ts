import type { MetadataRoute } from "next";
import { SITE_NAME, SITE_DESCRIPTION } from "@/lib/seo";

export default function manifest(): MetadataRoute.Manifest {
  return {
    name: `${SITE_NAME} — kunlik ish va ishchi bozori`,
    short_name: SITE_NAME,
    description: SITE_DESCRIPTION,
    start_url: "/",
    display: "standalone",
    background_color: "#F6F7FB",
    theme_color: "#0F1F56",
    lang: "uz",
    categories: ["business", "productivity"],
  };
}
