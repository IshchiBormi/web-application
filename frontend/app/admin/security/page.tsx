"use client";
import { useEffect, useState } from "react";
import { api, Admin } from "@/lib/api";

export default function AdminSecurity() {
  const [me, setMe] = useState<Admin | null>(null);
  const [setup, setSetup] = useState<{ secret: string; uri: string } | null>(null);
  const [code, setCode] = useState("");
  const [err, setErr] = useState("");
  const [ok, setOk] = useState("");

  async function loadMe() { setMe(await api.get<Admin>("/api/admin/me", { auth: "admin" } as any)); }
  useEffect(() => { loadMe(); }, []);

  async function startSetup() {
    setErr(""); setOk("");
    try {
      setSetup(await api.post<{ secret: string; uri: string }>("/api/admin/2fa/setup", {}, { auth: "admin" } as any));
    } catch (e: any) { setErr(e?.message || "Xatolik"); }
  }
  async function enable() {
    setErr(""); setOk("");
    try {
      await api.post("/api/admin/2fa/enable", { code }, { auth: "admin" } as any);
      setSetup(null); setCode(""); setOk("2FA yoqildi.");
      loadMe();
    } catch (e: any) { setErr(e?.code === "bad_totp" ? "Kod noto'g'ri." : (e?.message || "Xatolik")); }
  }
  async function disable() {
    setErr(""); setOk("");
    try {
      await api.post("/api/admin/2fa/disable", { code }, { auth: "admin" } as any);
      setCode(""); setOk("2FA o'chirildi.");
      loadMe();
    } catch (e: any) { setErr(e?.code === "bad_totp" ? "Kod noto'g'ri." : (e?.message || "Xatolik")); }
  }

  const codeInput = (
    <input
      className="input tracking-[0.3em] text-center max-w-[160px]"
      value={code}
      onChange={(e) => setCode(e.target.value.replace(/\D/g, "").slice(0, 6))}
      placeholder="000000"
      inputMode="numeric"
    />
  );

  return (
    <div className="grid gap-4 max-w-xl">
      <div className="card p-5 grid gap-3">
        <h1 className="font-semibold text-lg">Ikki bosqichli himoya (2FA)</h1>
        <p className="text-sm text-[color:var(--text-muted)]">
          Google Authenticator, Authy yoki shunga o'xshash ilova bilan hisobingizni himoyalang.
          Yoqilgach, har kirishda 6 xonali kod so'raladi.
        </p>

        {me && (
          <div className="text-sm">
            Holat: {me.totpEnabled
              ? <span className="text-success font-medium">Yoqilgan ✓</span>
              : <span className="text-danger font-medium">O'chirilgan</span>}
          </div>
        )}
        {ok && <div className="text-success text-sm">{ok}</div>}
        {err && <div className="text-danger text-sm">{err}</div>}

        {/* Yoqilmagan — sozlash oqimi */}
        {me && !me.totpEnabled && !setup && (
          <button onClick={startSetup} className="btn-primary w-fit">2FA yoqish</button>
        )}

        {me && !me.totpEnabled && setup && (
          <div className="grid gap-3 border-t pt-3" style={{ borderColor: "var(--border)" }}>
            <div className="text-sm">
              1) Autentifikator ilovangizda <b>&quot;Kalit kiritish&quot;</b> (setup key) orqali quyidagi maxfiy kalitni qo'shing:
            </div>
            <code className="block break-all rounded-lg bg-black/5 p-3 text-sm font-mono select-all">{setup.secret}</code>
            <div className="text-xs text-[color:var(--text-muted)] break-all">
              Yoki otpauth havolasi: {setup.uri}
            </div>
            <div className="text-sm">2) Ilova ko'rsatgan 6 xonali kodni kiriting:</div>
            <div className="flex gap-2 items-center">
              {codeInput}
              <button onClick={enable} className="btn-primary" disabled={code.length !== 6}>Tasdiqlash</button>
              <button onClick={() => { setSetup(null); setCode(""); }} className="btn-secondary btn-sm">Bekor</button>
            </div>
          </div>
        )}

        {/* Yoqilgan — o'chirish */}
        {me && me.totpEnabled && (
          <div className="grid gap-2 border-t pt-3" style={{ borderColor: "var(--border)" }}>
            <div className="text-sm">O'chirish uchun joriy 6 xonali kodni kiriting:</div>
            <div className="flex gap-2 items-center">
              {codeInput}
              <button onClick={disable} className="btn-danger" disabled={code.length !== 6}>2FA o'chirish</button>
            </div>
            <p className="text-xs text-[color:var(--text-muted)]">
              Qurilmani yo'qotsangiz — superadmin sizning 2FA'ingizni &quot;Adminlar&quot; bo'limidan qayta tiklashi mumkin.
            </p>
          </div>
        )}
      </div>
    </div>
  );
}
