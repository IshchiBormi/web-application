"use client";
import { useCallback, useEffect, useState } from "react";
import { api, AdminAudit, Paged } from "@/lib/api";
import { Pagination } from "@/components/Pagination";

export default function AdminAuditPage() {
  const [data, setData] = useState<Paged<AdminAudit> | null>(null);
  const [page, setPage] = useState(1);
  const [action, setAction] = useState("");
  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");
  const limit = 30;

  const load = useCallback(async () => {
    const params = new URLSearchParams({ page: String(page), limit: String(limit) });
    if (action.trim()) params.set("action", action.trim());
    if (from) params.set("from", new Date(from).toISOString());
    if (to) params.set("to", new Date(to + "T23:59:59").toISOString());
    setData(await api.get<Paged<AdminAudit>>(`/api/admin/audit?${params}`, { auth: "admin" } as any));
  }, [page, action, from, to]);

  useEffect(() => { load(); }, [load]);
  useEffect(() => { setPage(1); }, [action, from, to]);

  const total = data?.total ?? 0;
  const pages = Math.max(1, Math.ceil(total / limit));
  const items = data?.items ?? [];

  return (
    <div className="card p-4 grid gap-3">
      <div className="flex flex-wrap gap-2 items-center">
        <input className="input max-w-[200px]" placeholder="Amal (masalan: user_block)" value={action} onChange={(e) => setAction(e.target.value)} />
        <label className="text-sm flex items-center gap-1">Dan <input type="date" className="input" value={from} onChange={(e) => setFrom(e.target.value)} /></label>
        <label className="text-sm flex items-center gap-1">Gacha <input type="date" className="input" value={to} onChange={(e) => setTo(e.target.value)} /></label>
        <div className="text-sm text-[color:var(--text-muted)] ml-auto">Jami: {total}</div>
      </div>

      <div className="-mx-4 px-4 overflow-x-auto scroll-y-auto">
        <table className="w-full min-w-[680px] text-sm">
          <thead><tr className="text-left text-[color:var(--text-muted)]"><th className="py-2">Vaqt</th><th>Admin</th><th>Amal</th><th>Maqsad</th><th>Tafsilot</th></tr></thead>
          <tbody>
            {items.map((a) => (
              <tr key={a.id} className="border-t" style={{ borderColor: "var(--border)" }}>
                <td className="py-2 whitespace-nowrap">{new Date(a.createdAt).toLocaleString("uz-UZ")}</td>
                <td>{a.adminId && a.adminId !== "000000000000000000000000" ? a.adminId.slice(-6) : "—"}</td>
                <td>{a.action}</td><td>{a.target}</td><td>{a.detail}</td>
              </tr>
            ))}
            {!items.length && <tr><td colSpan={5} className="py-6 text-center text-[color:var(--text-muted)]">Yozuv topilmadi</td></tr>}
          </tbody>
        </table>
      </div>

      <Pagination page={page} pages={pages} onPage={setPage} />
    </div>
  );
}
