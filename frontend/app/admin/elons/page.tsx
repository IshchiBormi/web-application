"use client";
import { useCallback, useEffect, useState } from "react";
import { api, Elon, Category, Paged, downloadAdminCsv } from "@/lib/api";
import { Modal } from "@/components/Modal";
import { Pagination } from "@/components/Pagination";

const STATUSES = ["recruiting", "filled", "in_progress", "completed", "cancelled", "hidden"];

export default function AdminElons() {
  const [data, setData] = useState<Paged<Elon> | null>(null);
  const [cats, setCats] = useState<Category[]>([]);
  const [page, setPage] = useState(1);
  const [q, setQ] = useState("");
  const [status, setStatus] = useState("");
  const [categoryId, setCategoryId] = useState("");
  const [region, setRegion] = useState("");
  const [delId, setDelId] = useState("");
  const limit = 20;

  const load = useCallback(async () => {
    const params = new URLSearchParams({ page: String(page), limit: String(limit) });
    if (q.trim()) params.set("q", q.trim());
    if (status) params.set("status", status);
    if (categoryId) params.set("categoryId", categoryId);
    if (region.trim()) params.set("region", region.trim());
    setData(await api.get<Paged<Elon>>(`/api/admin/elons?${params}`, { auth: "admin" } as any));
  }, [page, q, status, categoryId, region]);

  useEffect(() => { load(); }, [load]);
  useEffect(() => { setPage(1); }, [q, status, categoryId, region]);
  useEffect(() => { api.get<Category[]>("/api/admin/categories", { auth: "admin" } as any).then(setCats).catch(() => {}); }, []);

  async function setStatusOf(id: string, s: string) {
    await api.patch(`/api/admin/elons/${id}/status`, { status: s }, { auth: "admin" } as any);
    load();
  }
  async function del() {
    await api.delete(`/api/admin/elons/${delId}`, { auth: "admin" } as any);
    setDelId("");
    load();
  }
  function exportCsv() {
    const params = new URLSearchParams();
    if (q.trim()) params.set("q", q.trim());
    if (status) params.set("status", status);
    if (categoryId) params.set("categoryId", categoryId);
    if (region.trim()) params.set("region", region.trim());
    downloadAdminCsv("/api/admin/export/elons.csv", params);
  }

  const total = data?.total ?? 0;
  const pages = Math.max(1, Math.ceil(total / limit));
  const elons = data?.items ?? [];

  return (
    <div className="card p-4 grid gap-3">
      <div className="flex flex-wrap gap-2 items-center">
        <input className="input max-w-[220px]" placeholder="Sarlavha…" value={q} onChange={(e) => setQ(e.target.value)} />
        <select className="input max-w-[160px]" value={status} onChange={(e) => setStatus(e.target.value)}>
          <option value="">Holat (barchasi)</option>
          {STATUSES.map((s) => <option key={s} value={s}>{s}</option>)}
        </select>
        <select className="input max-w-[180px]" value={categoryId} onChange={(e) => setCategoryId(e.target.value)}>
          <option value="">Turkum (barchasi)</option>
          {cats.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
        </select>
        <input className="input max-w-[150px]" placeholder="Viloyat" value={region} onChange={(e) => setRegion(e.target.value)} />
        <button onClick={exportCsv} className="btn-secondary btn-sm ml-auto">CSV yuklab olish</button>
        <div className="text-sm text-[color:var(--text-muted)]">Jami: {total}</div>
      </div>

      <div className="-mx-4 px-4 overflow-x-auto scroll-y-auto">
        <table className="w-full min-w-[820px] text-sm">
          <thead><tr className="text-left text-[color:var(--text-muted)]"><th className="py-2">Sarlavha</th><th>Turkum</th><th>Holat</th><th>Ishchilar</th><th>Narx</th><th></th></tr></thead>
          <tbody>
            {elons.map((e) => (
              <tr key={e.id} className="border-t" style={{ borderColor: "var(--border)" }}>
                <td className="py-2">{e.title}</td>
                <td>{e.categoryName}</td>
                <td>{e.status === "hidden" ? <span className="text-danger">yashirilgan</span> : e.status}</td>
                <td>{e.workersNeeded}</td>
                <td className="whitespace-nowrap">{e.priceAmount.toLocaleString("uz-UZ")}</td>
                <td>
                  <div className="flex flex-wrap gap-2 justify-end">
                    {e.status === "hidden"
                      ? <button onClick={() => setStatusOf(e.id, "recruiting")} className="btn-secondary btn-sm">Tiklash</button>
                      : <button onClick={() => setStatusOf(e.id, "hidden")} className="btn-secondary btn-sm">Yashirish</button>}
                    <button onClick={() => setDelId(e.id)} className="btn-danger btn-sm">O'chirish</button>
                  </div>
                </td>
              </tr>
            ))}
            {!elons.length && <tr><td colSpan={6} className="py-6 text-center text-[color:var(--text-muted)]">Hech narsa topilmadi</td></tr>}
          </tbody>
        </table>
      </div>

      <Pagination page={page} pages={pages} onPage={setPage} />

      <Modal open={!!delId} onClose={() => setDelId("")} title="E'lonni o'chirasizmi?" footer={
        <>
          <button onClick={() => setDelId("")} className="btn-secondary">Yo'q</button>
          <button onClick={del} className="btn-danger">Ha, o'chirish</button>
        </>
      }>
        <p className="text-sm muted">E'lon o'chiriladi. Davom etasizmi?</p>
      </Modal>
    </div>
  );
}
