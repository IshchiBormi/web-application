"use client";
import { useCallback, useEffect, useState } from "react";
import { api, Application, AdminStats, Paged, downloadAdminCsv } from "@/lib/api";
import { Pagination } from "@/components/Pagination";

const STATUSES = ["pending", "accepted", "rejected", "cancelled", "completed"];
const STATUS_LABEL: Record<string, string> = {
  pending: "Kutilmoqda", accepted: "Qabul qilingan", rejected: "Rad etilgan",
  cancelled: "Bekor qilingan", completed: "Bajarilgan",
};

export default function AdminApplications() {
  const [data, setData] = useState<Paged<Application> | null>(null);
  const [funnel, setFunnel] = useState<Record<string, number>>({});
  const [page, setPage] = useState(1);
  const [status, setStatus] = useState("");
  const [stale, setStale] = useState(false);
  const limit = 20;

  const load = useCallback(async () => {
    const params = new URLSearchParams({ page: String(page), limit: String(limit) });
    if (status) params.set("status", status);
    if (stale) params.set("stale", "1");
    setData(await api.get<Paged<Application>>(`/api/admin/applications?${params}`, { auth: "admin" } as any));
  }, [page, status, stale]);

  useEffect(() => { load(); }, [load]);
  useEffect(() => { setPage(1); }, [status, stale]);
  useEffect(() => {
    api.get<AdminStats>("/api/admin/stats", { auth: "admin" } as any).then((s) => setFunnel(s.funnel || {})).catch(() => {});
  }, []);

  function exportCsv() {
    const params = new URLSearchParams();
    if (status) params.set("status", status);
    if (stale) params.set("stale", "1");
    downloadAdminCsv("/api/admin/export/applications.csv", params);
  }

  const total = data?.total ?? 0;
  const pages = Math.max(1, Math.ceil(total / limit));
  const items = data?.items ?? [];
  const sum = STATUSES.reduce((a, s) => a + (funnel[s] || 0), 0);

  return (
    <div className="grid gap-4">
      {/* Voronka */}
      <div className="grid grid-cols-2 sm:grid-cols-5 gap-3">
        {STATUSES.map((s) => (
          <button
            key={s}
            onClick={() => setStatus(status === s ? "" : s)}
            className={`card p-3 text-left transition ${status === s ? "ring-2 ring-brand-navy" : ""}`}
          >
            <div className="text-xs text-[color:var(--text-muted)]">{STATUS_LABEL[s]}</div>
            <div className="text-xl font-bold mt-1">{funnel[s] ?? 0}</div>
            <div className="text-[10px] text-[color:var(--text-muted)]">{sum ? Math.round(((funnel[s] || 0) / sum) * 100) : 0}%</div>
          </button>
        ))}
      </div>

      <div className="card p-4 grid gap-3">
        <div className="flex flex-wrap gap-2 items-center">
          <select className="input max-w-[180px]" value={status} onChange={(e) => setStatus(e.target.value)}>
            <option value="">Holat (barchasi)</option>
            {STATUSES.map((s) => <option key={s} value={s}>{STATUS_LABEL[s]}</option>)}
          </select>
          <label className="text-sm flex items-center gap-2">
            <input type="checkbox" checked={stale} onChange={(e) => setStale(e.target.checked)} /> Uzoq kutayotgan (3+ kun)
          </label>
          <button onClick={exportCsv} className="btn-secondary btn-sm ml-auto">CSV yuklab olish</button>
          <div className="text-sm text-[color:var(--text-muted)]">Jami: {total}</div>
        </div>

        <div className="-mx-4 px-4 overflow-x-auto scroll-y-auto">
          <table className="w-full min-w-[820px] text-sm">
            <thead><tr className="text-left text-[color:var(--text-muted)]"><th className="py-2">E'lon</th><th>Ishchi</th><th>Summa</th><th>Holat</th><th>Yuborilgan</th></tr></thead>
            <tbody>
              {items.map((a) => (
                <tr key={a.id} className="border-t" style={{ borderColor: "var(--border)" }}>
                  <td className="py-2">{a.elonTitle}</td>
                  <td className="whitespace-nowrap">{a.workerName || a.workerPhone}</td>
                  <td className="whitespace-nowrap">{a.isNegotiable ? "kelishuv" : a.amount.toLocaleString("uz-UZ")}</td>
                  <td>{STATUS_LABEL[a.status] || a.status}</td>
                  <td className="whitespace-nowrap">{new Date(a.appliedAt).toLocaleDateString("uz-UZ")}</td>
                </tr>
              ))}
              {!items.length && <tr><td colSpan={5} className="py-6 text-center text-[color:var(--text-muted)]">Ariza topilmadi</td></tr>}
            </tbody>
          </table>
        </div>

        <Pagination page={page} pages={pages} onPage={setPage} />
      </div>
    </div>
  );
}
