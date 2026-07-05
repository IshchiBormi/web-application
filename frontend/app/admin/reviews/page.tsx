"use client";
import { useCallback, useEffect, useState } from "react";
import { api, Review, Paged } from "@/lib/api";
import { Modal } from "@/components/Modal";
import { Pagination } from "@/components/Pagination";

export default function AdminReviews() {
  const [data, setData] = useState<Paged<Review> | null>(null);
  const [page, setPage] = useState(1);
  const [delId, setDelId] = useState("");
  const limit = 20;

  const load = useCallback(async () => {
    setData(await api.get<Paged<Review>>(`/api/admin/reviews?page=${page}&limit=${limit}`, { auth: "admin" } as any));
  }, [page]);
  useEffect(() => { load(); }, [load]);

  async function del() {
    await api.delete(`/api/admin/reviews/${delId}`, { auth: "admin" } as any);
    setDelId("");
    load();
  }

  const total = data?.total ?? 0;
  const pages = Math.max(1, Math.ceil(total / limit));
  const items = data?.items ?? [];

  return (
    <div className="card p-4 grid gap-3">
      <div className="flex items-center justify-between gap-2">
        <div className="font-semibold text-sm">Sharhlar</div>
        <div className="text-sm text-[color:var(--text-muted)]">Jami: {total}</div>
      </div>

      <div className="-mx-4 px-4 overflow-x-auto scroll-y-auto">
        <table className="w-full min-w-[720px] text-sm">
          <thead><tr className="text-left text-[color:var(--text-muted)]"><th className="py-2">Baho</th><th>Yo'nalish</th><th>Izoh</th><th>Kimga</th><th>Sana</th><th></th></tr></thead>
          <tbody>
            {items.map((rv) => (
              <tr key={rv.id} className="border-t align-top" style={{ borderColor: "var(--border)" }}>
                <td className="py-2 whitespace-nowrap">★ {rv.rating}</td>
                <td className="whitespace-nowrap">{rv.direction === "employer_to_worker" ? "ishchiga" : "ish beruvchiga"}</td>
                <td className="max-w-[320px]">{rv.comment || <span className="text-[color:var(--text-muted)]">—</span>}</td>
                <td className="whitespace-nowrap">{rv.toUserId.slice(-6)}</td>
                <td className="whitespace-nowrap">{new Date(rv.createdAt).toLocaleDateString("uz-UZ")}</td>
                <td className="text-right"><button onClick={() => setDelId(rv.id)} className="btn-danger btn-sm">O'chirish</button></td>
              </tr>
            ))}
            {!items.length && <tr><td colSpan={6} className="py-6 text-center text-[color:var(--text-muted)]">Sharhlar yo'q</td></tr>}
          </tbody>
        </table>
      </div>

      <Pagination page={page} pages={pages} onPage={setPage} />

      <Modal open={!!delId} onClose={() => setDelId("")} title="Sharhni o'chirasizmi?" footer={
        <>
          <button onClick={() => setDelId("")} className="btn-secondary">Yo'q</button>
          <button onClick={del} className="btn-danger">Ha, o'chirish</button>
        </>
      }>
        <p className="text-sm muted">Sharh o'chiriladi va foydalanuvchi reytingi qayta hisoblanadi.</p>
      </Modal>
    </div>
  );
}
