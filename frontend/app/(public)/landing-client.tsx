"use client";
import Link from "next/link";
import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import {
  ShieldCheck, CheckCircle2, Clock, MessageSquare, ShieldAlert,
  MapPin, User as UserIcon, Sparkles, Truck, Hammer,
  Phone, Send, ArrowRight, Search, ArrowUpRight,
  Mail, Instagram, Youtube, LifeBuoy,
} from "lucide-react";
import { CONTACT, SOCIAL } from "@/lib/contact";
import { api, Elon, User, getAccess } from "@/lib/api";
import { Button } from "@/components/ui/Button";
import { Avatar } from "@/components/ui/Avatar";
import { ScriptToggle } from "@/components/ScriptToggle";
import { ThemeToggle } from "@/components/ThemeToggle";
import { T, useT } from "@/components/T";
import { fmtSum, fmtSumSom } from "@/lib/format";

export default function Landing() {
  const t = useT();
  const router = useRouter();
  const [examples, setExamples] = useState<Elon[]>([]);
  const [checking, setChecking] = useState(true);
  // getAccess() localStorage'ni o'qiydi — server (token yo'q) va client (token
  // bor) renderlarini farqlantiradi. Birinchi render server bilan mos bo'lishi
  // uchun auth'ga bog'liq shohobchalarni faqat mount'dan keyin ko'rsatamiz.
  const [mounted, setMounted] = useState(false);
  useEffect(() => { setMounted(true); }, []);

  // Tizimga kirgan foydalanuvchiga landing ko'rsatilmaydi — to'g'ridan-to'g'ri
  // kabinetga (yoki ro'yxatdan o'tish tugamagan bo'lsa onboardingga) yo'naltiramiz.
  useEffect(() => {
    if (!getAccess()) { setChecking(false); return; }
    api.get<User>("/api/me")
      .then((u) => router.replace(u.onboardingCompleted ? "/dashboard" : "/onboarding"))
      .catch(() => setChecking(false));
  }, [router]);

  useEffect(() => {
    api.get<{ items: Elon[] }>("/api/elons?limit=3", { auth: "none" } as any)
      .then((r) => setExamples(r.items || [])).catch(() => {});
  }, []);
  const ctaHref = mounted && getAccess() ? "/dashboard" : "/login";

  if (mounted && checking && getAccess()) {
    return <div className="min-h-screen grid place-items-center muted text-sm"><T>Yuklanmoqda…</T></div>;
  }

  return (
    <div className="min-h-screen flex flex-col">
      {/* ── Nav ───────────────────────────────────────── */}
      <header
        className="sticky top-0 z-30 border-b backdrop-blur-md"
        style={{ borderColor: "var(--border)", background: "color-mix(in srgb, var(--card) 88%, transparent)" }}
      >
        <div className="mx-auto max-w-6xl flex items-center justify-between px-4 py-3.5">
          <Link href="/" className="font-extrabold text-xl heading tracking-tight">Ishchi Bormi</Link>
          <div className="hidden md:flex items-center gap-6 text-sm muted">
            <Link href="#how" className="hover:heading"><T>Qanday ishlaydi</T></Link>
            <Link href="#categories" className="hover:heading"><T>Xizmatlar</T></Link>
            <Link href="/biz-haqimizda" className="hover:heading"><T>Biz haqimizda</T></Link>
          </div>
          <div className="flex items-center gap-2">
            <ScriptToggle />
            <ThemeToggle />
            <Link href={ctaHref} className="btn btn-primary"><T>Kirish</T></Link>
          </div>
        </div>
      </header>

      <main className="flex-1">
        {/* ── HERO ─────────────────────────────────── */}
        <section className="px-4 pt-12 sm:pt-20 pb-10 sm:pb-16">
          <div className="mx-auto max-w-6xl text-center">
            <div className="inline-flex items-center gap-2 rounded-full px-3 py-1 text-xs font-medium animate-fade-in"
                 style={{ background: "var(--accent-soft)", color: "var(--accent)" }}>
              <Sparkles size={12} /><T>O'zbekistondagi #1 mehnat platformasi</T>
            </div>
            <h1 className="mt-5 text-3xl sm:text-5xl md:text-6xl font-extrabold heading leading-[1.1] tracking-tight animate-slide-up">
              <T>Ishchi toping yoki</T><br />
              <span style={{ background: "linear-gradient(120deg, var(--brand) 0%, var(--accent) 100%)", WebkitBackgroundClip: "text", color: "transparent" }}>
                <T>ish boshlash o'zingizda</T>
              </span>
            </h1>
            <p className="mx-auto mt-5 max-w-2xl text-base muted">
              <T>Tasdiqlangan profillar, ochiq baholar, bir necha daqiqada kirish. Ortiqcha vositachilar va noaniqliklarsiz.</T>
            </p>
            <div className="mt-7 flex flex-wrap justify-center gap-3">
              <Link href={ctaHref} className="btn btn-primary btn-lg gap-2"><T>Bepul boshlash</T><ArrowRight size={16} /></Link>
              <Link href="#how" className="btn btn-secondary btn-lg"><T>Qanday ishlaydi?</T></Link>
            </div>

            {/* Stats row */}
            <div className="mt-12 grid grid-cols-2 max-w-md mx-auto gap-6 sm:gap-8">
              <Stat icon={<CheckCircle2 size={16} className="text-success" />} value="1000+" label="bajarilgan ish" />
              <Stat icon={<ShieldCheck size={16} className="text-tg-blue" />}    value="500+"  label="tasdiqlangan ishchi" />
            </div>
          </div>
        </section>

        {/* ── Job examples ─────────────────────────── */}
        <section className="px-4 pb-16">
          <div className="mx-auto max-w-6xl">
            <SectionHeader eyebrow="Yangi e'lonlar" title="Hozir ish topish mumkin" />
            <div className="mt-6 grid md:grid-cols-3 gap-4">
              {(examples.length > 0 ? examples.slice(0, 3) : SAMPLES).map((e: any, i) => (
                <Link key={e.id || i} href={e.id ? `/elon/${e.id}` : ctaHref}
                      className="card p-5 block transition hover:-translate-y-0.5 hover:shadow-pop animate-fade-in">
                  <div className="flex items-start gap-3">
                    <Avatar name={e.ownerName || e.owner} src={e.ownerAvatarUrl} />
                    <div className="min-w-0 flex-1">
                      <div className="font-semibold heading line-clamp-1"><T>{e.title}</T></div>
                      <div className="text-xs muted mt-0.5 flex items-center gap-1">
                        <span className="truncate">{e.ownerName || e.owner}</span>
                      </div>
                    </div>
                  </div>
                  <div className="mt-3 text-xs muted flex items-center gap-1.5">
                    <MapPin size={12} />{e.locationText || [e.region, e.district].filter(Boolean).join(", ") || e.location}
                  </div>
                  <div className="mt-4 pt-3 border-t flex items-end justify-between" style={{ borderColor: "var(--border)" }}>
                    <div>
                      <div className="text-[11px] uppercase muted"><T>Narxi</T></div>
                      <div className="text-base font-bold text-accent-amber">
                        {e.id ? fmtSumSom(e.perWorkerAmount, e.pricingType === "negotiable") : `${fmtSum(e.price)} so'm`}
                      </div>
                    </div>
                    <span className="inline-flex items-center gap-1 text-xs font-medium heading">
                      <T>Ko'rish</T><ArrowUpRight size={13} />
                    </span>
                  </div>
                </Link>
              ))}
            </div>
          </div>
        </section>

        {/* ── Pain points ──────────────────────────── */}
        <section className="px-4 py-16" style={{ background: "var(--bg-subtle)" }}>
          <div className="mx-auto max-w-6xl">
            <SectionHeader eyebrow="Muammo" title="Nega an'anaviy usullar eskirgan?"
              subtitle="Eski usullar vaqt va asabni tejaydigan zamonaviy yechim emas." />
            <div className="mt-8 grid md:grid-cols-3 gap-4">
              <Pain icon={<Clock size={20} />}        title="Bozorlarda kutish"
                    body="Ertalabdan ko'chada turib ish kutish — ham vaqt, ham ob-havo noqulayligi." />
              <Pain icon={<MessageSquare size={20} />} title="Telegram guruhlar"
                    body="Tartibsiz xabarlar orasida ishonchli mutaxassisni topish qiyin." />
              <Pain icon={<ShieldAlert size={20} />}   title="Xavfsizlik yo'q"
                    body="Kim bilan ishlashingiz haqida ishonchli ma'lumot bo'lmaydi — har doim xavf-xatar." />
            </div>
          </div>
        </section>

        {/* ── How it works ─────────────────────────── */}
        <section id="how" className="px-4 py-16">
          <div className="mx-auto max-w-6xl">
            <SectionHeader eyebrow="Jarayon" title="Bir necha qadamda ishlaydi" />
            <div className="mt-8 grid md:grid-cols-2 gap-5">
              <HowCard title="Ish beruvchilar uchun" steps={[
                ["E'lon yarating", "Sarlavha, narx va ish joyini ko'rsating."],
                ["Arizalarni ko'ring", "Ishchilar ma'lumotlarini taqqoslang."],
                ["Tasdiqlang", "Maqbul kishini qabul qiling va to'g'ridan bog'laning."],
                ["Ishni yakunlang", "Ish tugagach to'g'ridan-to'g'ri hisob-kitob qiling."],
              ]} />
              <HowCard title="Ishchilar uchun" steps={[
                ["Ro'yxatdan o'ting", "Telegram orqali bir necha daqiqada."],
                ["Profilni to'ldiring", "Tajriba va xizmatlaringizni ulashing."],
                ["Ariza topshiring", "Sizga mos e'lonlarni topib arizalang."],
                ["Ko'proq ish oling", "Sifatli ish — ko'proq mijoz."],
              ]} />
            </div>
          </div>
        </section>

        {/* ── Categories ──────────────────────────── */}
        <section id="categories" className="px-4 py-16" style={{ background: "var(--bg-subtle)" }}>
          <div className="mx-auto max-w-6xl">
            <SectionHeader eyebrow="Xizmatlar" title="Mashhur xizmat turlari" />
            <div className="mt-8 grid grid-cols-1 sm:grid-cols-3 gap-3 max-w-3xl mx-auto">
              <Cat icon={<Sparkles size={20} />}        label="Tozalash" />
              <Cat icon={<Truck size={20} />}           label="Yuk tashish" />
              <Cat icon={<Hammer size={20} />}          label="Maxsus" />
            </div>
          </div>
        </section>

        {/* ── Testimonials ────────────────────────── */}
        <section className="px-4 py-16">
          <div className="mx-auto max-w-6xl">
            <SectionHeader eyebrow="Fikrlar" title="Foydalanuvchilar nima deydi" />
            <div className="mt-8 grid md:grid-cols-2 gap-4">
              <Quote name="Alisher R." location="Toshkent"
                text="Juda qulay xizmat. Uyimizni ko'chirish uchun bir soat ichida ishonchli yigitlarni topdik. Narxlar ham kelishilgan." />
              <Quote name="Dilnoza K." location="Samarqand"
                text="Santexnik kerak edi. Saytdan tez topdim va to'g'ridan-to'g'ri bog'landim. Ishni sifatli bajardi, rahmat!" />
            </div>
          </div>
        </section>

        {/* ── CTA ─────────────────────────────────── */}
        <section className="px-4 pb-16">
          <div className="mx-auto max-w-6xl rounded-3xl gradient-hero text-white p-8 sm:p-12 grid md:grid-cols-[1fr_auto] items-center gap-6 shadow-pop">
            <div>
              <h3 className="text-2xl sm:text-3xl font-extrabold leading-tight">
                <T>Bugun boshlang — ish o'zi keladi</T>
              </h3>
              <p className="mt-2 text-white/85 text-sm sm:text-base max-w-xl">
                <T>Bir necha daqiqada ro'yxatdan o'ting va o'z biznesingiz yoki ish o'rningizni toping.</T>
              </p>
            </div>
            <Link href={ctaHref} className="btn btn-lg bg-white text-brand-navy hover:opacity-90 gap-2">
              <T>Bepul boshlash</T><ArrowRight size={16} />
            </Link>
          </div>
        </section>
      </main>

      {/* ── Footer ─────────────────────────────── */}
      <footer className="border-t" style={{ borderColor: "var(--border)", background: "var(--card)" }}>
        <div className="mx-auto max-w-6xl px-4 py-10 grid md:grid-cols-[1.2fr_1fr_1fr] gap-8 text-sm">
          <div>
            <div className="font-extrabold heading text-lg tracking-tight">Ishchi Bormi</div>
            <p className="mt-2 muted text-sm max-w-xs">
              <T>Sizning ishonchli ishchi kuchi bozoringiz.</T>
            </p>
            <ul className="mt-4 space-y-1.5 muted">
              <li><a href={CONTACT.phoneHref} className="flex items-center gap-2 hover:heading"><Phone size={13} />{CONTACT.phone}</a></li>
              <li><a href={CONTACT.emailHref} className="flex items-center gap-2 hover:heading"><Mail size={13} />{CONTACT.email}</a></li>
              <li><a href={SOCIAL.telegram.href} target="_blank" rel="noreferrer" className="flex items-center gap-2 hover:heading"><Send size={13} />Telegram {SOCIAL.telegram.label}</a></li>
              <li><a href={SOCIAL.support.href} target="_blank" rel="noreferrer" className="flex items-center gap-2 hover:heading"><LifeBuoy size={13} />Support {SOCIAL.support.label}</a></li>
              <li><a href={SOCIAL.instagram.href} target="_blank" rel="noreferrer" className="flex items-center gap-2 hover:heading"><Instagram size={13} />Instagram {SOCIAL.instagram.label}</a></li>
              <li><a href={SOCIAL.youtube.href} target="_blank" rel="noreferrer" className="flex items-center gap-2 hover:heading"><Youtube size={13} />YouTube {SOCIAL.youtube.label}</a></li>
            </ul>
          </div>
          <div>
            <div className="text-xs uppercase tracking-wider muted mb-3"><T>Platforma</T></div>
            <ul className="space-y-1.5 muted">
              <li><Link href="/biz-haqimizda" className="hover:heading"><T>Biz haqimizda</T></Link></li>
              <li><Link href="#how" className="hover:heading"><T>Qanday ishlaydi</T></Link></li>
              <li><Link href="#categories" className="hover:heading"><T>Xizmatlar</T></Link></li>
            </ul>
          </div>
          <div>
            <div className="text-xs uppercase tracking-wider muted mb-3"><T>Hujjatlar</T></div>
            <ul className="space-y-1.5 muted">
              <li><Link href="/maxfiylik-siyosati" className="hover:heading"><T>Maxfiylik siyosati</T></Link></li>
              <li><Link href="/foydalanish-shartlari" className="hover:heading"><T>Foydalanish shartlari</T></Link></li>
              <li><Link href="/yordam" className="hover:heading"><T>Yordam markazi</T></Link></li>
            </ul>
          </div>
        </div>
        <div className="border-t" style={{ borderColor: "var(--border)" }}>
          <div className="mx-auto max-w-6xl px-4 py-4 text-xs muted text-center">
            © 2026 Ishchi Bormi · <T>Barcha huquqlar himoyalangan.</T>
          </div>
        </div>
      </footer>
    </div>
  );
}

