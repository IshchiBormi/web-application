"use client";
import { useEffect, useState } from "react";
import { api, Admin, AdminRole } from "@/lib/api";
import { Modal } from "@/components/Modal";

const ROLES: AdminRole[] = ["superadmin", "moderator", "support"];

export default function AdminAdmins() {
  const [admins, setAdmins] = useState<Admin[]>([]);
  const [createOpen, setCreateOpen] = useState(false);
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [role, setRole] = useState<AdminRole>("moderator");
  const [editA, setEditA] = useState<Admin | null>(null);
  const [newPass, setNewPass] = useState("");
  const [delA, setDelA] = useState<Admin | null>(null);
  const [err, setErr] = useState("");

  async function load() { setAdmins(await api.get<Admin[]>("/api/admin/admins", { auth: "admin" } as any)); }
  useEffect(() => { load(); }, []);

  async function create() {
    setErr("");
    try {
      await api.post("/api/admin/admins", { username, password, role }, { auth: "admin" } as any);
      setCreateOpen(false); setUsername(""); setPassword(""); setRole("moderator");
      load();
    } catch (e: any) { setErr(e?.message || "Xatolik"); }
  }
  async function saveEdit() {
    if (!editA) return;
    setErr("");
    try {
      const body: any = { role: editA.role, isActive: editA.isActive };
      if (newPass.trim()) body.password = newPass.trim();
      await api.patch(`/api/admin/admins/${editA.id}`, body, { auth: "admin" } as any);
      setEditA(null); setNewPass("");
      load();
    } catch (e: any) { setErr(e?.message || "Xatolik"); }
  }
  async function del() {
    if (!delA) return;
    setErr("");
    try {
      await api.delete(`/api/admin/admins/${delA.id}`, { auth: "admin" } as any);
      setDelA(null);
      load();
    } catch (e: any) { setErr(e?.message || "Xatolik"); setDelA(null); }
  }
  async function resetTwoFactor(id: string) {
    setErr("");
    try {
      await api.patch(`/api/admin/admins/${id}`, { disableTwoFactor: true }, { auth: "admin" } as any);
      load();
    } catch (e: any) { setErr(e?.message || "Xatolik"); }
  }

  return (
    <div className="card p-4 grid gap-3">
      <div className="flex items-center justify-between gap-2">
        <div className="font-semibold text-sm">Adminlar ({admins.length})</div>
        <button onClick={() => { setErr(""); setCreateOpen(true); }} className="btn-primary btn-sm">+ Yangi admin</button>
      </div>
      {err && <div className="text-danger text-sm">{err}</div>}

      <div className="-mx-4 px-4 overflow-x-auto scroll-y-auto">
        <table className="w-full min-w-[560px] text-sm">
          <thead><tr className="text-left text-[color:var(--text-muted)]"><th className="py-2">Username</th><th>Rol</th><th>Holat</th><th>2FA</th><th>Yaratilgan</th><th></th></tr></thead>
          <tbody>
            {admins.map((a) => (
              <tr key={a.id} className="border-t" style={{ borderColor: "var(--border)" }}>
                <td className="py-2 font-medium">{a.username}</td>
                <td className="capitalize">{a.role}</td>
                <td>{a.isActive ? "Faol" : "Faolsiz"}</td>
                <td>{a.totpEnabled ? <span className="text-success">yoqilgan</span> : "—"}</td>
                <td className="whitespace-nowrap">{new Date(a.createdAt).toLocaleDateString("uz-UZ")}</td>
                <td>
                  <div className="flex flex-wrap gap-2 justify-end">
                    {a.totpEnabled && <button onClick={() => resetTwoFactor(a.id)} className="btn-secondary btn-sm">2FA reset</button>}
                    <button onClick={() => { setErr(""); setNewPass(""); setEditA(a); }} className="btn-secondary btn-sm">Tahrir</button>
                    <button onClick={() => { setErr(""); setDelA(a); }} className="btn-danger btn-sm">O'chirish</button>
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {/* Yaratish */}
      <Modal open={createOpen} onClose={() => setCreateOpen(false)} title="Yangi admin" footer={
        <>
          <button onClick={() => setCreateOpen(false)} className="btn-secondary">Bekor</button>
          <button onClick={create} className="btn-primary" disabled={!username.trim() || password.length < 6}>Yaratish</button>
        </>
      }>
        <div className="grid gap-2">
          <input className="input" placeholder="username" value={username} onChange={(e) => setUsername(e.target.value)} />
          <input className="input" type="password" placeholder="parol (kamida 6 belgi)" value={password} onChange={(e) => setPassword(e.target.value)} />
          <select className="input" value={role} onChange={(e) => setRole(e.target.value as AdminRole)}>
            {ROLES.map((r) => <option key={r} value={r}>{r}</option>)}
          </select>
          {err && <div className="text-danger text-sm">{err}</div>}
        </div>
      </Modal>

      {/* Tahrirlash */}
      <Modal open={!!editA} onClose={() => setEditA(null)} title={`Admin: ${editA?.username}`} footer={
        <>
          <button onClick={() => setEditA(null)} className="btn-secondary">Bekor</button>
          <button onClick={saveEdit} className="btn-primary">Saqlash</button>
        </>
      }>
        {editA && (
          <div className="grid gap-2">
            <label className="text-sm">Rol
              <select className="input mt-1" value={editA.role} onChange={(e) => setEditA({ ...editA, role: e.target.value as AdminRole })}>
                {ROLES.map((r) => <option key={r} value={r}>{r}</option>)}
              </select>
            </label>
            <label className="text-sm flex items-center gap-2">
              <input type="checkbox" checked={editA.isActive} onChange={(e) => setEditA({ ...editA, isActive: e.target.checked })} /> Faol
            </label>
            <label className="text-sm">Yangi parol (ixtiyoriy)
              <input className="input mt-1" type="password" placeholder="bo'sh qoldirsangiz o'zgarmaydi" value={newPass} onChange={(e) => setNewPass(e.target.value)} />
            </label>
            {err && <div className="text-danger text-sm">{err}</div>}
          </div>
        )}
      </Modal>

      {/* O'chirish */}
      <Modal open={!!delA} onClose={() => setDelA(null)} title="Adminni o'chirasizmi?" footer={
        <>
          <button onClick={() => setDelA(null)} className="btn-secondary">Yo'q</button>
          <button onClick={del} className="btn-danger">Ha, o'chirish</button>
        </>
      }>
        <p className="text-sm muted">“{delA?.username}” admin hisobi o'chiriladi.</p>
      </Modal>
    </div>
  );
}
