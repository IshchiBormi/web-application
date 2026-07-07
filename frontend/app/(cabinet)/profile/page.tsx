"use client";
import { useEffect, useState } from "react";
import { api, User } from "@/lib/api";
import { Shell } from "@/components/Shell";
import { Avatar } from "@/components/ui/Avatar";
import { CheckCircle2 } from "lucide-react";
import { T } from "@/components/T";

export default function MyProfile() {
  const [me, setMe] = useState<User | null>(null);
  useEffect(() => {
    api.get<User>("/api/me").then(setMe);
  }, []);
  if (!me) return <div className="p-6">Yuklanmoqda…</div>;
  return (
    <Shell title="Mening profilim">
      <div className="card p-6 flex gap-4 items-start">
        <Avatar size="xl" name={`${me.firstName} ${me.lastName}`} src={me.avatarUrl || undefined} />
        <div className="flex-1">
          <h1 className="text-xl font-bold">{me.firstName} {me.lastName} {me.isPhoneVerified && <span className="ml-1 align-middle text-success"><CheckCircle2 size={16} className="inline" /></span>}</h1>
          <div className="text-sm text-[color:var(--text-muted)] mt-1 flex items-center gap-2 flex-wrap">
            <span>{me.region}{me.district ? `, ${me.district}` : ""}</span>
            <span>•</span><span>{me.completedJobsCount} <T>bajarilgan ish</T></span>
          </div>

          {me.skills && me.skills.length > 0 && (
            <div className="mt-3 flex flex-wrap gap-2">
              {me.skills.map((s, i) => <span key={i} className="chip">{s}</span>)}
            </div>
          )}
          {me.bio && <p className="mt-3 text-sm"><T>{me.bio}</T></p>}
        </div>
      </div>
    </Shell>
  );
}
