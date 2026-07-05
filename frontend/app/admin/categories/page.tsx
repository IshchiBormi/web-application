"use client";
import { useEffect, useState } from "react";
import { api, Category, getAdminRole } from "@/lib/api";
import { Modal } from "@/components/Modal";

type Draft = { id?: string; name: string; slug: string; icon: string; isActive: boolean };
const empty: Draft = { name: "", slug: "", icon: "", isActive: true };

export default function AdminCategories() {
  const [cats, setCats] = useState<Category[]>([]);
  const [edit, setEdit] = useState<Draft | null>(null);
  const [delCat, setDelCat] = useState<Category | null>(null);
  const [err, setErr] = useState("");
  const [isSuper, setIsSuper] = useState(false);

  async function load() { setCats(await api.get<Category[]>("/api/admin/categories", { auth: "admin" } as any)); }
  useEffect(() => { load(); setIsSuper(getAdminRole() === "superadmin"); }, []);

  async function toggle(c: Category) {
    await api.patch(`/api/admin/categories/${c.id}/active`, { isActive: !c.isActive }, { auth: "admin" } as any);
    load();
  }
  async function save() {
    if (!edit) return;
    setErr("");
    try {
      const body = { name: edit.name, slug: edit.slug, icon: edit.icon, isActive: edit.isActive };
      if (edit.id) await api.put(`/api/admin/categories/${edit.id}`, body, { auth: "admin" } as any);
      else await api.post(`/api/admin/categories`, body, { auth: "admin" } as any);
      setEdit(null);
      load();
    } catch (e: any) { setErr(e?.message || "Xatolik"); }
  }
  async function del() {
    if (!delCat) return;
    setErr("");
    try {
      await api.delete(`/api/admin/categories/${delCat.id}`, { auth: "admin" } as any);
      setDelCat(null);
      load();
    } catch (e: any) { setErr(e?.message || "Xatolik"); setDelCat(null); }
  }

  return (
    <div className="card p-4 grid gap-3">
      <div className="flex items-center justify-between gap-2">
        <div className="font-semibold text-sm">Turkumlar ({cats.length})</div>
        {isSuper && <button onClick={() => { setErr(""); setEdit({ ...empty }); }} className="btn-primary btn-sm">+ Yangi turkum</button>}
      </div>
      {err && <div className="text-danger text-sm">{err}</div>}

      <div className="-mx-4 px-4 overflow-x-auto scroll-y-auto">
        <table className="w-full min-w-[640px] text-sm">
          <thead><tr className="text-left text-[color:var(--text-muted)]"><th className="py-2">Nomi</th><th>Slug</th><th>Foydalanish</th><th>Tur</th><th>Holat</th><th></th></tr></thead>
          <tbody>
            {cats.map((c) => (
              <tr key={c.id} className="border-t" style={{ borderColor: "var(--border)" }}>
                <td className="py-2">{c.icon} {c.name}</td>
                <td>{c.slug}</td>
                <td>{c.usageCount}</td>
                <td>{c.isSystemDefault ? "tizim" : "admin"}</td>
                <td>{c.isActive ? "Faol" : "O'chirilgan"}</td>
                <td>
                  <div className="flex flex-wrap gap-2 justify-end">
                    {isSuper && <button onClick={() => { setErr(""); setEdit({ id: c.id, name: c.name, slug: c.slug, icon: c.icon || "", isActive: c.isActive }); }} className="btn-secondary btn-sm">Tahrir</button>}
                    {isSuper && <button onClick={() => toggle(c)} className="btn-secondary btn-sm">{c.isActive ? "O'chirish" : "Yoqish"}</button>}
                    {isSuper && !c.isSystemDefault && <button onClick={() => { setErr(""); setDelCat(c); }} className="btn-danger btn-sm">Delete</button>}
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {!isSuper && <div className="text-xs text-[color:var(--text-muted)]">Turkumlarni faqat superadmin tahrirlashi mumkin.</div>}

      {/* Yaratish / tahrirlash */}
      <Modal open={!!edit} onClose={() => setEdit(null)} title={edit?.id ? "Turkumni tahrirlash" : "Yangi turkum"} footer={
        <>
          <button onClick={() => setEdit(null)} className="btn-secondary">Bekor</button>
          <button onClick={save} className="btn-primary" disabled={!edit?.name.trim()}>Saqlash</button>
        </>
      }>
        {edit && (
          <div className="grid gap-2">
            <label className="text-sm">Nomi
              <input className="input mt-1" value={edit.name} onChange={(e) => setEdit({ ...edit, name: e.target.value })} placeholder="Masalan: Quruvchi" />
            </label>
            <label className="text-sm">Slug (ixtiyoriy — nomdan avtomatik)
              <input className="input mt-1" value={edit.slug} onChange={(e) => setEdit({ ...edit, slug: e.target.value })} placeholder="quruvchi" />
            </label>
            <label className="text-sm">Icon (emoji yoki nom, ixtiyoriy)
              <input className="input mt-1" value={edit.icon} onChange={(e) => setEdit({ ...edit, icon: e.target.value })} placeholder="🔨" />
            </label>
            <label className="text-sm flex items-center gap-2">
              <input type="checkbox" checked={edit.isActive} onChange={(e) => setEdit({ ...edit, isActive: e.target.checked })} /> Faol
            </label>
            {err && <div className="text-danger text-sm">{err}</div>}
          </div>
        )}
      </Modal>

      {/* O'chirish */}
      <Modal open={!!delCat} onClose={() => setDelCat(null)} title="Turkumni o'chirasizmi?" footer={
        <>
          <button onClick={() => setDelCat(null)} className="btn-secondary">Yo'q</button>
          <button onClick={del} className="btn-danger">Ha, o'chirish</button>
        </>
      }>
        <p className="text-sm muted">“{delCat?.name}” o'chiriladi. E'lonlarda ishlatilgan bo'lsa, o'chirish rad etiladi.</p>
      </Modal>
    </div>
  );
}