/* ── helpers ───────────────────────────────────────── */

function Stat({ icon, value, label }: { icon: React.ReactNode; value: string; label: string }) {
  return (
    <div className="text-center">
      <div className="text-2xl sm:text-3xl font-extrabold heading flex items-center justify-center gap-1.5">{value}{icon}</div>
      <div className="text-xs muted mt-1"><T>{label}</T></div>
    </div>
  );
}

function SectionHeader({ eyebrow, title, subtitle }: { eyebrow?: string; title: string; subtitle?: string }) {
  return (
    <div className="text-center">
      {eyebrow && (
        <div className="text-xs uppercase tracking-[0.18em] font-semibold mb-2" style={{ color: "var(--accent)" }}>
          <T>{eyebrow}</T>
        </div>
      )}
      <h2 className="text-2xl sm:text-3xl font-extrabold heading tracking-tight"><T>{title}</T></h2>
      {subtitle && <p className="mt-2 text-sm muted max-w-xl mx-auto"><T>{subtitle}</T></p>}
    </div>
  );
}

function Pain({ icon, title, body }: { icon: React.ReactNode; title: string; body: string }) {
  return (
    <div className="card p-6 transition hover:-translate-y-0.5 hover:shadow-pop">
      <div className="h-11 w-11 grid place-items-center rounded-xl text-danger" style={{ background: "rgba(220,38,38,0.08)" }}>{icon}</div>
      <h3 className="mt-4 font-semibold heading"><T>{title}</T></h3>
      <p className="mt-1.5 text-sm muted"><T>{body}</T></p>
    </div>
  );
}

