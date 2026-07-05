"use client";

export const API_BASE = process.env.NEXT_PUBLIC_API_BASE || "http://localhost:8080";
export const WS_BASE = process.env.NEXT_PUBLIC_WS_BASE || "ws://localhost:8080";

const ACCESS_KEY = "ib-access";
const REFRESH_KEY = "ib-refresh";
const ADMIN_KEY = "ib-admin";

export function getAccess(): string | null {
  if (typeof window === "undefined") return null;
  return localStorage.getItem(ACCESS_KEY);
}
export function setAccess(t: string | null) {
  if (typeof window === "undefined") return;
  if (t) localStorage.setItem(ACCESS_KEY, t);
  else localStorage.removeItem(ACCESS_KEY);
}
export function setRefresh(t: string | null) {
  if (typeof window === "undefined") return;
  if (t) localStorage.setItem(REFRESH_KEY, t);
  else localStorage.removeItem(REFRESH_KEY);
}
export function getRefresh(): string | null {
  if (typeof window === "undefined") return null;
  return localStorage.getItem(REFRESH_KEY);
}

export function setAdminToken(t: string | null) {
  if (typeof window === "undefined") return;
  if (t) localStorage.setItem(ADMIN_KEY, t);
  else localStorage.removeItem(ADMIN_KEY);
}
export function getAdminToken(): string | null {
  if (typeof window === "undefined") return null;
  return localStorage.getItem(ADMIN_KEY);
}

// downloadAdminCsv triggers a browser download of an admin CSV export. The admin
// JWT is passed via ?token= (a plain <a> download can't send the Authorization
// header); the backend's AdminAuth accepts it there.
export function downloadAdminCsv(path: string, params?: URLSearchParams) {
  if (typeof document === "undefined") return;
  const qs = new URLSearchParams(params ? params.toString() : "");
  qs.set("token", getAdminToken() || "");
  const a = document.createElement("a");
  a.href = `${API_BASE}${path}?${qs}`;
  document.body.appendChild(a);
  a.click();
  a.remove();
}

// getAdminRole decodes the role claim from the stored admin JWT so the UI can
// hide sections a role can't use (RBAC is still enforced server-side).
export function getAdminRole(): string | null {
  const t = getAdminToken();
  if (!t) return null;
  try {
    const part = t.split(".")[1];
    const json = atob(part.replace(/-/g, "+").replace(/_/g, "/"));
    return JSON.parse(json).role || null;
  } catch {
    return null;
  }
}

export interface APIError {
  code: string;
  message: string;
}

async function request<T>(
  path: string,
  opts: RequestInit & { auth?: "user" | "admin" | "none" } = {}
): Promise<T> {
  const headers: Record<string, string> = { "Content-Type": "application/json" };
  const auth = opts.auth ?? "user";
  if (auth === "user") {
    const t = getAccess();
    if (t) headers["Authorization"] = `Bearer ${t}`;
  } else if (auth === "admin") {
    const t = getAdminToken();
    if (t) headers["Authorization"] = `Bearer ${t}`;
  }
  Object.assign(headers, opts.headers || {});
  const res = await fetch(`${API_BASE}${path}`, { ...opts, headers });
  const text = await res.text();
  const data = text ? JSON.parse(text) : null;
  if (!res.ok) {
    // Sessiya tugagan yoki token yaroqsiz (401) — saqlangan foydalanuvchi
    // tokenlarini tozalaymiz. Shunda ilova "kirgan" holatda qotib qolmaydi
    // va foydalanuvchi qaytadan login qilishga yo'naltiriladi.
    if (res.status === 401 && auth === "user") {
      setAccess(null);
      setRefresh(null);
    }
    const err: APIError = (data && data.error) || { code: "http", message: `HTTP ${res.status}` };
    throw err;
  }
  return data as T;
}

export const api = {
  get: <T>(p: string, opts?: any) => request<T>(p, { ...(opts || {}), method: "GET" }),
  post: <T>(p: string, body?: any, opts?: any) =>
    request<T>(p, { ...(opts || {}), method: "POST", body: body !== undefined ? JSON.stringify(body) : undefined }),
  patch: <T>(p: string, body?: any, opts?: any) =>
    request<T>(p, { ...(opts || {}), method: "PATCH", body: body !== undefined ? JSON.stringify(body) : undefined }),
  put: <T>(p: string, body?: any, opts?: any) =>
    request<T>(p, { ...(opts || {}), method: "PUT", body: body !== undefined ? JSON.stringify(body) : undefined }),
  delete: <T>(p: string, opts?: any) => request<T>(p, { ...(opts || {}), method: "DELETE" }),
};

