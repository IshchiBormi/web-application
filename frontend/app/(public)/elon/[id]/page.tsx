import type { Metadata } from "next";
import { SITE_URL, SITE_NAME, fetchElon, absUrl } from "@/lib/seo";
import ElonClient from "./elon-client";

type Params = { params: { id: string } };

function priceText(e: any): string {
  if (!e) return "";
  if (e.pricingType === "negotiable") return "Kelishilgan holda";
  const n = Number(e.perWorkerAmount || e.priceAmount || 0);
  return n > 0 ? `${n.toLocaleString("ru-RU")} so'm` : "";
}

// Har bir e'lon uchun alohida title/description (Google natijalarida ko'rinadi).
export async function generateMetadata({ params }: Params): Promise<Metadata> {
  const e = await fetchElon(params.id);
  if (!e) {
    return { title: "E'lon", description: "Ishchi Bormi — kunlik ish va mardikor bozori." };
  }
  const loc = [e.region, e.district].filter(Boolean).join(", ");
  const price = priceText(e);
  const title = `${e.title}${loc ? ` — ${loc}` : ""}`;
  const desc =
    (e.description ? String(e.description).slice(0, 150) : `${e.categoryName || "Ish"} bo'yicha e'lon`) +
    (price ? ` · ${price}` : "") + (loc ? ` · ${loc}` : "");
  const path = `/elon/${params.id}`;
  const images: string[] = Array.isArray(e.images) ? e.images.filter(Boolean) : [];
  return {
    title,
    description: desc,
    alternates: { canonical: path },
    openGraph: {
      type: "article",
      title,
      description: desc,
      url: absUrl(path),
      siteName: SITE_NAME,
      ...(images.length ? { images: images.slice(0, 4) } : {}),
    },
    twitter: {
      card: images.length ? "summary_large_image" : "summary",
      title,
      description: desc,
      ...(images.length ? { images: [images[0]] } : {}),
    },
  };
}

// JobPosting tuzilmali ma'lumoti — Google'da "ish" boyitilgan natijasi uchun.
function jobPostingLd(e: any, id: string) {
  if (!e) return null;
  const loc = [e.district, e.region].filter(Boolean).join(", ");
  const amount = Number(e.perWorkerAmount || e.priceAmount || 0);
  return {
    "@context": "https://schema.org",
    "@type": "JobPosting",
    title: e.title,
    description: e.description || e.title,
    datePosted: e.publishedAt || e.createdAt || undefined,
    employmentType: "PER_DIEM",
    hiringOrganization: {
      "@type": "Organization",
      name: e.ownerName || SITE_NAME,
    },
    jobLocation: {
      "@type": "Place",
      address: {
        "@type": "PostalAddress",
        addressRegion: e.region || undefined,
        addressLocality: e.district || undefined,
        addressCountry: "UZ",
      },
    },
    ...(amount > 0
      ? {
          baseSalary: {
            "@type": "MonetaryAmount",
            currency: "UZS",
            value: { "@type": "QuantitativeValue", value: amount, unitText: "DAY" },
          },
        }
      : {}),
    url: absUrl(`/elon/${id}`),
    identifier: { "@type": "PropertyValue", name: SITE_NAME, value: id },
  };
}

export default async function Page({ params }: Params) {
  const e = await fetchElon(params.id);
  const ld = jobPostingLd(e, params.id);
  return (
    <>
      {ld && (
        <script
          type="application/ld+json"
          dangerouslySetInnerHTML={{ __html: JSON.stringify(ld) }}
        />
      )}
      <ElonClient />
    </>
  );
}
