"use client";
import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import Link from "next/link";
import { MapPin, Clock, Share2, ArrowUpRight, Briefcase, SlidersHorizontal, X } from "lucide-react";
import { api, Category, Elon, GENDER_LABEL, GENDER_OPTIONS } from "@/lib/api";
import { Shell, ShellSearch } from "@/components/Shell";
import { EmptyState } from "@/components/ui/EmptyState";
import { CardSkeleton } from "@/components/ui/Skeleton";
import { Select, TextInput } from "@/components/ui/Input";
import { Avatar } from "@/components/ui/Avatar";
import { ShareModal } from "@/components/ShareModal";
import { T, useT } from "@/components/T";
import { fmtSumSom, fromNow, onlyDigits, fmtThousands } from "@/lib/format";
import { REGIONS } from "@/lib/regions";

export default function Dashboard() {
  const t = useT();
  const [q, setQ] = useState("");
  const [cat, setCat] = useState<string>("");
  const [gender, setGender] = useState<string>(""); // "" = barchasi
  const [sort, setSort] = useState<string>("time");
  const [region, setRegion] = useState<string>("");
  const [minPrice, setMinPrice] = useState<string>("");
  const [maxPrice, setMaxPrice] = useState<string>("");
  const [showFilters, setShowFilters] = useState(false);

  // Faol (bo'sh bo'lmagan) filtrlar soni — "Filtr" tugmasidagi belgi uchun.
  const activeFilters = [region, minPrice, maxPrice].filter(Boolean).length;

  const { data: cats } = useQuery<Category[]>({
    queryKey: ["categories"],
    queryFn: () => api.get<Category[]>("/api/categories"),
  });
  const { data, isLoading } = useQuery<{ items: Elon[] }>({
    queryKey: ["feed", q, cat, gender, sort, region, minPrice, maxPrice],
    queryFn: () => {
      const p = new URLSearchParams();
      if (q) p.set("q", q);
      if (cat) p.set("categoryId", cat);
      if (gender) p.set("gender", gender);
      if (sort) p.set("sort", sort);
      if (region) p.set("region", region);
      if (minPrice) p.set("minPrice", onlyDigits(minPrice));
      if (maxPrice) p.set("maxPrice", onlyDigits(maxPrice));
      return api.get<{ items: Elon[] }>(`/api/elons?${p.toString()}`);
    },
  });

  const items = data?.items || [];
  const search = <ShellSearch value={q} onChange={setQ} placeholder={t("Xizmatlar yoki ishchilarni qidiring…")} />;

  function resetFilters() {
    setRegion(""); setMinPrice(""); setMaxPrice(""); setCat("");
  }

  return (
    <Shell title="Bosh sahifa" search={search}>
      {/* Categories */}
      <div className="card p-3 flex items-center gap-2 overflow-x-auto scroll-y-auto">
        <Chip active={cat === ""} onClick={() => setCat("")}><T>Barchasi</T></Chip>
        {(cats || []).slice(0, 12).map((c) => (
          <Chip key={c.id} active={cat === c.id} onClick={() => setCat(c.id)}>
            {c.icon && <span>{c.icon}</span>}<T>{c.name}</T>
          </Chip>
        ))}
      </div>

      {/* Jins bo'yicha bo'limlar: ishchi o'ziga mos ishlarni tez topsin. */}
      <div className="card p-3 flex items-center gap-2 overflow-x-auto scroll-y-auto">
        <Chip active={gender === ""} onClick={() => setGender("")}><T>Hammasi</T></Chip>
        {GENDER_OPTIONS.map((g) => (
          <Chip key={g} active={gender === g} onClick={() => setGender(g)}>
            <T>{GENDER_LABEL[g]}</T>
          </Chip>
        ))}
      </div>

      {/* Header strip */}
      <div className="flex items-center justify-between gap-3 flex-wrap">
        <div>
          <h2 className="text-base font-semibold heading"><T>Ish e'lonlari</T></h2>
          <p className="text-xs muted mt-0.5">
            <T>Topildi</T>: <b className="heading">{items.length}</b> <T>ta e'lon</T>
          </p>
        </div>
        <div className="flex items-center gap-2">
          <button
            onClick={() => setShowFilters((s) => !s)}
            className={`btn btn-secondary gap-2 ${showFilters || activeFilters > 0 ? "ring-1 ring-[color:var(--brand)]" : ""}`}
          >
            <SlidersHorizontal size={16} /><T>Filtr</T>
            {activeFilters > 0 && (
              <span className="grid place-items-center min-w-[18px] h-[18px] px-1 rounded-full bg-brand-navy text-white text-[10px] font-bold">
                {activeFilters}
              </span>
            )}
          </button>
          <div className="w-44">
            <Select value={sort} onChange={(e) => setSort(e.target.value)}>
              <option value="time">{t("Eng yangilari")}</option>
              <option value="price">{t("Yuqori narx")}</option>
            </Select>
          </div>
        </div>
      </div>

      {/* Filtr paneli */}
      {showFilters && (
        <div className="card p-4 grid gap-4 sm:grid-cols-2 lg:grid-cols-4 animate-fade-in">
          <Select label={t("Joylashuv")} value={region} onChange={(e) => setRegion(e.target.value)}>
            <option value="">{t("Barcha viloyatlar")}</option>
            {REGIONS.map((r) => <option key={r} value={r}>{r}</option>)}
          </Select>
          <Select label={t("Kategoriya")} value={cat} onChange={(e) => setCat(e.target.value)}>
            <option value="">{t("Barcha kategoriyalar")}</option>
            {(cats || []).map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
          </Select>
          <TextInput
            label={t("Narx (dan), so'm")} inputMode="numeric" placeholder="0"
            value={minPrice}
            onChange={(e) => setMinPrice(fmtThousands(onlyDigits(e.target.value)))}
          />
          <TextInput
            label={t("Narx (gacha), so'm")} inputMode="numeric" placeholder={t("Cheklovsiz")}
            value={maxPrice}
            onChange={(e) => setMaxPrice(fmtThousands(onlyDigits(e.target.value)))}
          />
          {activeFilters > 0 && (
            <div className="sm:col-span-2 lg:col-span-4">
              <button onClick={resetFilters} className="btn-ghost gap-1.5 text-sm">
                <X size={14} /><T>Filtrlarni tozalash</T>
              </button>
            </div>
          )}
        </div>
      )}

      {/* Grid */}
      {isLoading ? (
        <div className="grid sm:grid-cols-2 xl:grid-cols-3 gap-4">
          {Array.from({ length: 6 }).map((_, i) => <CardSkeleton key={i} />)}
        </div>
      ) : items.length === 0 ? (
        <EmptyState
          icon={<Briefcase size={22} />}
          title={t("Hozircha e'lonlar yo'q")}
          body={t("Filtrlarni o'zgartirib qaytadan urinib ko'ring yoki o'zingiz birinchi e'lonni joylashtiring.")}
          action={<Link href="/elon/create" className="btn btn-primary"><T>E'lon yaratish</T></Link>}
        />
      ) : (
        <div className="grid sm:grid-cols-2 xl:grid-cols-3 gap-4">
          {items.map((e) => <JobCard key={e.id} e={e} />)}
        </div>
      )}
    </Shell>
  );
}

function Chip({ active, onClick, children }: { active?: boolean; onClick: () => void; children: React.ReactNode }) {
  return (
    <button onClick={onClick} className={`chip shrink-0 ${active ? "chip-active" : ""}`}>{children}</button>
  );
}

function JobCard({ e }: { e: Elon }) {
  const neg = e.pricingType === "negotiable";
  const [shareOpen, setShareOpen] = useState(false);
  return (
    <>
    <Link href={`/elon/${e.id}`} className="card p-5 block transition hover:-translate-y-0.5 hover:shadow-pop animate-fade-in">
      <div className="flex items-start gap-3">
        <Avatar name={e.ownerName} src={e.ownerAvatarUrl} size="md" />
        <div className="min-w-0 flex-1">
          <div className="flex items-start justify-between gap-2">
            <h3 className="font-semibold heading leading-tight line-clamp-1"><T>{e.title}</T></h3>
            <button
              onClick={(ev) => { ev.preventDefault(); ev.stopPropagation(); setShareOpen(true); }}
              className="muted hover:text-accent-amber transition"
            >
              <Share2 size={16} />
            </button>
          </div>
          <div className="mt-0.5 flex items-center gap-2 text-xs muted">
            <span className="truncate">{e.ownerName || "—"}</span>
          </div>
        </div>
      </div>

      <div className="mt-3 flex flex-wrap gap-2 text-xs muted">
        <span className="inline-flex items-center gap-1 surface px-2 py-1">
          <MapPin size={12} />{e.locationText || e.region || "—"}
        </span>
        {e.publishedAt && (
          <span className="inline-flex items-center gap-1 surface px-2 py-1">
            <Clock size={12} />{fromNow(e.publishedAt)}
          </span>
        )}
        <span className="badge-neutral"><T>{e.categoryName}</T></span>
        {(e.gender === "male" || e.gender === "female") && (
          <span className="badge-neutral"><T>{GENDER_LABEL[e.gender]}</T></span>
        )}
      </div>

      <div className="mt-4 pt-3 border-t flex items-end justify-between" style={{ borderColor: "var(--border)" }}>
        <div>
          <div className="text-[11px] uppercase tracking-wide muted"><T>Narxi</T></div>
          <div className="text-lg font-bold text-accent-amber leading-none mt-0.5">
            {fmtSumSom(e.perWorkerAmount || e.priceAmount, neg)}
          </div>
        </div>
        <span className="inline-flex items-center gap-1 text-xs font-medium heading group">
          <T>Ko'rish</T><ArrowUpRight size={14} className="transition group-hover:translate-x-0.5 group-hover:-translate-y-0.5" />
        </span>
      </div>
    </Link>
    <ShareModal open={shareOpen} onClose={() => setShareOpen(false)} path={`/elon/${e.id}`} title={e.title} />
    </>
  );
}
