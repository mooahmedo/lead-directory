"use client";

import { useState, useEffect, useCallback, useRef } from "react";
import { createClient } from "@/lib/supabase/client";
import { parseNationalId, formatBirthDate } from "@/lib/national-id";
import type { Department, HealthUnit, VisitSubmission, DashboardStats, UnitStats, UserProfile } from "@/lib/types";
import { Toaster, toast } from "sonner";
import {
  Heart, Wifi, WifiOff, LogIn, LogOut, ChevronDown, ChevronUp,
  RefreshCw, Search, Users, Activity, Calendar, Building2,
  TrendingUp, AlertCircle, CheckCircle2, XCircle, Loader2,
  ArrowUpRight, Shield, Eye, EyeOff, ClipboardList, Stethoscope,
  FlaskConical, Droplets, Weight, Ruler, Menu, X, Plus, Edit2,
  UserCheck, UserX, FileText, CheckCircle, Info, Download
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Progress } from "@/components/ui/progress";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue
} from "@/components/ui/select";
import {
  Collapsible, CollapsibleContent, CollapsibleTrigger
} from "@/components/ui/collapsible";
import * as XLSX from "xlsx";

// ─── Offline Queue ────────────────────────────────────────────────────────────
const OFFLINE_QUEUE_KEY = "cdms_offline_queue";
const DEPARTMENTS_CACHE_KEY = "cdms_departments_cache";
const UNITS_CACHE_KEY = "cdms_units_cache";

interface QueuedVisit extends VisitSubmission {
  _queuedAt: string;
  _id: string;
}

function loadQueue(): QueuedVisit[] {
  try {
    return JSON.parse(localStorage.getItem(OFFLINE_QUEUE_KEY) || "[]");
  } catch { return []; }
}

function saveQueue(q: QueuedVisit[]) {
  localStorage.setItem(OFFLINE_QUEUE_KEY, JSON.stringify(q));
}

function addToQueue(visit: VisitSubmission) {
  const q = loadQueue();
  q.push({ ...visit, _queuedAt: new Date().toISOString(), _id: crypto.randomUUID() });
  saveQueue(q);
}

function removeFromQueue(id: string) {
  saveQueue(loadQueue().filter(v => v._id !== id));
}

// ─── Resilient Fetch ──────────────────────────────────────────────────────────
async function resilientFetch<T>(url: string, options?: RequestInit, retries = 2): Promise<T> {
  let lastError: Error = new Error("Fetch failed");
  for (let i = 0; i <= retries; i++) {
    try {
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), 10000);
      const res = await fetch(url, {
        ...options,
        signal: controller.signal,
      });
      clearTimeout(timeout);
      if (!res.ok) {
        const body = await res.json().catch(() => ({ error: res.statusText }));
        throw new Error(body.error || `HTTP ${res.status}`);
      }
      return res.json();
    } catch (e: any) {
      lastError = e;
      if (i < retries) await new Promise(r => setTimeout(r, 800 * (i + 1)));
    }
  }
  throw lastError;
}

