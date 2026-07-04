"use client";
import { useState } from "react";
import Link from "next/link";
import { Star, MapPin, Clock, Share2 } from "lucide-react";
import { Elon } from "@/lib/api";
import { fmtSumSom, fromNow } from "@/lib/format";
import { ShareModal } from "./ShareModal";
import { Avatar } from "./ui/Avatar";
import { T } from "./T";

export function JobCard({ e }: { e: Elon }) {
  const negotiable = e.pricingType === "negotiable";
  const [shareOpen, setShareOpen] = useState(false);
  return (
    <>
    <Link href={`/elon/${e.id}`} className="card block p-4 hover:shadow-md transition">
      <div className="flex items-start justify-between gap-2">
        <h3 className="font-semibold text-base"><T>{e.title}</T></h3>
        <button
          onClick={(ev) => { ev.preventDefault(); ev.stopPropagation(); setShareOpen(true); }}
          className="text-accent-amber hover:opacity-80"
          aria-label="Ulashish"
        >
          <Share2 size={18} />
        </button>
      </div>
      <div className="mt-1 flex items-center gap-2 text-sm text-[color:var(--text-muted)]">
        <Avatar size="xs" name={e.ownerName} src={e.ownerAvatarUrl} />
        <span>{e.ownerName || "Foydalanuvchi"}</span>
        <span>•</span>
        <Star size={14} className="text-accent-amber" />
        <span>{(e.ownerRating ?? 0).toFixed(1)}</span>
      </div>
      <div className="mt-2 flex flex-wrap items-center gap-3 text-sm text-[color:var(--text-muted)]">
        {(e.region || e.locationText) && (<span className="inline-flex items-center gap-1"><MapPin size={14} /><T>{[e.region, e.district].filter(Boolean).join(", ") || e.locationText || ""}</T></span>)}
        {e.publishedAt && (<span className="inline-flex items-center gap-1"><Clock size={14} />{fromNow(e.publishedAt)}</span>)}
      </div>
      <div className="mt-3 flex items-center justify-between">
        <span className="text-xs uppercase text-[color:var(--text-muted)]">
          <T>{e.categoryName || ""}</T>
        </span>
        <span className="font-semibold text-accent-amber">
          {fmtSumSom(e.perWorkerAmount || e.priceAmount, negotiable)}
        </span>
      </div>
    </Link>
    <ShareModal open={shareOpen} onClose={() => setShareOpen(false)} path={`/elon/${e.id}`} title={e.title} />
    </>
  );
}
