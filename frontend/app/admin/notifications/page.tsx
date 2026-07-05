"use client";
import { useCallback, useEffect, useState } from "react";
import { api, Broadcast, Paged } from "@/lib/api";
import { Pagination } from "@/components/Pagination";

export default function AdminBroadcast() {
  const [title, setTitle] = useState("");
  const [body, setBody] = useState("");
  const [region, setRegion] = useState("");
  const [activeOnly, setActiveOnly] = useState(true);
  const [msg, setMsg] = useState("");
  const [sending, setSending] = useState(false);

  const [hist, setHist] = useState<Paged<Broadcast> | null>(null);
  const [page, setPage] = useState(1);
  const limit = 10;

  const loadHist = useCallback(async () => {
    setHist(await api.get<Paged<Broadcast>>(`/api/admin/broadcasts?page=${page}&limit=${limit}`, { auth: "admin" } as any));
  }, [page]);
  useEffect(() => { loadHist(); }, [loadHist]);

  async function send() {
    setMsg(""); setSending(true);
    try {
      const r = await api.post<{ recipients: number; status: string }>(
        "/api/admin/broadcast",
        { title, body, region: region.trim(), activeOnly },
        { auth: "admin" } as any
      );
      setMsg(`~${r.recipients} foydalanuvchiga yuborilmoqda (fon jarayonida)`);
      setTitle(""); setBody("");
      setPage(1);
      loadHist();
    } catch (e: any) {
      setMsg(e?.message || "Xatolik");
    } finally {
      setSending(false);
    }
  }

  const items = hist?.items ?? [];
  const pages = Math.max(1, Math.ceil((hist?.total ?? 0) / limit));

  return (
    <div className="grid gap-4">
      <div className="card p-6 max-w-xl grid gap-3">
        <h1 className="font-semibold text-lg">Tarqatma yuborish</h1>
        <input className="input" value={title} onChange={(e) => setTitle(e.target.value)} placeholder="Sarlavha" />
        <textarea className="input min-h-[100px]" value={body} onChange={(e) => setBody(e.target.value)} placeholder="Matn" />
        <div className="grid sm:grid-cols-2 gap-2">
          <label className="text-sm">Segment: viloyat (ixtiyoriy)
            <input className="input mt-1" value={region} onChange={(e) => setRegion(e.target.value)} placeholder="Barchasi" />
          </label>
          <label className="text-sm flex items-center gap-2 sm:mt-6">
            <input type="checkbox" checked={activeOnly} onChange={(e) => setActiveOnly(e.target.checked)} /> Faqat faol (bloklanmagan)
          </label>
        </div>
        <button onClick={send} className="btn-primary" disabled={!title.trim() || sending}>{sending ? "Yuborilmoqda…" : "Yuborish"}</button>
        {msg && <div className="text-sm text-success">{msg}</div>}
        <p className="text-xs text-[color:var(--text-muted)]">Yuborish fon jarayonida bajariladi — ko'p foydalanuvchi bo'lsa ham sahifa kutib qolmaydi.</p>
      </div>

      <div className="card p-4 grid gap-3">
        <div className="font-semibold text-sm">Tarqatmalar tarixi</div>
        <div className="-mx-4 px-4 overflow-x-auto scroll-y-auto">
          <table className="w-full min-w-[720px] text-sm">
            <thead><tr className="text-left text-[color:var(--text-muted)]"><th className="py-2">Sarlavha</th><th>Segment</th><th>Yuborilgan</th><th>Holat</th><th>Sana</th></tr></thead>
            <tbody>
              {items.map((b) => (
                <tr key={b.id} className="border-t" style={{ borderColor: "var(--border)" }}>
                  <td className="py-2">{b.title}</td>
                  <td className="text-[color:var(--text-muted)]">{[b.region || "barcha viloyat", b.activeOnly ? "faol" : "hammasi"].join(" · ")}</td>
                  <td>{b.sentCount}</td>
                  <td>{b.status === "sending" ? <span className="text-brand-navy">yuborilmoqda…</span> : "yuborildi"}</td>
                  <td className="whitespace-nowrap">{new Date(b.createdAt).toLocaleString("uz-UZ")}</td>
                </tr>
              ))}
              {!items.length && <tr><td colSpan={5} className="py-6 text-center text-[color:var(--text-muted)]">Hali tarqatma yo'q</td></tr>}
            </tbody>
          </table>
        </div>
        <Pagination page={page} pages={pages} onPage={setPage} />
      </div>
    </div>
  );
}