// ═══════════════════════════════════════════════════════════════════════════════
// MAIN PAGE COMPONENT
// ═══════════════════════════════════════════════════════════════════════════════
export default function Page() {
  const [profile, setProfile] = useState<UserProfile | null>(null);
  const [view, setView] = useState<"login" | "dashboard" | "visits" | "patients" | "departments-units" | "users">("login");
  const [isSidebarOpen, setIsSidebarOpen] = useState(false);
  const [isOnline, setIsOnline] = useState(true);
  const [pendingCount, setPendingCount] = useState(0);
  const [sessionChecked, setSessionChecked] = useState(false);

  // Fetch profile via /api/me (uses admin client, bypasses RLS)
  const fetchAndSetProfile = useCallback(async (signOutOnFail = false) => {
    try {
      const res = await fetch("/api/me");
      if (!res.ok) {
        if (signOutOnFail) {
          const supabase = createClient();
          await supabase.auth.signOut();
        }
        setProfile(null);
        setView("login");
        return null;
      }
      const userProf = await res.json() as UserProfile;
      setProfile(userProf);
      setView(userProf.role === "supervisor" ? "dashboard" : "visits");
      return userProf;
    } catch {
      setProfile(null);
      setView("login");
      return null;
    }
  }, []);

  // Restore session and load profile on mount
  useEffect(() => {
    const supabase = createClient();

    supabase.auth.getSession().then(async ({ data: { session } }) => {
      if (session?.user) {
        await fetchAndSetProfile(true);
      } else {
        setView("login");
      }
      setSessionChecked(true);
    });

    const { data: { subscription } } = supabase.auth.onAuthStateChange(async (event, session) => {
      if (event === "SIGNED_OUT" || !session) {
        setProfile(null);
        setView("login");
      }
      // Note: SIGNED_IN is handled directly by SupervisorLogin calling fetchAndSetProfile
      // to avoid race conditions with cookie propagation
    });

    return () => subscription.unsubscribe();
  }, [fetchAndSetProfile]);

  // Sync pending count from localStorage
  useEffect(() => {
    const update = () => setPendingCount(loadQueue().length);
    update();
    window.addEventListener("storage", update);
    const interval = setInterval(update, 2000);
    return () => {
      window.removeEventListener("storage", update);
      clearInterval(interval);
    };
  }, []);

  // Online/offline detection
  useEffect(() => {
    const handleOnline = () => setIsOnline(true);
    const handleOffline = () => setIsOnline(false);
    setIsOnline(navigator.onLine);
    window.addEventListener("online", handleOnline);
    window.addEventListener("offline", handleOffline);
    return () => {
      window.removeEventListener("online", handleOnline);
      window.removeEventListener("offline", handleOffline);
    };
  }, []);

  // Auto-sync offline queue when back online
  useEffect(() => {
    if (!isOnline) return;
    const queue = loadQueue();
    if (queue.length === 0) return;

    const syncQueue = async () => {
      for (const item of queue) {
        try {
          await resilientFetch("/api/visits", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(item),
          });
          removeFromQueue(item._id);
          setPendingCount(prev => Math.max(0, prev - 1));
          toast.success(`تم مزامنة بيانات ${item.fullName}`);
        } catch {
          // Leave in queue, try next time
        }
      }
    };
    syncQueue();
  }, [isOnline]);

  if (!sessionChecked) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-gradient-to-br from-emerald-50 via-white to-teal-50" dir="rtl">
        <div className="flex flex-col items-center gap-3">
          <div className="w-10 h-10 border-4 border-emerald-600 border-t-transparent rounded-full animate-spin"></div>
          <p className="text-emerald-800 text-sm font-semibold">جاري التحقق من الجلسة...</p>
        </div>
      </div>
    );
  }

  if (view === "login" || !profile) {
    return <SupervisorLogin onSuccess={fetchAndSetProfile} />;
  }

  // Sidebar navigation options based on role
  const menuItems = [
    { id: "dashboard", label: "لوحة التحكم", icon: <Activity className="w-5 h-5" />, roles: ["supervisor", "coordinator"] },
    { id: "visits", label: "تسجيل الزيارات", icon: <ClipboardList className="w-5 h-5" />, roles: ["nurse", "supervisor", "coordinator"] },
    { id: "patients", label: "قائمة المرضى", icon: <Users className="w-5 h-5" />, roles: ["supervisor"] },
    { id: "departments-units", label: "الإدارات والوحدات", icon: <Building2 className="w-5 h-5" />, roles: ["supervisor", "coordinator"] },
    { id: "users", label: "المستخدمين", icon: <Shield className="w-5 h-5" />, roles: ["supervisor"] },
  ];

  const filteredMenuItems = menuItems.filter(item => item.roles.includes(profile.role));

  const handleLogout = async () => {
    const supabase = createClient();
    await supabase.auth.signOut();
    toast.success("تم تسجيل الخروج بنجاح");
  };

  return (
    <div className="flex h-screen bg-slate-50 text-slate-900 font-sans overflow-hidden" dir="rtl">
      <Toaster position="top-center" richColors dir="rtl" />

      {/* ─── Sidebar for Desktop & Mobile ─── */}
      <div
        className={`fixed inset-0 z-50 bg-black/40 backdrop-blur-sm transition-opacity md:hidden ${
          isSidebarOpen ? "opacity-100 pointer-events-auto" : "opacity-0 pointer-events-none"
        }`}
        onClick={() => setIsSidebarOpen(false)}
      />

      <aside
        className={`fixed inset-y-0 right-0 z-50 flex flex-col w-64 bg-emerald-950 text-emerald-100 transition-transform duration-300 transform md:translate-x-0 md:relative ${
          isSidebarOpen ? "translate-x-0" : "translate-x-full"
        }`}
      >
        {/* Sidebar Header */}
        <div className="p-4 border-b border-emerald-900 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="bg-emerald-600 rounded-xl p-2 text-white">
              <Heart className="w-6 h-6 fill-white" />
            </div>
            <div>
              <h2 className="font-bold text-sm leading-tight">الأمراض المزمنة</h2>
              <p className="text-[10px] text-emerald-300">مديرية الصحة بسوهاج</p>
            </div>
          </div>
          <button className="md:hidden p-1 text-emerald-300 hover:text-white" onClick={() => setIsSidebarOpen(false)}>
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Sidebar Menu */}
        <nav className="flex-1 px-3 py-4 space-y-1 overflow-y-auto">
          {filteredMenuItems.map(item => {
            const active = view === item.id;
            return (
              <button
                key={item.id}
                onClick={() => {
                  setView(item.id as any);
                  setIsSidebarOpen(false);
                }}
                className={`w-full flex items-center gap-3 px-4 py-3 text-sm font-semibold rounded-xl transition-all ${
                  active
                    ? "bg-emerald-600 text-white shadow-md shadow-emerald-900/20"
                    : "hover:bg-emerald-900/50 text-emerald-200 hover:text-white"
                }`}
              >
                {item.icon}
                <span>{item.label}</span>
              </button>
            );
          })}
        </nav>

        {/* Sidebar User Profile Card */}
        <div className="p-4 border-t border-emerald-900 bg-emerald-950/40">
          <div className="flex items-center gap-3 mb-3">
            <div className="w-10 h-10 rounded-full bg-emerald-800 flex items-center justify-center font-bold text-white text-sm">
              {profile.full_name.charAt(0)}
            </div>
            <div className="min-w-0 flex-1">
              <p className="text-xs font-bold truncate text-white leading-tight">{profile.full_name}</p>
              <p className="text-[10px] text-emerald-400 capitalize truncate mt-0.5">
                {profile.role === "supervisor" ? "مشرف المبادرة" : profile.role === "coordinator" ? "منسق إدارة" : "ممرض / ممرضة"}
              </p>
            </div>
          </div>
          <Button
            onClick={handleLogout}
            variant="ghost"
            size="sm"
            className="w-full justify-start text-emerald-300 hover:text-white hover:bg-emerald-900/50 text-xs gap-2"
          >
            <LogOut className="w-3.5 h-3.5" />
            <span>تسجيل الخروج</span>
          </Button>
        </div>
      </aside>

      {/* ─── Main Content Container ─── */}
      <div className="flex-1 flex flex-col overflow-hidden">
        {/* Top Navbar */}
        <header className="flex items-center justify-between px-6 py-4 bg-white border-b border-gray-100 shadow-sm z-30">
          <div className="flex items-center gap-4">
            <button
              onClick={() => setIsSidebarOpen(true)}
              className="md:hidden p-1 text-gray-500 hover:bg-gray-100 rounded-lg"
            >
              <Menu className="w-6 h-6" />
            </button>
            <h1 className="font-bold text-base text-gray-800 md:text-lg">
              {view === "dashboard" && "لوحة التحكم"}
              {view === "visits" && "تسجيل ومتابعة الزيارات"}
              {view === "patients" && "قائمة المرضى المسجلين"}
              {view === "departments-units" && "إدارة الإدارات الصحية والوحدات"}
              {view === "users" && "إدارة المستخدمين وحسابات الممرضين"}
            </h1>
          </div>

          <div className="flex items-center gap-3">
            {/* Offline Status indicator */}
            <div className={`flex items-center gap-1.5 px-3 py-1 rounded-full text-[11px] font-bold transition-all ${
              isOnline ? "bg-emerald-50 text-emerald-700" : "bg-red-50 text-red-700"
            }`}>
              {isOnline ? (
                <>
                  <Wifi className="w-3.5 h-3.5 text-emerald-600 animate-pulse" />
                  <span>متصل بالشبكة</span>
                </>
              ) : (
                <>
                  <WifiOff className="w-3.5 h-3.5 text-red-600 animate-pulse" />
                  <span>وضع الأوفلاين</span>
                </>
              )}
            </div>
            {pendingCount > 0 && (
              <Badge className="bg-amber-500 hover:bg-amber-600 text-white text-[10px] py-0.5 px-2">
                {pendingCount} معلق
              </Badge>
            )}
          </div>
        </header>

        {/* Content View Area */}
        <main className="flex-1 overflow-x-hidden overflow-y-auto bg-slate-50 p-4 md:p-6">
          {view === "dashboard" && <SupervisorDashboard onLogout={() => {}} />}
          {view === "visits" && <VisitsView isOnline={isOnline} onPendingChange={setPendingCount} profile={profile} />}
          {view === "patients" && <PatientsView />}
          {view === "departments-units" && <DepartmentsUnitsView profile={profile} />}
          {view === "users" && <UsersView />}
        </main>
      </div>
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════════════════════
// SUPERVISOR LOGIN (Unified Login Page)
// ═══════════════════════════════════════════════════════════════════════════════
function SupervisorLogin({ onSuccess }: { onSuccess: () => Promise<any> }) {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [loading, setLoading] = useState(false);

  const handleLogin = async () => {
    if (!email || !password) {
      toast.error("يرجى إدخال البريد الإلكتروني وكلمة المرور");
      return;
    }
    setLoading(true);
    try {
      const supabase = createClient();
      const { error } = await supabase.auth.signInWithPassword({ email, password });
      if (error) throw new Error(error.message);

      // After successful auth, fetch profile via server API (bypasses RLS)
      // and let the parent update view state
      const userProf = await onSuccess();
      if (!userProf) {
        // Auth succeeded but no public.users profile found — trigger did not run
        throw new Error("لم يتم العثور على ملف المستخدم. تأكد من تطبيق migration 002_auth_trigger_rls.sql في Supabase");
      }
      toast.success(`مرحباً ${userProf.full_name}، تم تسجيل الدخول بنجاح`);
    } catch (err: any) {
      // Sign out if profile fetch failed so user is not stuck
      const supabase = createClient();
      await supabase.auth.signOut().catch(() => {});
      toast.error("فشل تسجيل الدخول", { description: err.message });
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="min-h-screen flex items-center justify-center bg-gradient-to-br from-emerald-950 via-emerald-900 to-teal-950 p-4" dir="rtl">
      <Toaster position="top-center" richColors dir="rtl" />
      <div className="w-full max-w-md">
        <div className="text-center mb-8">
          <div className="mx-auto w-16 h-16 bg-white/10 rounded-2xl flex items-center justify-center shadow-lg border border-white/20 mb-4 animate-bounce">
            <Heart className="w-9 h-9 text-emerald-400 fill-emerald-400" />
          </div>
          <h2 className="text-2xl font-black text-white leading-tight">مبادرة الأمراض المزمنة</h2>
          <p className="text-sm text-emerald-200/80 mt-2">محافظة سوهاج — تسجيل الدخول الموحد</p>
        </div>

        <Card className="border-0 shadow-2xl bg-white/95 backdrop-blur-md rounded-3xl overflow-hidden">
          <CardHeader className="bg-emerald-600 py-5 text-center text-white">
            <CardTitle className="text-lg font-bold">تسجيل الدخول للنظام</CardTitle>
          </CardHeader>
          <CardContent className="pt-6 pb-6 px-6 space-y-4">
            <div className="space-y-1.5">
              <Label className="text-sm font-semibold text-gray-700">البريد الإلكتروني</Label>
              <Input
                type="email"
                placeholder="email@example.com"
                value={email}
                onChange={e => setEmail(e.target.value)}
                className="h-11 text-sm border-gray-200 focus:border-emerald-500 ltr-input"
                dir="ltr"
                style={{ direction: "ltr", textAlign: "left" }}
                onKeyDown={e => e.key === "Enter" && handleLogin()}
              />
            </div>

            <div className="space-y-1.5">
              <Label className="text-sm font-semibold text-gray-700">كلمة المرور</Label>
              <div className="relative">
                <Input
                  type={showPassword ? "text" : "password"}
                  placeholder="••••••••"
                  value={password}
                  onChange={e => setPassword(e.target.value)}
                  className="h-11 text-sm border-gray-200 focus:border-emerald-500 ltr-input pr-10"
                  dir="ltr"
                  style={{ direction: "ltr", textAlign: "left" }}
                  onKeyDown={e => e.key === "Enter" && handleLogin()}
                />
                <button
                  type="button"
                  onClick={() => setShowPassword(!showPassword)}
                  className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400 hover:text-gray-600"
                >
                  {showPassword ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                </button>
              </div>
            </div>

            <Button
              onClick={handleLogin}
              disabled={loading}
              className="w-full h-12 bg-emerald-600 hover:bg-emerald-700 text-white font-bold rounded-xl text-sm transition-all"
            >
              {loading ? (
                <div className="flex items-center gap-2">
                  <Loader2 className="w-4 h-4 animate-spin text-white" />
                  <span>جارٍ التحقق...</span>
                </div>
              ) : (
                <div className="flex items-center gap-2">
                  <LogIn className="w-4 h-4 text-white" />
                  <span>دخول</span>
                </div>
              )}
            </Button>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════════════════════
// VISITS VIEW (Unified View containing Form + Logs)
// ═══════════════════════════════════════════════════════════════════════════════
function VisitsView({
  isOnline,
  onPendingChange,
  profile
}: {
  isOnline: boolean;
  onPendingChange: (n: number) => void;
  profile: UserProfile;
}) {
  const [tab, setTab] = useState<"register" | "logs">(profile.role === "coordinator" ? "logs" : "register");

  return (
    <div className="space-y-4">
      {(profile.role === "supervisor" || profile.role === "coordinator") && (
        <div className="flex border-b border-gray-200 max-w-md bg-white p-1 rounded-xl shadow-sm">
          {profile.role !== "coordinator" && (
            <button
              onClick={() => setTab("register")}
              className={`flex-1 text-center py-2 text-xs font-bold rounded-lg transition-all ${
                tab === "register"
                  ? "bg-emerald-600 text-white"
                  : "text-gray-500 hover:text-gray-800 hover:bg-slate-50"
              }`}
            >
              تسجيل زيارة جديدة
            </button>
          )}
          <button
            onClick={() => setTab("logs")}
            className={`flex-1 text-center py-2 text-xs font-bold rounded-lg transition-all ${
              tab === "logs"
                ? "bg-emerald-600 text-white"
                : "text-gray-500 hover:text-gray-800 hover:bg-slate-50"
            }`}
          >
            سجل الزيارات اليومية
          </button>
        </div>
      )}

      <div>
        {profile.role === "nurse" || (tab === "register" && profile.role !== "coordinator") ? (
          <NurseView isOnline={isOnline} onPendingChange={onPendingChange} profile={profile} />
        ) : (
          <VisitsLog profile={profile} />
        )}
      </div>
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════════════════════
// PATIENTS LOG VIEW
// ═══════════════════════════════════════════════════════════════════════════════
function PatientsView() {
  const [patients, setPatients] = useState<any[]>([]);
  const [search, setSearch] = useState("");
  const [loading, setLoading] = useState(true);

  const loadPatients = useCallback(async () => {
    setLoading(true);
    try {
      const url = search ? `/api/patients?search=${encodeURIComponent(search)}` : "/api/patients";
      const data = await resilientFetch<any[]>(url);
      setPatients(data);
    } catch (err: any) {
      toast.error("فشل تحميل قائمة المرضى", { description: err.message });
    } finally {
      setLoading(false);
    }
  }, [search]);

  useEffect(() => {
    loadPatients();
  }, [loadPatients]);

  return (
    <div className="space-y-4">
      {/* Search Filter */}
      <div className="flex gap-2 max-w-md">
        <div className="relative flex-1">
          <Search className="absolute right-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400" />
          <Input
            placeholder="ابحث بالاسم أو الرقم القومي..."
            value={search}
            onChange={e => setSearch(e.target.value)}
            className="h-10 text-xs pr-10 border-gray-200 focus:border-emerald-500 bg-white"
          />
        </div>
        <Button onClick={loadPatients} size="sm" className="bg-emerald-600 hover:bg-emerald-700 h-10 px-4">
          بحث
        </Button>
      </div>

      {loading ? (
        <div className="flex flex-col items-center py-20 gap-3">
          <Loader2 className="w-8 h-8 animate-spin text-emerald-600" />
          <p className="text-xs text-gray-400">جاري تحميل قائمة المرضى...</p>
        </div>
      ) : (
        <Card className="border-0 shadow-md bg-white overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full text-right border-collapse">
              <thead>
                <tr className="bg-slate-50 border-b border-gray-100 text-xs font-bold text-gray-500">
                  <th className="p-4">الاسم بالكامل</th>
                  <th className="p-4">الرقم القومي</th>
                  <th className="p-4">السن</th>
                  <th className="p-4">النوع</th>
                  <th className="p-4">المحافظة</th>
                  <th className="p-4">تاريخ التسجيل</th>
                  <th className="p-4">رقم الهاتف</th>
                </tr>
              </thead>
              <tbody className="text-xs divide-y divide-gray-100">
                {patients.map(p => (
                  <tr key={p.id} className="hover:bg-slate-50/80 transition-colors">
                    <td className="p-4 font-bold text-gray-800">{p.full_name}</td>
                    <td className="p-4 font-mono text-gray-600">{p.national_id}</td>
                    <td className="p-4">{p.age} سنة</td>
                    <td className="p-4">
                      <Badge className={p.gender === "ذكر" ? "bg-blue-50 text-blue-700 border-blue-100" : "bg-pink-50 text-pink-700 border-pink-100"}>
                        {p.gender}
                      </Badge>
                    </td>
                    <td className="p-4 text-gray-600">{p.governorate}</td>
                    <td className="p-4 text-gray-400">
                      {new Date(p.first_visit_date).toLocaleDateString("ar-EG")}
                    </td>
                    <td className="p-4 text-gray-600 font-mono">{p.phone || "—"}</td>
                  </tr>
                ))}
                {patients.length === 0 && (
                  <tr>
                    <td colSpan={7} className="text-center py-10 text-gray-400">
                      لا يوجد مرضى مسجلين حالياً.
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </Card>
      )}
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════════════════════
// DAILY VISITS LOG LIST
// ═══════════════════════════════════════════════════════════════════════════════
function VisitsLog({ profile }: { profile: UserProfile }) {
  const [visits, setVisits] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState("");
  const [selectedVisit, setSelectedVisit] = useState<any | null>(null);

  const [departments, setDepartments] = useState<Department[]>([]);
  const [units, setUnits] = useState<HealthUnit[]>([]);
  const [selectedDept, setSelectedDept] = useState("");
  const [selectedUnit, setSelectedUnit] = useState("");

  useEffect(() => {
    const loadDepts = async () => {
      try {
        const depts = await resilientFetch<Department[]>("/api/departments");
        setDepartments(depts);
      } catch {}
    };
    loadDepts();
  }, []);

  useEffect(() => {
    if (!selectedDept || selectedDept === "all") {
      setUnits([]);
      setSelectedUnit("");
      return;
    }
    const loadUnits = async () => {
      try {
        const data = await resilientFetch<HealthUnit[]>(`/api/units?departmentId=${selectedDept}`);
        setUnits(data);
      } catch {}
    };
    setSelectedUnit("");
    loadUnits();
  }, [selectedDept]);

  const loadVisits = useCallback(async () => {
    setLoading(true);
    try {
      let url = "/api/visits?";
      const params = new URLSearchParams();
      if (search) params.append("search", search);
      if (selectedDept && selectedDept !== "all") params.append("departmentId", selectedDept);
      if (selectedUnit && selectedUnit !== "all") params.append("unitId", selectedUnit);
      url += params.toString();

      const data = await resilientFetch<any[]>(url);
      setVisits(data);
    } catch (err: any) {
      toast.error("فشل تحميل سجل الزيارات", { description: err.message });
    } finally {
      setLoading(false);
    }
  }, [search, selectedDept, selectedUnit]);

  useEffect(() => {
    loadVisits();
  }, [loadVisits]);

  const handleExportExcel = () => {
    if (visits.length === 0) {
      toast.error("لا يوجد بيانات لتصديرها");
      return;
    }

    const dataToExport = visits.map(v => ({
      "اسم المريض": v.patients?.full_name,
      "الرقم القومي": v.patients?.national_id,
      "رقم الهاتف": v.patients?.phone || "",
      "الإدارة الصحية": departments.find(d => d.id === v.health_units?.department_id)?.name || (selectedDept && selectedDept !== "all" ? departments.find(d => d.id === selectedDept)?.name : ""),
      "الوحدة الصحية": v.health_units?.name,
      "نوع الزيارة": v.visit_type,
      "تاريخ الزيارة": new Date(v.visit_date).toLocaleDateString("ar-EG"),
      "وقت الزيارة": new Date(v.visit_date).toLocaleTimeString("ar-EG", { hour: '2-digit', minute: '2-digit' }),
      "الضغط الانقباضي": v.systolic || "",
      "الضغط الانبساطي": v.diastolic || "",
      "نوع السكر": v.sugar_type || "",
      "مستوى السكر": v.sugar_level || "",
      "تراكمي HbA1c": v.hba1c || "",
      "الطول": v.height || "",
      "الوزن": v.weight || "",
      "الإحالة": v.referred ? `محول إلى ${v.referral_dest || "مستشفى"}` : "لا يوجد",
    }));

    const worksheet = XLSX.utils.json_to_sheet(dataToExport);
    const workbook = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(workbook, worksheet, "الزيارات");
    XLSX.writeFile(workbook, "Visits_History.xlsx");
  };

  return (
    <div className="space-y-4">
      {/* Filters and Actions */}
      <div className="flex flex-col sm:flex-row gap-3 bg-white p-4 rounded-2xl shadow-sm border border-slate-100">
        <div className="grid grid-cols-1 sm:grid-cols-4 gap-3 flex-1">
          <div className="relative">
            <Search className="absolute right-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400" />
            <Input
              placeholder="ابحث بالمريض أو الرقم القومي..."
              value={search}
              onChange={e => setSearch(e.target.value)}
              className="h-10 text-xs pr-10 border-gray-200 focus:border-emerald-500 bg-white w-full"
            />
          </div>
          <Select value={selectedDept} onValueChange={setSelectedDept}>
            <SelectTrigger className="h-10 text-xs bg-white border-gray-200">
              <SelectValue placeholder="تصفية بالإدارة الصحية" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all" className="text-xs">كل الإدارات</SelectItem>
              {departments.map(d => (
                <SelectItem key={d.id} value={d.id} className="text-xs">
                  {d.name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <Select value={selectedUnit} onValueChange={setSelectedUnit} disabled={!selectedDept || selectedDept === "all"}>
            <SelectTrigger className="h-10 text-xs bg-white border-gray-200">
              <SelectValue placeholder="تصفية بالوحدة الصحية" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all" className="text-xs">كل الوحدات</SelectItem>
              {units.map(u => (
                <SelectItem key={u.id} value={u.id} className="text-xs">
                  {u.name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <div className="flex gap-2">
            <Button onClick={loadVisits} className="bg-emerald-600 hover:bg-emerald-700 h-10 px-4 flex-1 text-xs">
              تصفية
            </Button>
            <Button onClick={handleExportExcel} variant="outline" className="h-10 px-3 border-emerald-200 text-emerald-700 hover:bg-emerald-50" title="تصدير للإكسيل">
              <Download className="w-4 h-4" />
            </Button>
          </div>
        </div>
      </div>

      {loading ? (
        <div className="flex flex-col items-center py-20 gap-3">
          <Loader2 className="w-8 h-8 animate-spin text-emerald-600" />
          <p className="text-xs text-gray-400">جاري تحميل سجل الزيارات...</p>
        </div>
      ) : (
        <Card className="border-0 shadow-md bg-white overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full text-right border-collapse">
              <thead>
                <tr className="bg-slate-50 border-b border-gray-100 text-xs font-bold text-gray-500">
                  <th className="p-4">المريض</th>
                  <th className="p-4">الوحدة الصحية</th>
                  <th className="p-4">نوع الزيارة</th>
                  <th className="p-4">التاريخ</th>
                  <th className="p-4">الضغط (BP)</th>
                  <th className="p-4">السكر</th>
                  <th className="p-4">الإحالة</th>
                  <th className="p-4 text-center">القياسات</th>
                </tr>
              </thead>
              <tbody className="text-xs divide-y divide-gray-100">
                {visits.map(v => (
                  <tr key={v.id} className="hover:bg-slate-50/80 transition-colors">
                    <td className="p-4">
                      <p className="font-bold text-gray-800 leading-tight">{v.patients?.full_name}</p>
                      <p className="text-[10px] text-gray-400 font-mono mt-0.5">{v.patients?.national_id}</p>
                    </td>
                    <td className="p-4">
                      <p className="font-semibold text-gray-700 leading-tight">{v.health_units?.name}</p>
                      <p className="text-[10px] text-gray-400 font-mono mt-0.5">{v.health_units?.code}</p>
                    </td>
                    <td className="p-4">
                      <Badge className={v.visit_type === "أول مرة" ? "bg-emerald-50 text-emerald-700 border-emerald-100" : "bg-indigo-50 text-indigo-700 border-indigo-100"}>
                        {v.visit_type}
                      </Badge>
                    </td>
                    <td className="p-4 text-gray-500">
                      {new Date(v.visit_date).toLocaleDateString("ar-EG")} {new Date(v.visit_date).toLocaleTimeString("ar-EG", { hour: '2-digit', minute: '2-digit' })}
                    </td>
                    <td className="p-4 font-mono font-semibold text-gray-700">
                      {v.systolic && v.diastolic ? `${v.systolic}/${v.diastolic}` : "—"}
                    </td>
                    <td className="p-4 text-gray-700">
                      {v.sugar_level ? `${v.sugar_level} (${v.sugar_type})` : "—"}
                    </td>
                    <td className="p-4">
                      {v.referred ? (
                        <Badge className="bg-amber-50 text-amber-700 border-amber-100">
                          محول إلى {v.referral_dest || "مستشفى"}
                        </Badge>
                      ) : (
                        <span className="text-gray-400">لا يوجد</span>
                      )}
                    </td>
                    <td className="p-4 text-center">
                      <Button
                        onClick={() => setSelectedVisit(v)}
                        variant="outline"
                        className="text-[10px] px-2 h-7 border-emerald-200 text-emerald-700 hover:bg-emerald-50"
                      >
                        عرض القياسات
                      </Button>
                    </td>
                  </tr>
                ))}
                {visits.length === 0 && (
                  <tr>
                    <td colSpan={8} className="text-center py-10 text-gray-400">
                      لا توجد زيارات مسجلة حالياً.
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </Card>
      )}

      {/* Detailed Measurements Modal */}
      {selectedVisit && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/55 backdrop-blur-sm p-4" dir="rtl">
          <Card className="w-full max-w-md border-0 shadow-2xl bg-white rounded-3xl overflow-hidden animate-in fade-in zoom-in-95 duration-200">
            <CardHeader className="bg-emerald-800 text-white flex flex-row items-center justify-between p-5">
              <div>
                <CardTitle className="text-base font-bold">{selectedVisit.patients?.full_name}</CardTitle>
                <p className="text-[10px] text-emerald-200 mt-1 font-mono">الرقم القومي: {selectedVisit.patients?.national_id}</p>
              </div>
              <button onClick={() => setSelectedVisit(null)} className="p-1.5 bg-white/10 rounded-full hover:bg-white/20 transition-all text-white">
                <X className="w-4 h-4" />
              </button>
            </CardHeader>
            <CardContent className="p-5 space-y-4 max-h-[70vh] overflow-y-auto">
              <div className="grid grid-cols-2 gap-3">
                <MeasurementBox label="الطول" value={selectedVisit.height} suffix="سم" icon={<Ruler className="w-4 h-4 text-emerald-600" />} />
                <MeasurementBox label="الوزن" value={selectedVisit.weight} suffix="كجم" icon={<Weight className="w-4 h-4 text-emerald-600" />} />
                <MeasurementBox label="الضغط الانقباضي" value={selectedVisit.systolic} suffix="mmHg" icon={<Activity className="w-4 h-4 text-emerald-600" />} />
                <MeasurementBox label="الضغط الانبساطي" value={selectedVisit.diastolic} suffix="mmHg" icon={<Activity className="w-4 h-4 text-emerald-600" />} />
                <MeasurementBox label="مستوى السكر" value={selectedVisit.sugar_level} suffix={`mg/dL (${selectedVisit.sugar_type || ""})`} icon={<Droplets className="w-4 h-4 text-emerald-600" />} />
                <MeasurementBox label="تراكمي HbA1c" value={selectedVisit.hba1c} suffix="%" icon={<FlaskConical className="w-4 h-4 text-emerald-600" />} />
                <MeasurementBox label="الكوليسترول" value={selectedVisit.cholesterol} suffix="mg/dL" icon={<FlaskConical className="w-4 h-4 text-emerald-600" />} />
                <MeasurementBox label="الدهون الثلاثية" value={selectedVisit.triglycerides} suffix="mg/dL" icon={<FlaskConical className="w-4 h-4 text-emerald-600" />} />
                <MeasurementBox label="LDL" value={selectedVisit.ldl} suffix="mg/dL" icon={<FlaskConical className="w-4 h-4 text-emerald-600" />} />
                <MeasurementBox label="HDL" value={selectedVisit.hdl} suffix="mg/dL" icon={<FlaskConical className="w-4 h-4 text-emerald-600" />} />
                <MeasurementBox label="الكيرياتينين" value={selectedVisit.creatinine} suffix="mg/dL" icon={<FlaskConical className="w-4 h-4 text-emerald-600" />} />
                <MeasurementBox label="معدل الترشيح eGFR" value={selectedVisit.egfr} suffix="mL/min" icon={<FlaskConical className="w-4 h-4 text-emerald-600" />} />
              </div>

              {selectedVisit.referred && (
                <div className="bg-amber-50 border border-amber-100 rounded-xl p-3 flex gap-2.5 items-start">
                  <Info className="w-4 h-4 text-amber-600 shrink-0 mt-0.5" />
                  <div>
                    <p className="text-[11px] font-bold text-amber-800">بيانات الإحالة</p>
                    <p className="text-xs text-amber-700 mt-0.5">تم تحويل المريض إلى: {selectedVisit.referral_dest || "مستشفى سوهاج العام"}</p>
                  </div>
                </div>
              )}
            </CardContent>
          </Card>
        </div>
      )}
    </div>
  );
}

function MeasurementBox({ label, value, suffix, icon }: { label: string; value: any; suffix: string; icon: React.ReactNode }) {
  return (
    <div className="bg-slate-50 border border-slate-100 rounded-xl p-3 flex items-center gap-2.5">
      <div className="bg-white rounded-lg p-1.5 border border-emerald-50">
        {icon}
      </div>
      <div>
        <p className="text-[10px] text-gray-500 font-semibold">{label}</p>
        <p className="text-xs font-bold text-gray-800 mt-0.5">
          {value !== null && value !== undefined && value !== "" ? `${value} ${suffix}` : "—"}
        </p>
      </div>
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════════════════════
// DEPARTMENTS & UNITS VIEW (Supervisor only)
// ═══════════════════════════════════════════════════════════════════════════════
function DepartmentsUnitsView({ profile }: { profile: UserProfile }) {
  const [tab, setTab] = useState<"departments" | "units">("units");
  const [departments, setDepartments] = useState<any[]>([]);
  const [units, setUnits] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);

  // Modals status
  const [isDeptModalOpen, setIsDeptModalOpen] = useState(false);
  const [isUnitModalOpen, setIsUnitModalOpen] = useState(false);

  // Forms states
  const [deptName, setDeptName] = useState("");
  const [unitCode, setUnitCode] = useState("");
  const [unitName, setUnitName] = useState("");
  const [unitDept, setUnitDept] = useState("");
  const [dailyTarget, setDailyTarget] = useState("");
  const [monthlyTarget, setMonthlyTarget] = useState("");

  const loadData = useCallback(async () => {
    setLoading(true);
    try {
      const depts = await resilientFetch<any[]>("/api/departments");
      setDepartments(depts);
      const unts = await resilientFetch<any[]>("/api/units?includeInactive=true");
      setUnits(unts);
    } catch (err: any) {
      toast.error("فشل تحميل البيانات", { description: err.message });
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    loadData();
  }, [loadData]);

  useEffect(() => {
    if (profile.role === "coordinator" && profile.department_id) {
      setUnitDept(profile.department_id);
    }
  }, [profile]);

  const handleAddDept = async () => {
    if (!deptName) { toast.error("يرجى إدخال اسم الإدارة الصحية"); return; }
    try {
      const res = await fetch("/api/departments", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: deptName }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "فشل إضافة الإدارة");
      toast.success("تم إضافة الإدارة الصحية بنجاح");
      setDeptName("");
      setIsDeptModalOpen(false);
      loadData();
    } catch (err: any) {
      toast.error("فشل الإضافة", { description: err.message });
    }
  };

  const handleAddUnit = async () => {
    if (!unitCode || !unitName || !unitDept) {
      toast.error("يرجى ملء جميع الحقول الإلزامية");
      return;
    }
    try {
      const res = await fetch("/api/units", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          code: unitCode,
          name: unitName,
          departmentId: unitDept,
          dailyTarget: parseInt(dailyTarget) || 15,
          monthlyTarget: parseInt(monthlyTarget) || 300,
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "فشل إضافة الوحدة");
      toast.success("تم إضافة الوحدة الصحية بنجاح");
      setUnitCode("");
      setUnitName("");
      setUnitDept("");
      setDailyTarget("");
      setMonthlyTarget("");
      setIsUnitModalOpen(false);
      loadData();
    } catch (err: any) {
      toast.error("فشل إضافة الوحدة", { description: err.message });
    }
  };

  const toggleUnitActive = async (id: string, active: boolean) => {
    try {
      const res = await fetch("/api/units", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id, active: !active }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "فشل تعديل حالة الوحدة");
      toast.success("تم تعديل حالة الوحدة بنجاح");
      loadData();
    } catch (err: any) {
      toast.error("فشل التعديل", { description: err.message });
    }
  };

  return (
    <div className="space-y-4">
      {/* Header with selector and actions */}
      <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-3 bg-white p-3 rounded-2xl shadow-sm border border-slate-100">
        <div className="flex border border-gray-150 p-1 rounded-xl bg-slate-50 w-full sm:w-auto">
          <button
            onClick={() => setTab("units")}
            className={`px-4 py-2 text-xs font-bold rounded-lg transition-all flex-1 sm:flex-none text-center ${
              tab === "units" ? "bg-emerald-600 text-white" : "text-gray-500 hover:text-gray-700"
            }`}
          >
            الوحدات الصحية
          </button>
          {profile.role !== "coordinator" && (
            <button
              onClick={() => setTab("departments")}
              className={`px-4 py-2 text-xs font-bold rounded-lg transition-all flex-1 sm:flex-none text-center ${
                tab === "departments" ? "bg-emerald-600 text-white" : "text-gray-500 hover:text-gray-700"
              }`}
            >
              الإدارات الصحية
            </button>
          )}
        </div>

        <div className="flex gap-2 w-full sm:w-auto">
          {tab === "departments" ? (
            <Button onClick={() => setIsDeptModalOpen(true)} size="sm" className="bg-emerald-600 hover:bg-emerald-700 text-white gap-1.5 flex-1 sm:flex-none">
              <Plus className="w-4 h-4" />
              إضافة إدارة صحية
            </Button>
          ) : (
            <Button onClick={() => setIsUnitModalOpen(true)} size="sm" className="bg-emerald-600 hover:bg-emerald-700 text-white gap-1.5 flex-1 sm:flex-none">
              <Plus className="w-4 h-4" />
              إضافة وحدة صحية
            </Button>
          )}
        </div>
      </div>

      {loading ? (
        <div className="flex flex-col items-center py-20 gap-3">
          <Loader2 className="w-8 h-8 animate-spin text-emerald-600" />
          <p className="text-xs text-gray-400">جاري تحميل البيانات...</p>
        </div>
      ) : tab === "departments" ? (
        <Card className="border-0 shadow-md bg-white overflow-hidden">
          <table className="w-full text-right border-collapse">
            <thead>
              <tr className="bg-slate-50 border-b border-gray-100 text-xs font-bold text-gray-500">
                <th className="p-4">اسم الإدارة الصحية</th>
                <th className="p-4">تاريخ الإنشاء</th>
              </tr>
            </thead>
            <tbody className="text-xs divide-y divide-gray-100">
              {departments.map(d => (
                <tr key={d.id} className="hover:bg-slate-50/80 transition-colors">
                  <td className="p-4 font-bold text-gray-800">{d.name}</td>
                  <td className="p-4 text-gray-400">{new Date(d.created_at).toLocaleDateString("ar-EG")}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </Card>
      ) : (
        <Card className="border-0 shadow-md bg-white overflow-hidden">
          <table className="w-full text-right border-collapse">
            <thead>
              <tr className="bg-slate-50 border-b border-gray-100 text-xs font-bold text-gray-500">
                <th className="p-4">كود الوحدة</th>
                <th className="p-4">اسم الوحدة</th>
                <th className="p-4">الإدارة الصحية</th>
                <th className="p-4 text-center">الهدف اليومي</th>
                <th className="p-4 text-center">الهدف الشهري</th>
                <th className="p-4 text-center">الحالة</th>
                <th className="p-4 text-center">الإجراءات</th>
              </tr>
            </thead>
            <tbody className="text-xs divide-y divide-gray-100">
              {units.map(u => {
                const deptName = departments.find(d => d.id === u.department_id)?.name || "—";
                return (
                  <tr key={u.id} className="hover:bg-slate-50/80 transition-colors">
                    <td className="p-4 font-mono font-bold text-gray-600">{u.code}</td>
                    <td className="p-4 font-bold text-gray-800">{u.name}</td>
                    <td className="p-4 text-gray-700">{deptName}</td>
                    <td className="p-4 text-center font-semibold text-gray-700">{u.daily_target}</td>
                    <td className="p-4 text-center font-semibold text-gray-700">{u.monthly_target}</td>
                    <td className="p-4 text-center">
                      <Badge className={u.active ? "bg-emerald-50 text-emerald-700 border-emerald-100" : "bg-red-50 text-red-700 border-red-100"}>
                        {u.active ? "نشطة" : "غير نشطة"}
                      </Badge>
                    </td>
                    <td className="p-4 text-center">
                      <Button
                        onClick={() => toggleUnitActive(u.id, u.active)}
                        variant="outline"
                        className={`text-[10px] px-2 h-7 gap-1.5 ${
                          u.active
                            ? "border-red-200 text-red-600 hover:bg-red-50"
                            : "border-emerald-200 text-emerald-600 hover:bg-emerald-50"
                        }`}
                      >
                        {u.active ? (
                          <>
                            <UserX className="w-3.5 h-3.5" />
                            تعطيل
                          </>
                        ) : (
                          <>
                            <UserCheck className="w-3.5 h-3.5" />
                            تفعيل
                          </>
                        )}
                      </Button>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </Card>
      )}

      {/* Department Add Modal */}
      {isDeptModalOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/55 backdrop-blur-sm p-4">
          <Card className="w-full max-w-sm border-0 shadow-2xl bg-white rounded-3xl overflow-hidden animate-in fade-in zoom-in-95 duration-200">
            <CardHeader className="bg-emerald-800 text-white flex flex-row items-center justify-between p-4">
              <CardTitle className="text-sm font-bold">إضافة إدارة صحية جديدة</CardTitle>
              <button onClick={() => setIsDeptModalOpen(false)} className="p-1 rounded-full hover:bg-white/10 text-white">
                <X className="w-4 h-4" />
              </button>
            </CardHeader>
            <CardContent className="p-5 space-y-4">
              <div className="space-y-1.5">
                <Label className="text-xs text-gray-600 font-bold">اسم الإدارة الصحية *</Label>
                <Input
                  placeholder="مثال: إدارة سوهاج الصحية"
                  value={deptName}
                  onChange={e => setDeptName(e.target.value)}
                  className="h-10 text-xs border-gray-200 focus:border-emerald-500"
                />
              </div>
              <div className="flex gap-2 pt-2">
                <Button onClick={handleAddDept} size="sm" className="bg-emerald-600 hover:bg-emerald-700 text-white flex-1">
                  إضافة
                </Button>
                <Button onClick={() => setIsDeptModalOpen(false)} variant="outline" size="sm" className="flex-1">
                  إلغاء
                </Button>
              </div>
            </CardContent>
          </Card>
        </div>
      )}

      {/* Unit Add Modal */}
      {isUnitModalOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/55 backdrop-blur-sm p-4">
          <Card className="w-full max-w-sm border-0 shadow-2xl bg-white rounded-3xl overflow-hidden animate-in fade-in zoom-in-95 duration-200">
            <CardHeader className="bg-emerald-800 text-white flex flex-row items-center justify-between p-4">
              <CardTitle className="text-sm font-bold">إضافة وحدة صحية جديدة</CardTitle>
              <button onClick={() => setIsUnitModalOpen(false)} className="p-1 rounded-full hover:bg-white/10 text-white">
                <X className="w-4 h-4" />
              </button>
            </CardHeader>
            <CardContent className="p-5 space-y-4">
              {profile.role !== "coordinator" && (
                <div className="space-y-1.5">
                  <Label className="text-xs text-gray-600 font-bold">الإدارة الصحية التابعة *</Label>
                  <Select value={unitDept} onValueChange={setUnitDept}>
                    <SelectTrigger className="h-10 text-xs bg-white border-gray-200">
                      <SelectValue placeholder="اختر الإدارة الصحية" />
                    </SelectTrigger>
                    <SelectContent>
                      {departments.map(d => (
                        <SelectItem key={d.id} value={d.id} className="text-xs">
                          {d.name}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
              )}

              <div className="space-y-1.5">
                <Label className="text-xs text-gray-600 font-bold">كود الوحدة الصحية (فريد) *</Label>
                <Input
                  placeholder="مثال: SHG-025"
                  value={unitCode}
                  onChange={e => setUnitCode(e.target.value)}
                  className="h-10 text-xs border-gray-200 font-mono focus:border-emerald-500"
                  dir="ltr"
                />
              </div>

              <div className="space-y-1.5">
                <Label className="text-xs text-gray-600 font-bold">اسم الوحدة الصحية *</Label>
                <Input
                  placeholder="مثال: وحدة صحية روافع القصير"
                  value={unitName}
                  onChange={e => setUnitName(e.target.value)}
                  className="h-10 text-xs border-gray-200 focus:border-emerald-500"
                />
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div className="space-y-1.5">
                  <Label className="text-xs text-gray-600 font-bold">الهدف اليومي</Label>
                  <Input
                    type="number"
                    placeholder="15"
                    value={dailyTarget}
                    onChange={e => setDailyTarget(e.target.value)}
                    className="h-10 text-xs border-gray-200 focus:border-emerald-500"
                  />
                </div>
                <div className="space-y-1.5">
                  <Label className="text-xs text-gray-600 font-bold">الهدف الشهري</Label>
                  <Input
                    type="number"
                    placeholder="300"
                    value={monthlyTarget}
                    onChange={e => setMonthlyTarget(e.target.value)}
                    className="h-10 text-xs border-gray-200 focus:border-emerald-500"
                  />
                </div>
              </div>

              <div className="flex gap-2 pt-2">
                <Button onClick={handleAddUnit} size="sm" className="bg-emerald-600 hover:bg-emerald-700 text-white flex-1">
                  إضافة
                </Button>
                <Button onClick={() => setIsUnitModalOpen(false)} variant="outline" size="sm" className="flex-1">
                  إلغاء
                </Button>
              </div>
            </CardContent>
          </Card>
        </div>
      )}
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════════════════════
// USERS MANAGEMENT VIEW (Supervisor only)
// ═══════════════════════════════════════════════════════════════════════════════
function UsersView() {
  const [users, setUsers] = useState<any[]>([]);
  const [departments, setDepartments] = useState<any[]>([]);
  const [units, setUnits] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [isAddUserOpen, setIsAddUserOpen] = useState(false);

  // Form states
  const [fullName, setFullName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [role, setRole] = useState<"nurse" | "supervisor" | "coordinator">("nurse");
  const [selectedDept, setSelectedDept] = useState("");
  const [selectedUnit, setSelectedUnit] = useState("");

  const loadData = useCallback(async () => {
    setLoading(true);
    try {
      const data = await resilientFetch<any[]>("/api/users");
      setUsers(data);
      const depts = await resilientFetch<any[]>("/api/departments");
      setDepartments(depts);
      const unts = await resilientFetch<any[]>("/api/units");
      setUnits(unts);
    } catch (err: any) {
      toast.error("فشل تحميل قائمة المستخدمين", { description: err.message });
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    loadData();
  }, [loadData]);

  // Filter units based on selected department for new user form
  const filteredUnits = units.filter(u => u.department_id === selectedDept);

  const handleAddUser = async () => {
    if (!fullName || !email || !password || !role) {
      toast.error("يرجى ملء جميع الحقول المطلوبة");
      return;
    }
    try {
      const res = await fetch("/api/users", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          fullName,
          email,
          password,
          role,
          departmentId: selectedDept || null,
          unitId: selectedUnit || null,
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "فشل إضافة حساب المستخدم");
      toast.success("تم إنشاء حساب المستخدم بنجاح");
      setFullName("");
      setEmail("");
      setPassword("");
      setRole("nurse");
      setSelectedDept("");
      setSelectedUnit("");
      setIsAddUserOpen(false);
      loadData();
    } catch (err: any) {
      toast.error("فشل الإنشاء", { description: err.message });
    }
  };

  const toggleUserActive = async (id: string, active: boolean) => {
    try {
      const res = await fetch("/api/users", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id, active: !active }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "فشل تعديل حالة الحساب");
      toast.success("تم تحديث حالة المستخدم بنجاح");
      loadData();
    } catch (err: any) {
      toast.error("فشل التحديث", { description: err.message });
    }
  };

  return (
    <div className="space-y-4">
      {/* Action panel */}
      <div className="flex justify-between items-center bg-white p-3 rounded-2xl shadow-sm border border-slate-100">
        <div>
          <h3 className="text-xs font-bold text-gray-500">حسابات طاقم التمريض والمشرفين</h3>
        </div>
        <Button onClick={() => setIsAddUserOpen(true)} size="sm" className="bg-emerald-600 hover:bg-emerald-700 text-white gap-1.5">
          <Plus className="w-4 h-4" />
          إضافة حساب جديد
        </Button>
      </div>

      {loading ? (
        <div className="flex flex-col items-center py-20 gap-3">
          <Loader2 className="w-8 h-8 animate-spin text-emerald-600" />
          <p className="text-xs text-gray-400">جاري تحميل حسابات المستخدمين...</p>
        </div>
      ) : (
        <Card className="border-0 shadow-md bg-white overflow-hidden">
          <table className="w-full text-right border-collapse">
            <thead>
              <tr className="bg-slate-50 border-b border-gray-100 text-xs font-bold text-gray-500">
                <th className="p-4">اسم المستخدم</th>
                <th className="p-4">البريد الإلكتروني</th>
                <th className="p-4">الصلاحية</th>
                <th className="p-4">الجهة الطبية</th>
                <th className="p-4 text-center">تاريخ الإنشاء</th>
                <th className="p-4 text-center">الحالة</th>
                <th className="p-4 text-center">الإجراءات</th>
              </tr>
            </thead>
            <tbody className="text-xs divide-y divide-gray-100">
              {users.map(u => (
                <tr key={u.id} className="hover:bg-slate-50/80 transition-colors">
                  <td className="p-4 font-bold text-gray-800">{u.full_name}</td>
                  <td className="p-4 font-mono text-gray-600">{u.email}</td>
                  <td className="p-4">
                    <Badge className={u.role === "supervisor" ? "bg-amber-50 text-amber-700 border-amber-100" : u.role === "coordinator" ? "bg-blue-50 text-blue-700 border-blue-100" : "bg-emerald-50 text-emerald-700 border-emerald-100"}>
                      {u.role === "supervisor" ? "مشرف" : u.role === "coordinator" ? "منسق" : "تمريض"}
                    </Badge>
                  </td>
                  <td className="p-4">
                    {u.health_units?.name ? (
                      <p className="leading-tight">{u.health_units.name} <span className="text-[10px] text-gray-400">({u.departments?.name})</span></p>
                    ) : u.departments?.name ? (
                      `إدارة ${u.departments.name}`
                    ) : (
                      <span className="text-gray-400">غير محدد (مديرية الصحة)</span>
                    )}
                  </td>
                  <td className="p-4 text-center text-gray-400">{new Date(u.created_at).toLocaleDateString("ar-EG")}</td>
                  <td className="p-4 text-center">
                    <Badge className={u.active ? "bg-emerald-50 text-emerald-700 border-emerald-100" : "bg-red-50 text-red-700 border-red-100"}>
                      {u.active ? "نشط" : "معطل"}
                    </Badge>
                  </td>
                  <td className="p-4 text-center">
                    <Button
                      onClick={() => toggleUserActive(u.id, u.active)}
                      variant="outline"
                      className={`text-[10px] px-2 h-7 gap-1.5 ${
                        u.active
                          ? "border-red-200 text-red-600 hover:bg-red-50"
                          : "border-emerald-200 text-emerald-600 hover:bg-emerald-50"
                      }`}
                    >
                      {u.active ? (
                        <>
                          <UserX className="w-3.5 h-3.5" />
                          تعطيل الحساب
                        </>
                      ) : (
                        <>
                          <UserCheck className="w-3.5 h-3.5" />
                          تفعيل الحساب
                        </>
                      )}
                    </Button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </Card>
      )}

      {/* Add User Modal */}
      {isAddUserOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/55 backdrop-blur-sm p-4">
          <Card className="w-full max-w-sm border-0 shadow-2xl bg-white rounded-3xl overflow-hidden animate-in fade-in zoom-in-95 duration-200">
            <CardHeader className="bg-emerald-800 text-white flex flex-row items-center justify-between p-4">
              <CardTitle className="text-sm font-bold">إنشاء حساب مستخدم جديد</CardTitle>
              <button onClick={() => setIsAddUserOpen(false)} className="p-1 rounded-full hover:bg-white/10 text-white">
                <X className="w-4 h-4" />
              </button>
            </CardHeader>
            <CardContent className="p-5 space-y-4 max-h-[75vh] overflow-y-auto">
              <div className="space-y-1.5">
                <Label className="text-xs text-gray-600 font-bold">الاسم بالكامل *</Label>
                <Input
                  placeholder="مثال: أسماء أحمد علي"
                  value={fullName}
                  onChange={e => setFullName(e.target.value)}
                  className="h-10 text-xs border-gray-200 focus:border-emerald-500"
                />
              </div>

              <div className="space-y-1.5">
                <Label className="text-xs text-gray-600 font-bold">البريد الإلكتروني *</Label>
                <Input
                  placeholder="name@example.com"
                  value={email}
                  onChange={e => setEmail(e.target.value)}
                  className="h-10 text-xs border-gray-200 focus:border-emerald-500"
                  dir="ltr"
                />
              </div>

              <div className="space-y-1.5">
                <Label className="text-xs text-gray-600 font-bold">كلمة المرور المؤقتة *</Label>
                <Input
                  type="password"
                  placeholder="••••••••"
                  value={password}
                  onChange={e => setPassword(e.target.value)}
                  className="h-10 text-xs border-gray-200 focus:border-emerald-500"
                  dir="ltr"
                />
              </div>

              <div className="space-y-1.5">
                <Label className="text-xs text-gray-600 font-bold">الصلاحية ونوع المستخدم *</Label>
                <Select value={role} onValueChange={(val: any) => setRole(val)}>
                  <SelectTrigger className="h-10 text-xs bg-white border-gray-200">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="nurse" className="text-xs">ممرض / ممرضة</SelectItem>
                    <SelectItem value="coordinator" className="text-xs">منسق إدارة</SelectItem>
                    <SelectItem value="supervisor" className="text-xs">مشرف المبادرة</SelectItem>
                  </SelectContent>
                </Select>
              </div>

              {/* Show unit and department selections only for nurses or coordinators */}
              {(role === "nurse" || role === "coordinator") && (
                <>
                  <div className="space-y-1.5">
                    <Label className="text-xs text-gray-600 font-bold">الإدارة الصحية *</Label>
                    <Select value={selectedDept} onValueChange={setSelectedDept}>
                      <SelectTrigger className="h-10 text-xs bg-white border-gray-200">
                        <SelectValue placeholder="اختر الإدارة الصحية" />
                      </SelectTrigger>
                      <SelectContent>
                        {departments.map(d => (
                          <SelectItem key={d.id} value={d.id} className="text-xs">
                            {d.name}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>

                  {role === "nurse" && (
                    <div className="space-y-1.5">
                      <Label className="text-xs text-gray-600 font-bold">الوحدة الصحية المعين بها *</Label>
                      <Select value={selectedUnit} onValueChange={setSelectedUnit} disabled={!selectedDept}>
                        <SelectTrigger className="h-10 text-xs bg-white border-gray-200">
                          <SelectValue placeholder="اختر الوحدة الصحية" />
                        </SelectTrigger>
                        <SelectContent>
                          {filteredUnits.map(u => (
                            <SelectItem key={u.id} value={u.id} className="text-xs">
                              {u.name}
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    </div>
                  )}
                </>
              )}

              <div className="flex gap-2 pt-2">
                <Button onClick={handleAddUser} size="sm" className="bg-emerald-600 hover:bg-emerald-700 text-white flex-1">
                  إنشاء الحساب
                </Button>
                <Button onClick={() => setIsAddUserOpen(false)} variant="outline" size="sm" className="flex-1">
                  إلغاء
                </Button>
              </div>
            </CardContent>
          </Card>
        </div>
      )}
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════════════════════
// REGISTRATION FORM SUB-VIEW (Original NurseView)
// ═══════════════════════════════════════════════════════════════════════════════
function NurseView({
  isOnline,
  onPendingChange,
  profile
}: {
  isOnline: boolean;
  onPendingChange: (n: number) => void;
  profile: UserProfile;
}) {
  const [departments, setDepartments] = useState<Department[]>([]);
  const [units, setUnits] = useState<HealthUnit[]>([]);
  const [selectedDept, setSelectedDept] = useState("");
  const [selectedUnit, setSelectedUnit] = useState("");

  // Patient fields
  const [nationalId, setNationalId] = useState("");
  const [idInfo, setIdInfo] = useState<ReturnType<typeof parseNationalId> | null>(null);
  const [fullName, setFullName] = useState("");
  const [phone, setPhone] = useState("");

  // Measurements
  const [weight, setWeight] = useState("");
  const [height, setHeight] = useState("");
  const [sugarType, setSugarType] = useState<"صائم" | "عشوائي" | "">("");
  const [sugarLevel, setSugarLevel] = useState("");
  const [hba1c, setHba1c] = useState("");
  const [systolic, setSystolic] = useState("");
  const [diastolic, setDiastolic] = useState("");
  const [cholesterol, setCholesterol] = useState("");
  const [triglycerides, setTriglycerides] = useState("");
  const [ldl, setLdl] = useState("");
  const [hdl, setHdl] = useState("");
  const [creatinine, setCreatinine] = useState("");
  const [egfr, setEgfr] = useState("");

  // Referral
  const [referred, setReferred] = useState(false);
  const [referralDest, setReferralDest] = useState("");

  const [submitting, setSubmitting] = useState(false);

  // Load departments from API (with cache fallback)
  useEffect(() => {
    const loadDepts = async () => {
      try {
        const cached = localStorage.getItem(DEPARTMENTS_CACHE_KEY);
        if (cached) setDepartments(JSON.parse(cached));

        if (isOnline) {
          const data = await resilientFetch<Department[]>("/api/departments");
          setDepartments(data);
          localStorage.setItem(DEPARTMENTS_CACHE_KEY, JSON.stringify(data));
        }
      } catch {
        const cached = localStorage.getItem(DEPARTMENTS_CACHE_KEY);
        if (cached) setDepartments(JSON.parse(cached));
      }
    };
    loadDepts();
  }, [isOnline]);

  // Load units when department changes
  useEffect(() => {
    if (!selectedDept) { setUnits([]); setSelectedUnit(""); return; }

    const loadUnits = async () => {
      try {
        const cacheKey = `${UNITS_CACHE_KEY}_${selectedDept}`;
        const cached = localStorage.getItem(cacheKey);
        if (cached) setUnits(JSON.parse(cached));

        if (isOnline) {
          const data = await resilientFetch<HealthUnit[]>(`/api/units?departmentId=${selectedDept}`);
          setUnits(data);
          localStorage.setItem(cacheKey, JSON.stringify(data));
        }
      } catch {
        const cacheKey = `${UNITS_CACHE_KEY}_${selectedDept}`;
        const cached = localStorage.getItem(cacheKey);
        if (cached) setUnits(JSON.parse(cached));
      }
    };
    setSelectedUnit("");
    loadUnits();
  }, [selectedDept, isOnline]);

  // Prefill and lock if profile has assigned unit
  useEffect(() => {
    if (profile.role === "nurse" && profile.department_id && profile.unit_id) {
      setSelectedDept(profile.department_id);
      
      // Explicitly load the units of the department to ensure our unit lists has it
      const loadNurseUnit = async () => {
        try {
          if (isOnline) {
            const data = await resilientFetch<HealthUnit[]>(`/api/units?departmentId=${profile.department_id}`);
            setUnits(data);
          }
        } catch {}
      };
      loadNurseUnit().then(() => {
        setSelectedUnit(profile.unit_id!);
      });
    }
  }, [profile, isOnline]);

  // Live national ID validation
  useEffect(() => {
    const cleaned = nationalId.replace(/\D/g, "");
    if (cleaned.length === 14) {
      setIdInfo(parseNationalId(cleaned));
    } else {
      setIdInfo(null);
    }
  }, [nationalId]);

  const handleSubmit = async () => {
    if (!selectedDept || !selectedUnit) { toast.error("يرجى اختيار الإدارة والوحدة الصحية"); return; }
    if (!fullName || fullName.trim().split(" ").length < 3) {
      toast.error("يرجى إدخال اسم المريض ثلاثي على الأقل");
      return;
    }
    if (!idInfo || !idInfo.valid) { toast.error("يرجى إدخال رقم قومي صحيح مكون من 14 رقماً"); return; }

    const payload: VisitSubmission = {
      nationalId,
      fullName,
      phone: phone || undefined,
      departmentId: selectedDept,
      unitId: selectedUnit,
      weight: weight ? parseFloat(weight) : undefined,
      height: height ? parseFloat(height) : undefined,
      sugarType: sugarType || undefined,
      sugarLevel: sugarLevel ? parseFloat(sugarLevel) : undefined,
      hba1c: hba1c ? parseFloat(hba1c) : undefined,
      systolic: systolic ? parseFloat(systolic) : undefined,
      diastolic: diastolic ? parseFloat(diastolic) : undefined,
      cholesterol: cholesterol ? parseFloat(cholesterol) : undefined,
      triglycerides: triglycerides ? parseFloat(triglycerides) : undefined,
      ldl: ldl ? parseFloat(ldl) : undefined,
      hdl: hdl ? parseFloat(hdl) : undefined,
      creatinine: creatinine ? parseFloat(creatinine) : undefined,
      egfr: egfr ? parseFloat(egfr) : undefined,
      referred,
      referralDest: referred ? referralDest : undefined,
    };

    setSubmitting(true);
    try {
      if (!isOnline) {
        addToQueue(payload);
        toast.info("تم حفظ الزيارة محلياً بجهازك وسيتم إرسالها بمجرد عودة الاتصال");
        onPendingChange(loadQueue().length);
        resetForm();
      } else {
        const res = await fetch("/api/visits", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(payload),
        });
        const body = await res.json();
        if (!res.ok) throw new Error(body.error || "خطأ غير معروف");

        toast.success(body.message || "تم تسجيل الزيارة بنجاح");
        resetForm();
      }
    } catch (e: any) {
      toast.error("فشل تسجيل الزيارة", { description: e.message });
    } finally {
      setSubmitting(false);
    }
  };

  const resetForm = () => {
    setNationalId("");
    setFullName("");
    setPhone("");
    setWeight("");
    setHeight("");
    setSugarType("");
    setSugarLevel("");
    setHba1c("");
    setSystolic("");
    setDiastolic("");
    setCholesterol("");
    setTriglycerides("");
    setLdl("");
    setHdl("");
    setCreatinine("");
    setEgfr("");
    setReferred(false);
    setReferralDest("");
    setIdInfo(null);
  };

  const assignedUnitName = units.find(u => u.id === selectedUnit)?.name;

  return (
    <div className="space-y-4 max-w-lg mx-auto">
      {/* ── Section: Health Facility ── */}
      {profile.role === "nurse" && profile.unit_id && profile.department_id ? (
        <div className="bg-emerald-50/80 backdrop-blur-md border border-emerald-100 rounded-2xl p-4 flex items-center justify-between shadow-sm">
          <div>
            <p className="text-[10px] text-emerald-700 font-bold">الوحدة الصحية المسجل بها</p>
            <h3 className="text-sm font-extrabold text-emerald-950 mt-1">
              {assignedUnitName || "وحدة صحية سوهاج"}
            </h3>
            <p className="text-[10px] text-emerald-600/80 mt-0.5">
              الإدارة: {departments.find(d => d.id === selectedDept)?.name || "تحميل الإدارة..."}
            </p>
          </div>
          <Badge className="bg-emerald-600 hover:bg-emerald-600 text-white px-2.5 py-0.5 text-[10px] border-0">
            مؤمن
          </Badge>
        </div>
      ) : (
        <Card className="border-0 shadow-md bg-white">
          <CardContent className="p-4 space-y-3">
            <div className="space-y-1.5">
              <Label className="text-xs font-semibold text-gray-700">الإدارة الصحية *</Label>
              <Select value={selectedDept} onValueChange={setSelectedDept}>
                <SelectTrigger className="h-10 text-xs bg-white border-gray-200 focus:border-emerald-500">
                  <SelectValue placeholder="اختر الإدارة الصحية" />
                </SelectTrigger>
                <SelectContent>
                  {departments.map(d => (
                    <SelectItem key={d.id} value={d.id} className="text-xs">
                      {d.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            <div className="space-y-1.5">
              <Label className="text-xs font-semibold text-gray-700">الوحدة الصحية التابعة *</Label>
              <Select value={selectedUnit} onValueChange={setSelectedUnit} disabled={!selectedDept}>
                <SelectTrigger className="h-10 text-xs bg-white border-gray-200 focus:border-emerald-500">
                  <SelectValue placeholder="اختر الوحدة الصحية" />
                </SelectTrigger>
                <SelectContent>
                  {units.map(u => (
                    <SelectItem key={u.id} value={u.id} className="text-xs">
                      {u.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </CardContent>
        </Card>
      )}

      {/* ── Section: Patient Info ── */}
      <Card className="border-0 shadow-md bg-white">
        <CardHeader className="bg-slate-50 border-b border-gray-100 py-3.5 px-4 flex-row items-center gap-2">
          <div className="p-1.5 bg-emerald-50 rounded-lg">
            <Users className="w-4 h-4 text-emerald-600" />
          </div>
          <CardTitle className="text-xs font-bold text-gray-700">بيانات المريض الأساسية</CardTitle>
        </CardHeader>
        <CardContent className="p-4 space-y-4">
          {/* National ID */}
          <div className="space-y-1.5">
            <div className="flex justify-between items-center">
              <Label className="text-xs font-semibold text-gray-700">الرقم القومي (14 رقم) *</Label>
              {idInfo && (
                <span className={`text-[10px] font-bold ${idInfo.valid ? "text-emerald-600" : "text-red-500"}`}>
                  {idInfo.valid ? "رقم قومي مطابق ✓" : idInfo.error}
                </span>
              )}
            </div>
            <div className="relative">
              <Input
                placeholder="29012342600000"
                value={nationalId}
                onChange={e => setNationalId(e.target.value.replace(/\D/g, "").slice(0, 14))}
                className={`h-11 text-sm font-mono pr-3 border-gray-200 focus:border-emerald-500 ${
                  idInfo ? (idInfo.valid ? "border-emerald-300 bg-emerald-50/10 focus:ring-emerald-200" : "border-red-300 bg-red-50/10 focus:ring-red-200") : ""
                }`}
                style={{ direction: "ltr", textAlign: "left" }}
              />
            </div>
          </div>

          {/* Decoded Info Chips */}
          {idInfo?.valid && (
            <div className="grid grid-cols-3 gap-2 bg-emerald-50/40 p-3 rounded-xl border border-emerald-100/50">
              <InfoChip label="تاريخ الميلاد" value={formatBirthDate(idInfo.birthDate!)} />
              <InfoChip label="السن" value={`${idInfo.age} سنة`} />
              <InfoChip label="النوع" value={idInfo.gender!} />
              <InfoChip label="محافظة الميلاد" value={idInfo.governorate!} full />
            </div>
          )}

          {/* Full Name */}
          <div className="space-y-1.5">
            <Label className="text-xs font-semibold text-gray-700">الاسم رباعي *</Label>
            <Input
              placeholder="الاسم كامل كما بالبطاقة"
              value={fullName}
              onChange={e => setFullName(e.target.value)}
              className="h-11 text-sm border-gray-200 focus:border-emerald-500"
            />
          </div>

          {/* Phone */}
          <div className="space-y-1.5">
            <Label className="text-xs font-semibold text-gray-700">رقم الهاتف (اختياري)</Label>
            <Input
              placeholder="01xxxxxxxxx"
              value={phone}
              onChange={e => setPhone(e.target.value.replace(/\D/g, "").slice(0, 11))}
              className="h-11 text-sm border-gray-200 focus:border-emerald-500 font-mono"
              dir="ltr"
              style={{ direction: "ltr", textAlign: "left" }}
            />
          </div>
        </CardContent>
      </Card>

      {/* ── Section: Measurements ── */}
      <Card className="border-0 shadow-md bg-white">
        <CardHeader className="bg-slate-50 border-b border-gray-100 py-3.5 px-4 flex-row items-center gap-2">
          <div className="p-1.5 bg-emerald-50 rounded-lg">
            <Activity className="w-4 h-4 text-emerald-600" />
          </div>
          <CardTitle className="text-xs font-bold text-gray-700">القياسات والتحاليل الطبية</CardTitle>
        </CardHeader>
        <CardContent className="p-4 space-y-4">
          <div className="grid grid-cols-2 gap-3">
            <MeasureInput label="الوزن (كجم)" value={weight} onChange={setWeight} placeholder="75" />
            <MeasureInput label="الطول (سم)" value={height} onChange={setHeight} placeholder="170" />
          </div>

          <div className="border-t border-gray-100 my-2 pt-3">
            <p className="text-[11px] font-bold text-emerald-800 mb-2.5 flex items-center gap-1.5">
              <Droplets className="w-3.5 h-3.5" />
              مستوى سكر الدم
            </p>
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1">
                <Label className="text-[11px] text-gray-500">نوع التحليل</Label>
                <Select value={sugarType} onValueChange={(v: any) => setSugarType(v)}>
                  <SelectTrigger className="h-9 text-xs bg-white border-gray-200">
                    <SelectValue placeholder="اختر النوع" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="صائم" className="text-xs">صائم</SelectItem>
                    <SelectItem value="عشوائي" className="text-xs">عشوائي</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <MeasureInput label="القياس (mg/dL)" value={sugarLevel} onChange={setSugarLevel} placeholder="120" />
            </div>
            <div className="mt-3">
              <MeasureInput label="سكر تراكمي HbA1c (%)" value={hba1c} onChange={setHba1c} placeholder="5.7" />
            </div>
          </div>

          <div className="border-t border-gray-100 my-2 pt-3">
            <p className="text-[11px] font-bold text-emerald-800 mb-2 flex items-center gap-1.5">
              <Stethoscope className="w-3.5 h-3.5" />
              ضغط الدم
            </p>
            <div className="grid grid-cols-2 gap-3">
              <MeasureInput label="الانقباضي Systolic (العالي)" value={systolic} onChange={setSystolic} placeholder="120" />
              <MeasureInput label="الانبساطي Diastolic (الواطي)" value={diastolic} onChange={setDiastolic} placeholder="80" />
            </div>
          </div>

          <div className="border-t border-gray-100 my-2 pt-3">
            <p className="text-[11px] font-bold text-emerald-800 mb-2 flex items-center gap-1.5">
              <FlaskConical className="w-3.5 h-3.5" />
              وظائف الكلى والدهون
            </p>
            <Collapsible>
              <CollapsibleTrigger asChild>
                <Button variant="ghost" size="sm" className="w-full justify-between h-8 text-[11px] text-gray-500 hover:text-emerald-700 bg-slate-50 px-2 rounded-lg">
                  <span>إدخال دهون الدم ووظائف الكلى</span>
                  <ChevronDown className="w-3.5 h-3.5" />
                </Button>
              </CollapsibleTrigger>
              <CollapsibleContent className="pt-3 space-y-3">
                <div className="grid grid-cols-2 gap-3">
                  <MeasureInput label="الكوليسترول الكلي" value={cholesterol} onChange={setCholesterol} placeholder="180" />
                  <MeasureInput label="الدهون الثلاثية" value={triglycerides} onChange={setTriglycerides} placeholder="150" />
                  <MeasureInput label="الكوليسترول الضار LDL" value={ldl} onChange={setLdl} placeholder="100" />
                  <MeasureInput label="الكوليسترول النافع HDL" value={hdl} onChange={setHdl} placeholder="50" />
                  <MeasureInput label="الكرياتينين بالدم" value={creatinine} onChange={setCreatinine} placeholder="0.9" />
                  <MeasureInput label="معدل الترشيح eGFR" value={egfr} onChange={setEgfr} placeholder="90" />
                </div>
              </CollapsibleContent>
            </Collapsible>
          </div>
        </CardContent>
      </Card>

      {/* ── Section: Referral ── */}
      <Card className="border-0 shadow-md bg-white">
        <CardContent className="p-4 space-y-4">
          <div className="flex items-center justify-between">
            <div className="space-y-0.5">
              <Label className="text-xs font-bold text-gray-700">إحالة إلى مستوى طبي أعلى</Label>
              <p className="text-[10px] text-gray-400">إذا كانت القياسات مرتفعة جداً وتتطلب استشارة طبيب أخصائي</p>
            </div>
            <input
              type="checkbox"
              checked={referred}
              onChange={e => setReferred(e.target.checked)}
              className="w-4.5 h-4.5 text-emerald-600 border-gray-300 rounded focus:ring-emerald-500 scale-110"
            />
          </div>

          {referred && (
            <div className="space-y-1.5 border-t border-gray-50 pt-3 animate-in fade-in slide-in-from-top-1 duration-200">
              <Label className="text-xs font-semibold text-gray-700">جهة التحويل / المستشفى *</Label>
              <Input
                placeholder="مثال: مستشفى سوهاج العام"
                value={referralDest}
                onChange={e => setReferralDest(e.target.value)}
                className="h-10 text-sm border-gray-200 focus:border-emerald-500"
              />
            </div>
          )}
        </CardContent>
      </Card>

      {/* ── Submit ── */}
      <Button
        onClick={handleSubmit}
        disabled={submitting}
        className="w-full h-12 text-sm font-bold bg-emerald-600 hover:bg-emerald-700 text-white rounded-xl shadow-lg hover:opacity-95 transition-all active:scale-[0.98]"
      >
        {submitting ? (
          <div className="flex items-center gap-2">
            <Loader2 className="w-4 h-4 animate-spin text-white" />
            <span>جارٍ التسجيل...</span>
          </div>
        ) : isOnline ? (
          <div className="flex items-center gap-2">
            <CheckCircle className="w-4 h-4 text-white" />
            <span>تسجيل زيارة المريض</span>
          </div>
        ) : (
          <div className="flex items-center gap-2">
            <WifiOff className="w-4 h-4 text-white" />
            <span>حفظ محلياً (غير متصل)</span>
          </div>
        )}
      </Button>
    </div>
  );
}

// ── Helper Components ──────────────────────────────────────────────────────────
function InfoChip({ label, value, full }: { label: string; value: string; full?: boolean }) {
  return (
    <div className={`bg-white rounded-lg px-2 py-1.5 border border-emerald-100 ${full ? "col-span-3" : ""}`}>
      <p className="text-[9px] text-emerald-600 font-semibold">{label}</p>
      <p className="text-[11px] font-bold text-gray-800 mt-0.5">{value}</p>
    </div>
  );
}

function MeasureInput({ label, value, onChange, placeholder }: {
  label: string; value: string; onChange: (v: string) => void; placeholder?: string;
}) {
  return (
    <div className="space-y-1">
      <Label className="text-[10px] text-gray-500 font-semibold">{label}</Label>
      <Input
        type="number"
        step="any"
        placeholder={placeholder}
        value={value}
        onChange={e => onChange(e.target.value)}
        className="h-9 text-xs border-gray-200 focus:border-emerald-500 ltr-input"
        dir="ltr"
        style={{ direction: "ltr", textAlign: "left" }}
      />
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════════════════════
// SUPERVISOR DASHBOARD VIEW
// ═══════════════════════════════════════════════════════════════════════════════
function SupervisorDashboard({ onLogout }: { onLogout: () => void }) {
  const [stats, setStats] = useState<DashboardStats | null>(null);
  const [units, setUnits] = useState<UnitStats[]>([]);
  const [search, setSearch] = useState("");
  const [loading, setLoading] = useState(true);
  const [openDepts, setOpenDepts] = useState<Record<string, boolean>>({});

  const loadData = useCallback(async () => {
    setLoading(true);
    try {
      const data = await resilientFetch<{ stats: DashboardStats; units: UnitStats[] }>("/api/dashboard");
      setStats(data.stats);
      setUnits(data.units);
      const deptMap: Record<string, boolean> = {};
      data.units.forEach(u => { deptMap[u.department_id] = true; });
      setOpenDepts(deptMap);
    } catch (err: any) {
      toast.error("فشل تحميل البيانات", { description: err.message });
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { loadData(); }, [loadData]);

  const deptGroups = units.reduce<Record<string, UnitStats[]>>((acc, u) => {
    if (!acc[u.department_id]) acc[u.department_id] = [];
    acc[u.department_id].push(u);
    return acc;
  }, {});

  const filteredGroups = Object.entries(deptGroups).reduce<Record<string, UnitStats[]>>((acc, [deptId, deptUnits]) => {
    const filtered = deptUnits.filter(u =>
      !search || u.name.includes(search) || u.code.toLowerCase().includes(search.toLowerCase())
    );
    if (filtered.length > 0) acc[deptId] = filtered;
    return acc;
  }, {});

  return (
    <div className="space-y-4">
      {/* Header Row */}
      <div className="flex items-center justify-between bg-white p-3 rounded-2xl shadow-sm border border-slate-100">
        <div>
          <h2 className="text-xs font-bold text-gray-500">إحصائيات مبادرة الأمراض المزمنة</h2>
        </div>
        <Button
          onClick={loadData}
          variant="outline"
          size="sm"
          disabled={loading}
          className="h-8 text-xs border-emerald-200 text-emerald-700 hover:bg-emerald-50"
        >
          <RefreshCw className={`w-3.5 h-3.5 ml-1 ${loading ? "animate-spin" : ""}`} />
          تحديث الإحصائيات
        </Button>
      </div>

      {loading && !stats ? (
        <div className="flex flex-col items-center justify-center py-20 gap-3">
          <Loader2 className="w-8 h-8 animate-spin text-emerald-600" />
          <p className="text-xs text-gray-400">جارٍ تحميل البيانات...</p>
        </div>
      ) : stats ? (
        <>
          {/* Stats Grid */}
          <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
            <StatCard
              icon={<Users className="w-5 h-5" />}
              label="إجمالي المرضى"
              value={stats.totalPatients.toLocaleString("ar-EG")}
              color="emerald"
            />
            <StatCard
              icon={<ClipboardList className="w-5 h-5" />}
              label="إجمالي الزيارات"
              value={stats.totalVisits.toLocaleString("ar-EG")}
              color="teal"
            />
            <StatCard
              icon={<Calendar className="w-5 h-5" />}
              label="زيارات اليوم"
              value={stats.todayVisits.toLocaleString("ar-EG")}
              color="blue"
            />
            <StatCard
              icon={<Building2 className="w-5 h-5" />}
              label="الوحدات النشطة"
              value={stats.activeUnits.toLocaleString("ar-EG")}
              color="purple"
            />
          </div>

          {/* Summary Card */}
          <Card className="border-0 shadow-md bg-white">
            <CardContent className="px-4 py-3">
              <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
                <SummaryItem label="مرضى جدد" value={stats.newPatients} color="emerald" />
                <SummaryItem label="مترددون" value={stats.returningPatients} color="blue" />
                <SummaryItem label="محولون (إحالة)" value={stats.referrals} color="amber" />
                <SummaryItem label="وحدات غير نشطة" value={stats.inactiveUnits} color="red" />
              </div>
            </CardContent>
          </Card>

          {/* Search */}
          <div className="relative max-w-md">
            <Search className="absolute right-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400" />
            <Input
              placeholder="ابحث عن وحدة صحية..."
              value={search}
              onChange={e => setSearch(e.target.value)}
              className="h-10 text-xs pr-10 border-gray-200 focus:border-emerald-500 bg-white"
            />
          </div>

          {/* Departments with Units */}
          <div className="space-y-3">
            {Object.entries(filteredGroups).map(([deptId, deptUnits]) => {
              const deptName = deptUnits[0]?.department_name || "قسم غير محدد";
              const isOpen = openDepts[deptId] !== false;
              const totalToday = deptUnits.reduce((s, u) => s + u.today_visits, 0);
              const totalTarget = deptUnits.reduce((s, u) => s + u.daily_target, 0);

              return (
                <Collapsible
                  key={deptId}
                  open={isOpen}
                  onOpenChange={open => setOpenDepts(prev => ({ ...prev, [deptId]: open }))}
                >
                  <Card className="border-0 shadow-md bg-white overflow-hidden">
                    <CollapsibleTrigger asChild>
                      <button className="w-full px-4 py-3 flex items-center justify-between hover:bg-emerald-50/55 transition-colors">
                        <div className="flex items-center gap-2">
                          <div className="w-2 h-2 rounded-full bg-emerald-500" />
                          <span className="font-bold text-xs text-gray-800">{deptName}</span>
                          <Badge variant="secondary" className="text-[10px] bg-emerald-100 text-emerald-700">
                            {deptUnits.length} وحدة
                          </Badge>
                        </div>
                        <div className="flex items-center gap-3">
                          <span className="text-[11px] font-bold text-gray-500">
                            {totalToday}/{totalTarget} اليوم
                          </span>
                          {isOpen ? (
                            <ChevronUp className="w-4 h-4 text-gray-400" />
                          ) : (
                            <ChevronDown className="w-4 h-4 text-gray-400" />
                          )}
                        </div>
                      </button>
                    </CollapsibleTrigger>

                    <CollapsibleContent>
                      <div className="px-4 pb-3 space-y-2 border-t border-gray-50 pt-2 bg-slate-50/40">
                        {deptUnits.map(unit => {
                          const pct = unit.daily_target > 0
                            ? Math.min(100, Math.round((unit.today_visits / unit.daily_target) * 100))
                            : 0;
                          const progressClass = pct >= 80 ? "progress-high" : pct >= 40 ? "progress-medium" : "progress-low";

                          return (
                            <div key={unit.id} className="bg-white rounded-xl p-3 border border-gray-100 shadow-sm flex flex-col gap-2">
                              <div className="flex items-start justify-between">
                                <div>
                                  <div className="flex items-center gap-1.5 mb-1">
                                    <span className="text-[9px] font-mono text-gray-400 bg-gray-100 px-1.5 py-0.5 rounded">
                                      {unit.code}
                                    </span>
                                    {!unit.active && (
                                      <Badge variant="destructive" className="text-[8px] px-1.5 py-0">
                                        غير نشطة
                                      </Badge>
                                    )}
                                  </div>
                                  <p className="text-xs font-bold text-gray-800 leading-tight">
                                    {unit.name}
                                  </p>
                                </div>
                                <div className="text-left ml-1 shrink-0">
                                  <p className={`text-sm font-black ${
                                    pct >= 80 ? "text-emerald-600" : pct >= 40 ? "text-amber-600" : "text-red-600"
                                  }`}>
                                    {unit.today_visits}
                                  </p>
                                  <p className="text-[8px] text-gray-400">من {unit.daily_target}</p>
                                </div>
                              </div>
                              <div className="space-y-1">
                                <div className={`${progressClass}`}>
                                  <Progress value={pct} className="h-1.5" />
                                </div>
                                <div className="flex justify-between text-[9px] text-gray-400">
                                  <span>{pct}% من الهدف اليومي</span>
                                  <span className="font-semibold text-emerald-800">الشهر: {unit.month_visits} زيارة</span>
                                </div>
                              </div>
                            </div>
                          );
                        })}
                      </div>
                    </CollapsibleContent>
                  </Card>
                </Collapsible>
              );
            })}
          </div>

          {Object.keys(filteredGroups).length === 0 && search && (
            <div className="text-center py-12 text-gray-400 bg-white rounded-2xl shadow-sm">
              <Search className="w-8 h-8 mx-auto mb-2 opacity-30" />
              <p className="text-xs">لا توجد نتائج لـ "{search}"</p>
            </div>
          )}
        </>
      ) : null}
    </div>
  );
}

function StatCard({ icon, label, value, color }: {
  icon: React.ReactNode; label: string; value: string; color: string;
}) {
  const colorMap: Record<string, string> = {
    emerald: "bg-emerald-50 text-emerald-600 border-emerald-100/50",
    teal: "bg-teal-50 text-teal-600 border-teal-100/50",
    blue: "bg-blue-50 text-blue-600 border-blue-100/50",
    purple: "bg-purple-50 text-purple-600 border-purple-100/50",
  };
  const iconClass = colorMap[color] || colorMap.emerald;

  return (
    <Card className="border-0 shadow-md bg-white card-hover">
      <CardContent className="p-4 flex items-center gap-3">
        <div className={`p-2.5 rounded-xl border shrink-0 ${iconClass}`}>
          {icon}
        </div>
        <div>
          <p className="text-xs text-gray-500 font-semibold">{label}</p>
          <p className="text-lg font-black text-gray-800 leading-none mt-1.5">{value}</p>
        </div>
      </CardContent>
    </Card>
  );
}

function SummaryItem({ label, value, color }: { label: string; value: number; color: string }) {
  const colorMap: Record<string, string> = {
    emerald: "text-emerald-700 bg-emerald-50",
    blue: "text-blue-700 bg-blue-50",
    amber: "text-amber-700 bg-amber-50",
    red: "text-red-700 bg-red-50",
  };
  return (
    <div className={`rounded-xl p-2.5 flex items-center justify-between ${colorMap[color] || ""}`}>
      <span className="text-[10px] font-bold">{label}</span>
      <span className="text-xs font-black">{value.toLocaleString("ar-EG")}</span>
    </div>
  );
}
