"use client";
import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { Send, ShieldCheck, Clock, MessageSquareText } from "lucide-react";
import { api, setAccess, setRefresh, User } from "@/lib/api";
import { Button } from "@/components/ui/Button";
import { T, useT } from "@/components/T";
import { ScriptToggle } from "@/components/ScriptToggle";
import { ThemeToggle } from "@/components/ThemeToggle";

type Req = { tgToken: string; botUrl: string; devCode?: string };
type Verify = { accessToken: string; refreshToken: string; user: User };

export default function LoginPage() {
  const router = useRouter();
  const t = useT();
  const [tgToken, setTgToken] = useState("");
  const [botUrl, setBotUrl] = useState("");
  const [code, setCode] = useState("");
  const [error, setError] = useState("");
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    api.post<Req>("/api/auth/otp/request", {}).then((r) => {
      setTgToken(r.tgToken); setBotUrl(r.botUrl);
    }).catch(() => {
      setError("Serverga ulanib bo'lmadi. Birozdan so'ng qayta urinib ko'ring.");
    });
    // Faqat bir marta ishlaydi (mount'da). `t` bilan bog'lamaymiz — u har
    // renderda yangi funksiya, aks holda OTP so'rovi takrorlanib ketadi.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Backend botUrl'ni bermasa (username sozlanmagan bo'lsa), token va ochiq
  // bot username'idan zaxira havola quramiz. NEXT_PUBLIC_BOT_USERNAME sozlanmagan
  // bo'lsa, rasmiy auth bot (@Ishchi_bormi_auth_bot) default sifatida ishlatiladi.
  const botUsername = process.env.NEXT_PUBLIC_BOT_USERNAME || "Ishchi_bormi_auth_bot";
  const effectiveBotUrl =
    botUrl || (tgToken && botUsername ? `https://t.me/${botUsername}?start=${tgToken}` : "");

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setError("");
    if (code.length < 6) return;
    setSubmitting(true);
    try {
      const v = await api.post<Verify>("/api/auth/otp/verify", { token: tgToken, code });
      setAccess(v.accessToken); setRefresh(v.refreshToken);
      router.replace(v.user.onboardingCompleted ? "/dashboard" : "/onboarding");
    } catch (err: any) {
      setError(err?.message || t("Kod noto'g'ri yoki muddati o'tgan"));
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="min-h-screen flex flex-col">
      <header className="border-b" style={{ borderColor: "var(--border)", background: "var(--card)" }}>
        <div className="mx-auto max-w-6xl flex items-center justify-between px-6 py-3.5">
          <Link href="/" className="font-extrabold text-xl heading tracking-tight">Ishchi Bormi</Link>
          <div className="flex items-center gap-2">
            <ScriptToggle />
            <ThemeToggle />
          </div>
        </div>
      </header>

      <main className="flex-1 grid place-items-center px-4 py-10">
        <div className="grid lg:grid-cols-2 gap-6 lg:gap-12 items-center w-full max-w-5xl">
          {/* Left: marketing */}
          <div className="hidden lg:block animate-fade-in">
            <h2 className="text-3xl font-extrabold heading leading-tight tracking-tight">
              <T>Ishonchli ish va ishonchli ishchi — bir necha daqiqada</T>
            </h2>
            <p className="mt-3 text-sm muted">
              <T>Telegram orqali xavfsiz kirish. Hech qanday parol, hech qanday murakkablik.</T>
            </p>
            <ul className="mt-6 grid gap-3">
              <Feature icon={<ShieldCheck size={16} />} title="Tasdiqlangan profillar" body="Har bir foydalanuvchi telefon raqami orqali tasdiqlangan." />
              <Feature icon={<Clock size={16} />} title="Tez login" body="Faqat 6 xonali kod — parol talab qilinmaydi." />
              <Feature icon={<MessageSquareText size={16} />} title="To'g'ridan-to'g'ri aloqa" body="Vositachilarsiz — telefon orqali bevosita bog'laning." />
            </ul>
          </div>

          {/* Right: login card */}
          <form
            onSubmit={submit}
            className="card-elevated w-full p-7 sm:p-9 animate-slide-up"
          >
            <div className="flex items-center justify-center h-12 w-12 rounded-2xl mx-auto" style={{ background: "var(--brand-soft)", color: "var(--brand)" }}>
              <Send size={22} />
            </div>
            <h1 className="mt-4 text-center text-2xl font-extrabold heading tracking-tight">
              <T>Telegram orqali kirish</T>
            </h1>
            <p className="mt-1.5 text-center text-sm muted">
              <T>3 ta oddiy qadamda hisobingizga kiring</T>
            </p>

            {/* Steps */}
            <ol className="mt-6 surface p-4 rounded-xl space-y-3">
              <Step n={1}><T>Pastdagi tugma orqali Telegram botga o'ting</T></Step>
              <Step n={2}><T>"Start" tugmasini bosib, telefon raqamingizni yuboring</T></Step>
              <Step n={3}><T>Bot yuborgan 6 xonali kodni bu yerga kiriting</T></Step>
            </ol>

            {/* TG button */}
            <a
              href={effectiveBotUrl || "#"}
              target="_blank"
              rel="noreferrer"
              onClick={(e) => { if (!effectiveBotUrl) e.preventDefault(); }}
              className="btn btn-tg btn-lg w-full mt-5 gap-2"
            >
              <Send size={16} /><T>Telegram botga o'tish</T>
            </a>

            {/* OTP input */}
            <div className="mt-6">
              <label className="text-sm font-medium heading"><T>Tasdiqlash kodi</T></label>
              <input
                inputMode="numeric"
                pattern="\d{6}"
                maxLength={6}
                value={code}
                onChange={(e) => setCode(e.target.value.replace(/\D/g, "").slice(0, 6))}
                placeholder="• • • • • •"
                className="input mt-2 text-center tracking-[0.7em] text-2xl font-bold py-3.5"
                style={{ fontFamily: "ui-monospace, SFMono-Regular, Menlo, monospace" }}
              />
              {error && (
                <div className="mt-2 text-sm text-danger flex items-center gap-1.5 animate-fade-in">
                  <span className="h-1.5 w-1.5 rounded-full bg-danger" />{error}
                </div>
              )}
            </div>

            <Button
              type="submit"
              size="lg"
              fullWidth
              className="mt-4"
              disabled={code.length < 6}
              loading={submitting}
            >
              {submitting ? <T>Tekshirilmoqda…</T> : <T>Kirish</T>}
            </Button>

            <p className="mt-4 text-center text-xs muted">
              <T>Kirish orqali siz</T>{" "}
              <Link href="/foydalanish-shartlari" className="heading underline-offset-2 hover:underline"><T>Foydalanish shartlari</T></Link>{" "}
              <T>va</T>{" "}
              <Link href="/maxfiylik-siyosati" className="heading underline-offset-2 hover:underline"><T>Maxfiylik siyosati</T></Link>{" "}
              <T>ga rozilik bildirasiz.</T>
            </p>
          </form>
        </div>
      </main>

      <footer className="border-t" style={{ borderColor: "var(--border)", background: "var(--card)" }}>
        <div className="mx-auto max-w-6xl px-6 py-4 flex flex-col sm:flex-row justify-between gap-2 text-sm muted">
          <div>© 2026 Ishchi Bormi</div>
          <div className="flex gap-5">
            <Link href="/yordam"><T>Yordam</T></Link>
            <Link href="/maxfiylik-siyosati"><T>Maxfiylik siyosati</T></Link>
          </div>
        </div>
      </footer>
    </div>
  );
}

function Step({ n, children }: { n: number; children: React.ReactNode }) {
  return (
    <li className="flex gap-3 text-sm">
      <span className="shrink-0 grid h-6 w-6 place-items-center rounded-full text-[11px] font-bold" style={{ background: "var(--brand)", color: "#fff" }}>{n}</span>
      <span className="leading-relaxed">{children}</span>
    </li>
  );
}

function Feature({ icon, title, body }: { icon: React.ReactNode; title: string; body: string }) {
  return (
    <li className="flex gap-3">
      <span className="shrink-0 h-9 w-9 grid place-items-center rounded-xl" style={{ background: "var(--accent-soft)", color: "var(--accent)" }}>{icon}</span>
      <div>
        <div className="font-semibold heading text-sm"><T>{title}</T></div>
        <div className="text-xs muted mt-0.5"><T>{body}</T></div>
      </div>
    </li>
  );
}
