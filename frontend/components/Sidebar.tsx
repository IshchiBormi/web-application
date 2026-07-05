"use client";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import {
  LayoutGrid, ListChecks, FileText, History,
  Settings, User as UserIcon, PlusCircle, LogOut, MessageSquareWarning,
} from "lucide-react";
import { useQuery } from "@tanstack/react-query";
import { api, User, setAccess, setRefresh } from "@/lib/api";
import { T } from "./T";

const items = [
  { href: "/dashboard", label: "Bosh sahifa", icon: LayoutGrid },
  { href: "/my-elons", label: "Mening e'lonlarim", icon: ListChecks },
  { href: "/process", label: "Jarayonlar", icon: FileText },
  { href: "/history", label: "Ishlar tarixi", icon: History },
  { href: "/feedback", label: "Taklif va shikoyatlar", icon: MessageSquareWarning },
  { href: "/settings", label: "Sozlamalar", icon: Settings },
  { href: "/profile", label: "Profil", icon: UserIcon },
];

export function Sidebar() {
  const pathname = usePathname();
  const router = useRouter();
  const { data: me } = useQuery<User>({ queryKey: ["me"], queryFn: () => api.get<User>("/api/me") });
  return (
    <aside className="card hidden md:flex md:flex-col gap-2 p-4 sticky top-4 h-[calc(100vh-2rem)]">
      <div className="px-2 mb-3">
        <div className="heading font-extrabold text-xl">Ishchi Bormi</div>
        <div className="text-xs muted"><T>Shaxsiy kabinet</T></div>
      </div>
      <nav className="flex-1 overflow-y-auto">
        {items.map(({ href, label, icon: Icon }) => {
          const active = pathname === href || pathname.startsWith(href + "/");
          return (
            <Link key={href} href={href} className={`sidenav-item ${active ? "sidenav-item-active" : ""}`}>
              <Icon size={18} className={active ? "heading" : "muted"} />
              <span className={active ? "heading" : ""}><T>{label}</T></span>
              {active && <span className="absolute right-0 top-1.5 bottom-1.5 w-1 rounded-l-md bg-brand-navy dark:bg-tg-blue" />}
            </Link>
          );
        })}
      </nav>
      <Link href="/elon/create" className="btn-primary w-full gap-2">
        <PlusCircle size={16} /><T>E'lon berish</T>
      </Link>
      {me && (
        <div className="mt-3 flex items-center gap-3 rounded-lg border p-2" style={{ borderColor: "var(--border)" }}>
          <div className="grid h-10 w-10 place-items-center rounded-full bg-brand-navy text-white text-sm font-semibold">
            {(me.firstName?.[0] || "?").toUpperCase()}
          </div>
          <div className="min-w-0">
            <div className="truncate text-sm font-medium">{me.firstName} {me.lastName}</div>
            <div className="text-xs text-[color:var(--text-muted)]">
              <T>Foydalanuvchi</T>
            </div>
          </div>
        </div>
      )}
      <button
        onClick={() => { setAccess(null); setRefresh(null); router.push("/login"); }}
        className="sidenav-item text-danger"
      >
        <LogOut size={18} /><T>Chiqish</T>
      </button>
    </aside>
  );
}