function HowCard({ title, steps }: { title: string; steps: [string, string][] }) {
  return (
    <div className="card p-6">
      <h3 className="font-semibold heading text-lg mb-4"><T>{title}</T></h3>
      <ol className="space-y-4">
        {steps.map(([k, v], i) => (
          <li key={k} className="flex gap-3">
            <span className="shrink-0 h-7 w-7 grid place-items-center rounded-full text-xs font-bold"
                  style={{ background: "var(--brand-soft)", color: "var(--brand)" }}>
              {i + 1}
            </span>
            <div>
              <div className="font-semibold heading text-sm"><T>{k}</T></div>
              <div className="text-sm muted mt-0.5"><T>{v}</T></div>
            </div>
          </li>
        ))}
      </ol>
    </div>
  );
}

function Cat({ icon, label }: { icon: React.ReactNode; label: string }) {
  return (
    <div className="card p-5 text-center grid gap-2 place-items-center transition hover:-translate-y-0.5 hover:shadow-pop cursor-pointer">
      <div className="h-11 w-11 grid place-items-center rounded-xl text-accent-amber" style={{ background: "var(--accent-soft)" }}>
        {icon}
      </div>
      <div className="text-sm font-medium heading"><T>{label}</T></div>
    </div>
  );
}

function Quote({ name, location, text }: { name: string; location: string; text: string }) {
  return (
    <div className="card p-6 animate-fade-in">
      <p className="text-sm leading-relaxed">"<T>{text}</T>"</p>
      <div className="mt-4 flex items-center gap-3 pt-4 border-t" style={{ borderColor: "var(--border)" }}>
        <Avatar name={name} size="sm" />
        <div>
          <div className="font-semibold heading text-sm">{name}</div>
          <div className="text-xs muted">{location}</div>
        </div>
      </div>
    </div>
  );
}

const SAMPLES = [
  { title: "Mebel tashish",      owner: "Alisher Rustamov",   location: "Toshkent, Sergeli",   price: 200000 },
  { title: "Hovli tozalash",     owner: "Malika Ahmedova",    location: "Samarqand",            price: 150000 },
  { title: "Santexnika xizmati", owner: "Jasur Bekmirzayev",  location: "Buxoro, G'ijduvon",   price: 250000 },
];
