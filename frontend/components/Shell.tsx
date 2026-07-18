"use client";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import {
  LayoutGrid, ListChecks, Briefcase, History,
  Settings, User as UserIcon, PlusCircle, LogOut, Bell as BellIcon,
  MessageSquareWarning, Menu, Search,
} from "lucide-react";
import { api, getAccess, Notification, setAccess, User } from "@/lib/api";
import { T, useT } from "@/components/T";
import { ScriptToggle } from "@/components/ScriptToggle";
import { ThemeToggle } from "@/components/ThemeToggle";
import { Avatar } from "@/components/ui/Avatar";

const NAV: { href: string; label: string; icon: any }[] = [
  { href: "/dashboard",     label: "Bosh sahifa",         icon: LayoutGrid },
  { href: "/my-elons",      label: "Mening e'lonlarim",   icon: ListChecks },
  { href: "/process",       label: "Jarayonlar",          icon: Briefcase },
  { href: "/history",       label: "Ishlar tarixi",       icon: History },
  { href: "/feedback",      label: "Taklif va shikoyatlar", icon: MessageSquareWarning },
  { href: "/settings",      label: "Sozlamalar",          icon: Settings },
  { href: "/profile",       label: "Profil",              icon: UserIcon },
];

export function Shell({ title, search, children }: { title: string; search?: React.ReactNode; children: React.ReactNode }) {
  const router = useRouter();
  const pathname = usePathname();
  const t = useT();
  const qc = useQueryClient();
  const [drawer, setDrawer] = useState(false);

  // Auth gate
  useEffect(() => { if (!getAccess()) router.replace("/login"); }, [router]);

  const { data: me, isError: meError } = useQuery<User>({ queryKey: ["me"], queryFn: () => api.get<User>("/api/me"), retry: false });

  // Sessiya tugagan bo'lsa /api/me 401 (yoki hisob o'chirilgan bo'lsa 403
  // account_disabled) qaytaradi va api.ts tokenlarni tozalaydi. Token
  // tozalangan bo'lsa (getAccess() null) — foydalanuvchini login sahifasiga
  // yo'naltiramiz. Boshqa (masalan server) xatolarida bu ishlamaydi.
  //
  // qc.clear() shart: aks holda react-query keshidagi eski `me` saqlanib
  // qoladi va o'sha brauzerda yangi hisobga kirilganda profil bir zumga eski
  // ism-familiyani ko'rsatib yuboradi.
  useEffect(() => {
    if (meError && !getAccess()) {
      qc.clear();
      router.replace("/login");
    }
  }, [meError, router, qc]);
  const { data: notifs } = useQuery<Notification[]>({
    queryKey: ["notifications"],
    queryFn: () => api.get<Notification[]>("/api/notifications"),
    refetchInterval: 30000,
  });
  const unread = (notifs || []).filter((n) => !n.isRead).length;
  // "Jarayonlar" bo'limi uchun qizil nuqta: ariza bilan bog'liq (yangi ariza,
  // qabul/rad/bekor, yakunlash) o'qilmagan bildirishnoma bormi.
  const processDot = (notifs || []).some((n) => !n.isRead && n.relatedEntity?.type === "application");

  // onboarding redirect
  useEffect(() => {
    if (me && !me.onboardingCompleted && pathname && !pathname.startsWith("/onboarding")) {
      router.replace("/onboarding");
    }
  }, [me, pathname, router]);

  function logout() {
    setAccess(null);
    // Oldingi sessiyaning keshlangan ma'lumotlari (profil, bildirishnomalar,
    // ro'yxatlar) yangi/keyingi foydalanuvchida ko'rinib qolmasligi uchun.
    qc.clear();
    router.replace("/login");
  }

  const sidebar = (
    <aside className="card flex flex-col gap-3 p-4 h-full">
      <div className="px-1 mb-1">
        <div className="font-extrabold text-xl heading tracking-tight">Ishchi Bormi</div>
        <div className="text-xs muted mt-0.5"><T>Shaxsiy kabinet</T></div>
      </div>

      <Link href="/elon/create" className="btn btn-primary justify-center gap-2 mt-1">
        <PlusCircle size={16} /><T>E'lon berish</T>
      </Link>

      <nav className="flex-1 overflow-y-auto scroll-y-auto -mx-1 px-1 mt-2">
        {NAV.map(({ href, label, icon: Icon }) => {
          const active = pathname === href || pathname.startsWith(href + "/");
          return (
            <Link
              key={href}
              href={href}
              onClick={() => setDrawer(false)}
              className={`sidenav-item ${active ? "sidenav-item-active" : ""}`}
            >
              <Icon size={17} />
              <span className="flex-1"><T>{label}</T></span>
              {href === "/notifications" && unread > 0 && (
                <span className="badge-amber">{unread}</span>
              )}
              {href === "/process" && processDot && (
                <span className="h-2.5 w-2.5 rounded-full bg-danger ring-2 ring-[color:var(--card)]" aria-label={t("yangi faoliyat")} />
              )}
            </Link>
          );
        })}
      </nav>

      {me && (
        <Link href="/profile" className="flex items-center gap-3 rounded-xl p-2 surface hover:opacity-90 transition">
          <Avatar name={`${me.firstName} ${me.lastName}`} src={me.avatarUrl} />
          <div className="min-w-0 flex-1">
            <div className="text-sm font-semibold truncate heading">{me.firstName} {me.lastName}</div>
            <div className="text-xs muted">
              <T>Foydalanuvchi</T>
            </div>
          </div>
        </Link>
      )}

      <button onClick={logout} className="sidenav-item text-danger">
        <LogOut size={17} /><T>Chiqish</T>
      </button>
    </aside>
  );

  return (
    <div className="min-h-screen">
      <div className="mx-auto max-w-[1280px] grid grid-cols-1 md:grid-cols-[260px_1fr] gap-4 p-4">
        {/* Desktop sidebar */}
        <div className="hidden md:block sticky top-4 h-[calc(100vh-2rem)]">{sidebar}</div>

        {/* Mobile drawer */}
        {drawer && (
          <div className="fixed inset-0 z-50 md:hidden">
            <div className="absolute inset-0 bg-black/40 animate-fade-in" onClick={() => setDrawer(false)} />
            <div className="relative w-[280px] h-full bg-[color:var(--bg)] p-4 animate-slide-up">
              {sidebar}
            </div>
          </div>
        )}

        <main className="flex flex-col gap-4 min-w-0 animate-fade-in">
          {/* Topbar */}
          <div className="card flex items-center gap-3 p-3 sticky top-4 z-30">
            <button onClick={() => setDrawer(true)} className="md:hidden p-2 rounded-lg hover:bg-[color:var(--bg-subtle)]">
              <Menu size={18} />
            </button>
            <h1 className="text-lg sm:text-xl font-bold heading leading-tight truncate min-w-0"><T>{title}</T></h1>
            {search && <div className="hidden md:block flex-1 max-w-md mx-2">{search}</div>}
            <div className="ml-auto flex items-center gap-2">
              <ScriptToggle />
              <ThemeToggle />
              <Link
                href="/notifications"
                className="relative grid h-9 w-9 place-items-center rounded-lg border hover:bg-[color:var(--bg-subtle)] transition"
                style={{ borderColor: "var(--border-strong)" }}
                aria-label={t("Bildirishnomalar")}
              >
                <BellIcon size={17} />
                {unread > 0 && (
                  <span className="absolute -top-0.5 -right-0.5 min-w-[16px] h-4 px-1 grid place-items-center rounded-full bg-danger text-white text-[10px] font-bold ring-2 ring-[color:var(--card)]">
                    {unread > 9 ? "9+" : unread}
                  </span>
                )}
              </Link>
              <Link
                href="/profile"
                className="hidden sm:flex items-center gap-2 rounded-lg border pl-1 pr-3 py-1 hover:bg-[color:var(--bg-subtle)] transition"
                style={{ borderColor: "var(--border-strong)" }}
              >
                <Avatar name={me ? `${me.firstName} ${me.lastName}` : ""} src={me?.avatarUrl} size="sm" />
                <span className="text-sm font-medium"><T>Mening profilim</T></span>
              </Link>
            </div>
          </div>

          {search && <div className="md:hidden">{search}</div>}

          {children}
        </main>
      </div>
    </div>
  );
}

/* ── Compact search input used in topbar ── */
export function ShellSearch({ value, onChange, placeholder }: { value: string; onChange: (v: string) => void; placeholder?: string }) {
  return (
    <div className="relative">
      <Search size={16} className="absolute left-3 top-1/2 -translate-y-1/2 muted" />
      <input
        className="input pl-10 py-2.5"
        placeholder={placeholder}
        value={value}
        onChange={(e) => onChange(e.target.value)}
      />
    </div>
  );
}
