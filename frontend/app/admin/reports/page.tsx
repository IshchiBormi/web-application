"use client";
import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { api, Paged } from "@/lib/api";
import { Pagination } from "@/components/Pagination";

interface ReportRow {
  id: string; reporterId: string; targetType: string; targetId: string;
  reason: string; description?: string; status: string; createdAt: string;
  targetLabel: string; targetOwnerId?: string; reporterName?: string;
}

const STATUS_LABEL: Record<string, string> = { open: "Ochiq", resolved: "Hal qilingan", dismissed: "Rad etilgan" };

export default function AdminReports() {
  const [data, setData] = useState<Paged<ReportRow> | null>(null);
  const [page, setPage] = useState(1);
  const [status, setStatus] = useState("open");
  const limit = 20;

  const load = useCallback(async () => {
    const params = new URLSearchParams({ page: String(page), limit: String(limit) });
    if (status) params.set("status", status);
    setData(await api.get<Paged<ReportRow>>(`/api/admin/reports?${params}`, { auth: "admin" } as any));
  }, [page, status]);
  useEffect(() => { load(); }, [load]);
  useEffect(() => { setPage(1); }, [status]);

  async function resolve(id: string, s: string) {
    await api.patch(`/api/admin/reports/${id}/resolve`, { status: s }, { auth: "admin" } as any);
    load();
  }
  async function blockUser(id: string) {
    await api.post(`/api/admin/users/${id}/block`, { isBlocked: true }, { auth: "admin" } as any);
    load();
  }
  async function hideElon(id: string) {
    await api.patch(`/api/admin/elons/${id}/status`, { status: "hidden" }, { auth: "admin" } as any);
    load();
  }
  async function deleteElon(id: string) {
    await api.delete(`/api/admin/elons/${id}`, { auth: "admin" } as any);
    load();
  }

  const total = data?.total ?? 0;
  const pages = Math.max(1, Math.ceil(total / limit));
  const items = data?.items ?? [];

  return (
    <div className="card p-4 grid gap-3">
      <div className="flex flex-wrap gap-2 items-center">
        <select className="input max-w-[180px]" value={status} onChange={(e) => setStatus(e.target.value)}>
          <option value="open">Ochiq</option>
          <option value="resolved">Hal qilingan</option>
          <option value="dismissed">Rad etilgan</option>
          <option value="">Barchasi</option>
        </select>
        <div className="text-sm text-[color:var(--text-muted)] ml-auto">Jami: {total}</div>
      </div>

      <div className="-mx-4 px-4 overflow-x-auto scroll-y-auto">
        <table className="w-full min-w-[880px] text-sm">
          <thead><tr className="text-left text-[color:var(--text-muted)]"><th className="py-2">Sabab</th><th>Nishon</th><th>Kimdan</th><th>Holat</th><th>Sana</th><th></th></tr></thead>
          <tbody>
            {items.map((r) => (
              <tr key={r.id} className="border-t align-top" style={{ borderColor: "var(--border)" }}>
                <td className="py-2 max-w-[220px]">
                  <div className="font-medium">{r.reason}</div>
                  {r.description && <div className="text-xs text-[color:var(--text-muted)]">{r.description}</div>}
                </td>
                <td className="max-w-[220px]">
                  <span className="text-[10px] uppercase px-1.5 py-0.5 rounded bg-black/10 mr-1">{r.targetType}</span>
                  {r.targetType === "user" && <Link href={`/admin/users/${r.targetId}`} className="hover:underline">{r.targetLabel}</Link>}
                  {r.targetType === "elon" && <span>{r.targetLabel}</span>}
                  {r.targetType === "message" && <span className="text-[color:var(--text-muted)]">{r.targetLabel}</span>}
                </td>
                <td className="whitespace-nowrap">{r.reporterName || r.reporterId.slice(-6)}</td>
                <td>{STATUS_LABEL[r.status] || r.status}</td>
                <td className="whitespace-nowrap">{new Date(r.createdAt).toLocaleDateString("uz-UZ")}</td>
                <td>
                  <div className="flex flex-wrap gap-1.5 justify-end">
                    {r.targetType === "user" && <button onClick={() => blockUser(r.targetId)} className="btn-secondary btn-sm">Bloklash</button>}
                    {r.targetType === "elon" && <>
                      <button onClick={() => hideElon(r.targetId)} className="btn-secondary btn-sm">Yashirish</button>
                      <button onClick={() => deleteElon(r.targetId)} className="btn-danger btn-sm">O'chirish</button>
                      {r.targetOwnerId && <Link href={`/admin/users/${r.targetOwnerId}`} className="btn-secondary btn-sm">Egasi</Link>}
                    </>}
                    {r.status === "open" && <>
                      <button onClick={() => resolve(r.id, "resolved")} className="btn-primary btn-sm">Hal qilish</button>
                      <button onClick={() => resolve(r.id, "dismissed")} className="btn-secondary btn-sm">Rad etish</button>
                    </>}
                  </div>
                </td>
              </tr>
            ))}
            {!items.length && <tr><td colSpan={6} className="py-6 text-center text-[color:var(--text-muted)]">Shikoyat yo'q</td></tr>}
          </tbody>
        </table>
      </div>

      <Pagination page={page} pages={pages} onPage={setPage} />
    </div>
  );
}
