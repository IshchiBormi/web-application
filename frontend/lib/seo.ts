// SEO uchun umumiy konstantalar va yordamchilar. Sayt manzili build vaqtida
// NEXT_PUBLIC_SITE_URL bilan boshqariladi (aks holda production domeni).
export const SITE_URL = (process.env.NEXT_PUBLIC_SITE_URL || "https://ishchibormi.uz").replace(/\/$/, "");
export const SITE_NAME = "Ishchi Bormi";
export const SITE_DESCRIPTION =
  "Ishchi Bormi — O'zbekiston uchun kunlik ish va mardikor bozori. Tasdiqlangan profillar, " +
  "ochiq baholar orqali ishchi toping yoki o'zingizga ish oling — bir necha daqiqada.";

export const SITE_KEYWORDS = [
  "ishchi bormi", "mardikor", "kunlik ish", "ish topish", "ishchi topish",
  "ish o'rni", "vaqtinchalik ish", "tozalash", "yuk tashish", "ustachilik",
  "santexnik", "ish e'lonlari", "O'zbekiston ish", "ishchi kuchi",
];

// API bazaviy manzili (server tomonda ham ishlaydi — absolyut bo'lishi shart).
export const API_BASE = (process.env.NEXT_PUBLIC_API_BASE || "http://localhost:8080").replace(/\/$/, "");

// Sahifa uchun to'liq (absolyut) URL yasaydi — canonical/OG uchun.
export function absUrl(path = "/"): string {
  return SITE_URL + (path.startsWith("/") ? path : "/" + path);
}

// Server tomonda bitta e'lonni oladi (generateMetadata + JSON-LD uchun).
// Xatolik bo'lsa null qaytaradi — sahifa baribir render bo'ladi.
export async function fetchElon(id: string): Promise<any | null> {
  try {
    const res = await fetch(`${API_BASE}/api/elons/${id}`, { next: { revalidate: 300 } });
    if (!res.ok) return null;
    return await res.json();
  } catch {
    return null;
  }
}

// Server tomonda ochiq foydalanuvchi profilini oladi (u/[id] metadata uchun).
export async function fetchPublicUser(id: string): Promise<any | null> {
  try {
    const res = await fetch(`${API_BASE}/api/users/${id}`, { next: { revalidate: 300 } });
    if (!res.ok) return null;
    return await res.json();
  } catch {
    return null;
  }
}
