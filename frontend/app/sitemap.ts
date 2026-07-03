import type { MetadataRoute } from "next";
import { SITE_URL, API_BASE } from "@/lib/seo";

// Sitemap har soatda yangilanadi (ISR) — build vaqtida API kerak emas.
export const revalidate = 3600;

export default async function sitemap(): Promise<MetadataRoute.Sitemap> {
  const now = new Date();

  // Ochiq statik sahifalar.
  const staticPages: MetadataRoute.Sitemap = [
    { url: `${SITE_URL}/`, lastModified: now, changeFrequency: "hourly", priority: 1 },
    { url: `${SITE_URL}/biz-haqimizda`, lastModified: now, changeFrequency: "monthly", priority: 0.6 },
    { url: `${SITE_URL}/yordam`, lastModified: now, changeFrequency: "monthly", priority: 0.5 },
    { url: `${SITE_URL}/foydalanish-shartlari`, lastModified: now, changeFrequency: "yearly", priority: 0.3 },
    { url: `${SITE_URL}/maxfiylik-siyosati`, lastModified: now, changeFrequency: "yearly", priority: 0.3 },
  ];

  // Dinamik e'lonlar — API'dan olamiz (xatolik bo'lsa faqat statiklar qaytadi).
  let elonPages: MetadataRoute.Sitemap = [];
  try {
    const res = await fetch(`${API_BASE}/api/elons?limit=100&sort=time`, { next: { revalidate: 3600 } });
    if (res.ok) {
      const data = await res.json();
      const items: any[] = data?.items || [];
      elonPages = items.map((e) => ({
        url: `${SITE_URL}/elon/${e.id}`,
        lastModified: e.updatedAt ? new Date(e.updatedAt) : now,
        changeFrequency: "daily" as const,
        priority: 0.8,
      }));
    }
  } catch {
    // API mavjud bo'lmasa — statik sahifalar bilan cheklanamiz.
  }

  return [...staticPages, ...elonPages];
}