// ----- domain types -----
export type ID = string;

export interface User {
  id: ID;
  telegramId?: number;
  phone: string;
  firstName: string;
  lastName: string;
  avatarUrl?: string;
  region?: string;
  district?: string;
  bio?: string;
  skills?: string[];
  rating: number;
  reviewsCount: number;
  workerRating?: number;
  workerReviewsCount?: number;
  employerRating?: number;
  employerReviewsCount?: number;
  completedJobsCount: number;
  isPhoneVerified: boolean;
  isBlocked: boolean;
  langPref?: "latin" | "cyrillic";
  themePref?: "light" | "dark";
  onboardingCompleted?: boolean;
}
export interface Category {
  id: ID;
  name: string;
  slug: string;
  icon?: string;
  isSystemDefault?: boolean;
  isActive: boolean;
  usageCount: number;
  createdAt?: string;
}
export interface Elon {
  id: ID;
  ownerId: ID;
  title: string;
  categoryId: ID;
  categoryName: string;
  description: string;
  locationUrl?: string;
  locationText?: string;
  lat?: number;
  lng?: number;
  region?: string;
  district?: string;
  workersNeeded: number;
  pricingType: "per_worker" | "total" | "negotiable";
  priceAmount: number;
  perWorkerAmount: number;
  startDate?: string;
  workTimeFrom?: string;
  workTimeTo?: string;
  contactPhone?: string;
  status: "draft" | "recruiting" | "filled" | "in_progress" | "completed" | "cancelled" | "hidden";
  acceptedCount: number;
  publishedAt?: string;
  createdAt: string;
  ownerName?: string;
  ownerRating?: number;
  ownerAvatarUrl?: string;
  images?: string[];
}
export interface Application {
  id: ID;
  elonId: ID;
  elonTitle: string;
  workerId: ID;
  employerId: ID;
  workerPhone: string;
  workerName?: string;
  workerAvatarUrl?: string;
  ownerName?: string;
  ownerAvatarUrl?: string;
  peopleCount?: number;
  amount: number;
  isNegotiable: boolean;
  status: "pending" | "accepted" | "rejected" | "cancelled" | "completed";
  employerConfirmedDone?: boolean;
  workerConfirmedDone?: boolean;
  cancelledBy?: string;
  cancelReason?: string;
  appliedAt: string;
  decidedAt?: string;
  completedAt?: string;
}
export interface Notification {
  id: ID;
  type: string;
  title: string;
  body: string;
  isRead: boolean;
  createdAt: string;
  relatedEntity?: { type: string; id: ID };
}
export interface Feedback {
  id: ID;
  userId: ID;
  userName?: string;
  userPhone?: string;
  type: "suggestion" | "complaint";
  subject?: string;
  message: string;
  status: "open" | "resolved";
  createdAt: string;
}
export interface Review {
  id: ID;
  applicationId: ID;
  elonId: ID;
  fromUserId: ID;
  toUserId: ID;
  direction: "employer_to_worker" | "worker_to_employer";
  rating: number;
  comment?: string;
  createdAt: string;
}

// ----- admin types -----
export type AdminRole = "superadmin" | "moderator" | "support";

export interface Admin {
  id: ID;
  username: string;
  role: AdminRole;
  isActive: boolean;
  totpEnabled: boolean;
  createdAt: string;
}

export interface AdminAudit {
  id: ID;
  adminId: ID;
  action: string;
  target?: string;
  detail?: string;
  createdAt: string;
}

export interface Broadcast {
  id: ID;
  title: string;
  body: string;
  region?: string;
  activeOnly: boolean;
  sentCount: number;
  status: "scheduled" | "sending" | "done";
  scheduledAt?: string;
  createdAt: string;
}

// Paged is the shape every admin list endpoint returns.
export interface Paged<T> {
  items: T[];
  page: number;
  limit: number;
  total: number;
}

export interface DashboardStats {
  users: number;
  activeUsers: number;
  blockedUsers: number;
  todayUsers: number;
  elons: number;
  recruitingElons: number;
  filledElons: number;
  todayElons: number;
  completed: number;
  openReports: number;
  openFeedback: number;
}

export interface DayPoint { date: string; count: number; }
export interface NameCount { name: string; count: number; }
export interface AdminStats {
  userGrowth: DayPoint[];
  elonGrowth: DayPoint[];
  funnel: Record<string, number>;
  topCategories: NameCount[];
  regions: NameCount[];
}
