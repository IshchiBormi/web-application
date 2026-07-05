"use client";
import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { api, User, Paged, downloadAdminCsv } from "@/lib/api";
import { Modal } from "@/components/Modal";
import { Pagination } from "@/components/Pagination";

export default function AdminUsers() {
  const [data, setData] = useState<Paged<User> | null>(null);
  const [page, setPage] = useState(1);
  const [q, setQ] = useState("");
  const [region, setRegion] = useState("");
  const [blocked, setBlocked] = useState("");
  const [verified, setVerified] = useState("");
  const [delId, setDelId] = useState("");
  const limit = 20;

  const load = useCallback(async () => {
    const params = new URLSearchParams({ page: String(page), limit: String(limit) });
    if (q.trim()) params.set("q", q.trim());
    if (region.trim()) params.set("region", region.trim());
    if (blocked) params.set("blocked", blocked);
    if (verified) params.set("verified", verified);
    setData(await api.get<Paged<User>>(`/api/admin/users?${params}`, { auth: "admin" } as any));
  }, [page, q, region, blocked, verified]);

  useEffect(() => { load(); }, [load]);
  // Filtr o'zgarsa 1-sahifaga qaytamiz.
  useEffect(() => { setPage(1); }, [q, region, blocked, verified]);

  async function block(id: string, isBlocked: boolean) {
    await api.post(`/api/admin/users/${id}/block`, { isBlocked }, { auth: "admin" } as any);
    load();
  }
  async function del() {
    await api.delete(`/api/admin/users/${delId}`, { auth: "admin" } as any);
    setDelId("");
    load();
  }
  function exportCsv() {
    const params = new URLSearchParams();
    if (q.trim()) params.set("q", q.trim());
    if (region.trim()) params.set("region", region.trim());
    if (blocked) params.set("blocked", blocked);
    if (verified) params.set("verified", verified);
    downloadAdminCsv("/api/admin/export/users.csv", params);
  }

  const total = data?.total ?? 0;
  const pages = Math.max(1, Math.ceil(total / limit));
  const users = data?.items ?? [];

  return (
    <div className="card p-4 grid gap-3">
      {/* Filtrlar */}
      <div className="flex flex-wrap gap-2 items-center">
        <input className="input max-w-[220px]" placeholder="Ism yoki telefon…" value={q} onChange={(e) => setQ(e.target.value)} />
        <input className="input max-w-[160px]" placeholder="Viloyat" value={region} onChange={(e) => setRegion(e.target.value)} />
        <select className="input max-w-[150px]" value={blocked} onChange={(e) => setBlocked(e.target.value)}>
          <option value="">Holat (barchasi)</option>
          <option value="0">Faol</option>
          <option value="1">Bloklangan</option>
        </select>
        <select className="input max-w-[150px]" value={verified} onChange={(e) => setVerified(e.target.value)}>
          <option value="">Tasdiq (barchasi)</option>
          <option value="1">Tasdiqlangan</option>
          <option value="0">Tasdiqlanmagan</option>
        </select>
        <button onClick={exportCsv} className="btn-secondary btn-sm ml-auto">CSV yuklab olish</button>
        <div className="text-sm text-[color:var(--text-muted)]">Jami: {total}</div>
      </div>

      <div className="-mx-4 px-4 overflow-x-auto scroll-y-auto">
        <table className="w-full min-w-[820px] text-sm">
          <thead><tr className="text-left text-[color:var(--text-muted)]"><th className="py-2">Ism</th><th>Telefon</th><th>Viloyat</th><th>Reyting</th><th>Holat</th><th></th></tr></thead>
          <tbody>
            {users.map((u) => (
              <tr key={u.id} className="border-t" style={{ borderColor: "var(--border)" }}>
                <td className="py-2 whitespace-nowrap">
                  <Link href={`/admin/users/${u.id}`} className="hover:underline font-medium">{u.firstName} {u.lastName}</Link>
                </td>
                <td className="whitespace-nowrap">{u.phone}</td>
                <td>{u.region}</td>
                <td>{u.rating.toFixed(1)}</td>
                <td>{u.isBlocked ? <span className="text-danger">bloklangan</span> : "faol"}</td>
                <td>
                  <div className="flex flex-wrap gap-2 justify-end">
                    <Link href={`/admin/users/${u.id}`} className="btn-secondary btn-sm">Batafsil</Link>
                    <button onClick={() => block(u.id, !u.isBlocked)} className="btn-secondary btn-sm">{u.isBlocked ? "Ochish" : "Bloklash"}</button>
                    <button onClick={() => setDelId(u.id)} className="btn-danger btn-sm">O'chirish</button>
                  </div>
                </td>
              </tr>
            ))}
            {!users.length && <tr><td colSpan={6} className="py-6 text-center text-[color:var(--text-muted)]">Hech narsa topilmadi</td></tr>}
          </tbody>
        </table>
      </div>

      <Pagination page={page} pages={pages} onPage={setPage} />

      <Modal open={!!delId} onClose={() => setDelId("")} title="Foydalanuvchini o'chirasizmi?" footer={
        <>
          <button onClick={() => setDelId("")} className="btn-secondary">Yo'q</button>
          <button onClick={del} className="btn-danger">Ha, o'chirish</button>
        </>
      }>
        <p className="text-sm muted">Foydalanuvchi o'chiriladi. Davom etasizmi?</p>
      </Modal>
    </div>
  );
}
