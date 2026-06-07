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
  const [view, setView] = useState<"login" | "change-password" | "dashboard" | "visits" | "patients" | "departments-units" | "users">("login");
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
    return <SystemLogin onSuccess={async () => {
      const p = await fetchAndSetProfile(true);
      if (p?.must_change_password) {
        setView("change-password");
      } else if (p) {
        setView(p.role === "nurse" ? "visits" : "dashboard");
      } else {
        setView("login");
      }
    }} onViewChange={setView} />;
  }

  if (view === "change-password") {
    return <ChangePasswordView profile={profile} onSuccess={() => {
      setProfile(prev => prev ? { ...prev, must_change_password: false } : null);
      setView(profile.role === "nurse" ? "visits" : "dashboard");
    }} />;
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
                {profile.role === "supervisor" ? "منسق عام المبادرة" : profile.role === "coordinator" ? "منسق إدارة" : "ممرض / ممرضة"}
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
// SYSTEM LOGIN (Username + Password)
// ═══════════════════════════════════════════════════════════════════════════════
function SystemLogin({ onSuccess, onViewChange }: { onSuccess: () => Promise<void>; onViewChange: (v: any) => void }) {
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [loading, setLoading] = useState(false);

  const handleLogin = async () => {
    if (!username || !password) {
      toast.error("يرجى إدخال اسم المستخدم وكلمة المرور");
      return;
    }
    setLoading(true);
    try {
      // Step 1: Look up email by username
      const lookupRes = await fetch("/api/auth/lookup-username", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ username: username.trim().toLowerCase() }),
      });
      const lookupData = await lookupRes.json();
      if (!lookupRes.ok) throw new Error(lookupData.error || "اسم المستخدم غير صحيح");

      // Step 2: Sign in with the resolved email
      const supabase = createClient();
      const { error } = await supabase.auth.signInWithPassword({ email: lookupData.email, password });
      if (error) throw new Error("كلمة المرور غير صحيحة");

      // Step 3: Call parent to set profile and redirect
      await onSuccess();
    } catch (err: any) {
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
          <p className="text-sm text-emerald-200/80 mt-2">مديرية الصحة بسوهاج — تسجيل الدخول</p>
        </div>

        <Card className="border-0 shadow-2xl bg-white/95 backdrop-blur-md rounded-3xl overflow-hidden">
          <CardHeader className="bg-emerald-600 py-5 text-center text-white">
            <CardTitle className="text-lg font-bold">تسجيل الدخول للنظام</CardTitle>
          </CardHeader>
          <CardContent className="pt-6 pb-6 px-6 space-y-4">
            <div className="space-y-1.5">
              <Label className="text-sm font-semibold text-gray-700">اسم المستخدم</Label>
              <Input
                type="text"
                placeholder="مثال: nurse_shg001"
                value={username}
                onChange={e => setUsername(e.target.value)}
                className="h-11 text-sm border-gray-200 focus:border-emerald-500"
                dir="ltr"
                style={{ direction: "ltr", textAlign: "left" }}
                onKeyDown={e => e.key === "Enter" && handleLogin()}
                autoComplete="username"
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
                  className="h-11 text-sm border-gray-200 focus:border-emerald-500 pr-10"
                  dir="ltr"
                  style={{ direction: "ltr", textAlign: "left" }}
                  onKeyDown={e => e.key === "Enter" && handleLogin()}
                  autoComplete="current-password"
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
// FORCE CHANGE PASSWORD VIEW
// ═══════════════════════════════════════════════════════════════════════════════
function ChangePasswordView({ profile, onSuccess }: { profile: UserProfile; onSuccess: () => void }) {
  const [newPassword, setNewPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [showNew, setShowNew] = useState(false);
  const [showConfirm, setShowConfirm] = useState(false);
  const [loading, setLoading] = useState(false);

  const handleChange = async () => {
    if (!newPassword || newPassword.length < 8) {
      toast.error("كلمة المرور يجب أن تكون 8 أحرف على الأقل");
      return;
    }
    if (newPassword !== confirmPassword) {
      toast.error("كلمتا المرور غير متطابقتين");
      return;
    }
    setLoading(true);
    try {
      const supabase = createClient();
      const { error } = await supabase.auth.updateUser({ password: newPassword });
      if (error) throw new Error(error.message);

      // Clear the must_change_password flag via API
      await fetch("/api/users", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id: profile.id, mustChangePassword: false }),
      });

      toast.success("تم تغيير كلمة المرور بنجاح");
      onSuccess();
    } catch (err: any) {
      toast.error("فشل تغيير كلمة المرور", { description: err.message });
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="min-h-screen flex items-center justify-center bg-gradient-to-br from-emerald-950 via-emerald-900 to-teal-950 p-4" dir="rtl">
      <Toaster position="top-center" richColors dir="rtl" />
      <div className="w-full max-w-md">
        <div className="text-center mb-8">
          <div className="mx-auto w-16 h-16 bg-amber-500/20 rounded-2xl flex items-center justify-center shadow-lg border border-amber-400/30 mb-4">
            <Shield className="w-9 h-9 text-amber-400" />
          </div>
          <h2 className="text-2xl font-black text-white leading-tight">تغيير كلمة المرور</h2>
          <p className="text-sm text-emerald-200/80 mt-2">يجب تغيير كلمة المرور المؤقتة قبل المتابعة</p>
        </div>

        <Card className="border-0 shadow-2xl bg-white/95 backdrop-blur-md rounded-3xl overflow-hidden">
          <CardHeader className="bg-amber-500 py-5 text-center text-white">
            <CardTitle className="text-sm font-bold">مرحباً {profile.full_name} — أدخل كلمة مرور جديدة</CardTitle>
          </CardHeader>
          <CardContent className="pt-6 pb-6 px-6 space-y-4">
            <div className="space-y-1.5">
              <Label className="text-sm font-semibold text-gray-700">كلمة المرور الجديدة *</Label>
              <div className="relative">
                <Input
                  type={showNew ? "text" : "password"}
                  placeholder="8 أحرف على الأقل"
                  value={newPassword}
                  onChange={e => setNewPassword(e.target.value)}
                  className="h-11 text-sm border-gray-200 focus:border-amber-500 pr-10"
                  dir="ltr"
                  style={{ direction: "ltr", textAlign: "left" }}
                />
                <button type="button" onClick={() => setShowNew(!showNew)} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400 hover:text-gray-600">
                  {showNew ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                </button>
              </div>
            </div>

            <div className="space-y-1.5">
              <Label className="text-sm font-semibold text-gray-700">تأكيد كلمة المرور *</Label>
              <div className="relative">
                <Input
                  type={showConfirm ? "text" : "password"}
                  placeholder="أعد إدخال كلمة المرور"
                  value={confirmPassword}
                  onChange={e => setConfirmPassword(e.target.value)}
                  className="h-11 text-sm border-gray-200 focus:border-amber-500 pr-10"
                  dir="ltr"
                  style={{ direction: "ltr", textAlign: "left" }}
                  onKeyDown={e => e.key === "Enter" && handleChange()}
                />
                <button type="button" onClick={() => setShowConfirm(!showConfirm)} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400 hover:text-gray-600">
                  {showConfirm ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                </button>
              </div>
            </div>

            {newPassword && (
              <div className={`text-xs px-3 py-2 rounded-lg font-medium ${
                newPassword === confirmPassword && newPassword.length >= 8
                  ? "bg-emerald-50 text-emerald-700"
                  : "bg-red-50 text-red-600"
              }`}>
                {newPassword.length < 8 ? "⚠ كلمة المرور قصيرة جداً" :
                 newPassword !== confirmPassword ? "⚠ كلمتا المرور غير متطابقتين" :
                 "✓ كلمة المرور مقبولة"}
              </div>
            )}

            <Button
              onClick={handleChange}
              disabled={loading}
              className="w-full h-12 bg-amber-500 hover:bg-amber-600 text-white font-bold rounded-xl text-sm transition-all"
            >
              {loading ? <Loader2 className="w-4 h-4 animate-spin" /> : "حفظ كلمة المرور الجديدة"}
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
// USERS MANAGEMENT VIEW (General Initiative Coordinator only)
// ═══════════════════════════════════════════════════════════════════════════════
function UsersView() {
  const [users, setUsers] = useState<any[]>([]);
  const [departments, setDepartments] = useState<any[]>([]);
  const [units, setUnits] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [isAddUserOpen, setIsAddUserOpen] = useState(false);
  const [editingUser, setEditingUser] = useState<any>(null);
  const [deletingUser, setDeletingUser] = useState<any>(null);
  const [deleteLoading, setDeleteLoading] = useState(false);
  
  // Advanced search & filters
  const [searchTerm, setSearchTerm] = useState("");
  const [roleFilter, setRoleFilter] = useState("all");
  const [deptFilter, setDeptFilter] = useState("all");
  const [statusFilter, setStatusFilter] = useState("all");

  // Bulk actions
  const [selectedUsers, setSelectedUsers] = useState<Set<string>>(new Set());
  const [bulkLoading, setBulkLoading] = useState(false);

  // Activity Log
  const [activityUser, setActivityUser] = useState<any>(null);
  const [activityData, setActivityData] = useState<any>(null);
  const [activityLoading, setActivityLoading] = useState(false);

  // Add form states
  const [fullName, setFullName] = useState("");
  const [username, setUsername] = useState("");
  const [email, setEmail] = useState("");
  const [phone, setPhone] = useState("");
  const [password, setPassword] = useState("");
  const [role, setRole] = useState<"nurse" | "supervisor" | "coordinator">("nurse");
  const [selectedDept, setSelectedDept] = useState("");
  const [selectedUnit, setSelectedUnit] = useState("");

  // Edit form states
  const [editFullName, setEditFullName] = useState("");
  const [editUsername, setEditUsername] = useState("");
  const [editEmail, setEditEmail] = useState("");
  const [editPhone, setEditPhone] = useState("");
  const [editPassword, setEditPassword] = useState("");
  const [editRole, setEditRole] = useState<"nurse" | "supervisor" | "coordinator">("nurse");
  const [editDept, setEditDept] = useState("");
  const [editUnit, setEditUnit] = useState("");
  const [editActive, setEditActive] = useState(true);
  const [editLoading, setEditLoading] = useState(false);

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
      setSelectedUsers(new Set());
    }
  }, []);

  useEffect(() => {
    loadData();
  }, [loadData]);

  const filteredUnits = units.filter(u => u.department_id === selectedDept);
  const editFilteredUnits = units.filter(u => u.department_id === editDept);

  // Apply filters
  const filteredUsers = users.filter(u => {
    let match = true;
    if (searchTerm) {
      const term = searchTerm.toLowerCase();
      match = match && (
        (u.full_name && u.full_name.toLowerCase().includes(term)) ||
        (u.username && u.username.toLowerCase().includes(term)) ||
        (u.email && u.email.toLowerCase().includes(term)) ||
        (u.departments?.name && u.departments.name.toLowerCase().includes(term)) ||
        (u.health_units?.name && u.health_units.name.toLowerCase().includes(term))
      );
    }
    if (roleFilter !== "all") {
      match = match && u.role === roleFilter;
    }
    if (deptFilter !== "all") {
      match = match && u.department_id === deptFilter;
    }
    if (statusFilter !== "all") {
      const isActive = statusFilter === "active";
      match = match && u.active === isActive;
    }
    return match;
  });

  const totalUsers = users.length;
  const activeUsers = users.filter(u => u.active).length;
  const inactiveUsers = totalUsers - activeUsers;
  const nursesCount = users.filter(u => u.role === "nurse").length;
  const coordinatorsCount = users.filter(u => u.role === "coordinator").length;

  const resetAddForm = () => {
    setFullName(""); setUsername(""); setEmail(""); setPhone("");
    setPassword(""); setRole("nurse"); setSelectedDept(""); setSelectedUnit("");
  };

  const handleAddUser = async () => {
    if (!fullName || !username || !email || !password || !role) {
      toast.error("يرجى ملء جميع الحقول المطلوبة");
      return;
    }
    try {
      const res = await fetch("/api/users", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          fullName, username, email, phone, password, role,
          departmentId: selectedDept || null,
          unitId: selectedUnit || null,
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "فشل إضافة حساب المستخدم");
      toast.success("تم إنشاء حساب المستخدم بنجاح");
      resetAddForm();
      setIsAddUserOpen(false);
      loadData();
    } catch (err: any) {
      toast.error("فشل الإنشاء", { description: err.message });
    }
  };

  const openEditModal = (u: any) => {
    setEditingUser(u);
    setEditFullName(u.full_name || "");
    setEditUsername(u.username || "");
    setEditEmail(u.email || "");
    setEditPhone(u.phone || "");
    setEditPassword("");
    setEditRole(u.role);
    setEditDept(u.department_id || "");
    setEditUnit(u.unit_id || "");
    setEditActive(u.active);
  };

  const handleEditUser = async () => {
    if (!editingUser) return;
    setEditLoading(true);
    try {
      const body: any = { id: editingUser.id };
      if (editFullName !== editingUser.full_name) body.fullName = editFullName;
      if (editUsername !== (editingUser.username || "")) body.username = editUsername;
      if (editEmail !== editingUser.email) body.email = editEmail;
      if (editPhone !== (editingUser.phone || "")) body.phone = editPhone;
      if (editPassword) body.password = editPassword;
      if (editRole !== editingUser.role) body.role = editRole;
      if (editDept !== (editingUser.department_id || "")) body.departmentId = editDept || null;
      if (editUnit !== (editingUser.unit_id || "")) body.unitId = editUnit || null;
      if (editActive !== editingUser.active) body.active = editActive;

      const res = await fetch("/api/users", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "فشل تعديل بيانات المستخدم");
      toast.success("تم تحديث بيانات المستخدم بنجاح");
      setEditingUser(null);
      loadData();
    } catch (err: any) {
      toast.error("فشل التحديث", { description: err.message });
    } finally {
      setEditLoading(false);
    }
  };

  const handleResetPassword = async (userId: string, userName: string) => {
    const tempPass = "Temp@" + Math.random().toString(36).slice(2, 8);
    try {
      const res = await fetch("/api/users", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id: userId, password: tempPass, mustChangePassword: true }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error);
      toast.success(`تم إعادة تعيين كلمة مرور ${userName}`, {
        description: `كلمة المرور المؤقتة: ${tempPass}`,
        duration: 15000,
      });
      loadData();
    } catch (err: any) {
      toast.error("فشل إعادة تعيين كلمة المرور", { description: err.message });
    }
  };

  const handleDeleteUser = async () => {
    if (!deletingUser) return;
    setDeleteLoading(true);
    try {
      const res = await fetch(`/api/users?id=${deletingUser.id}`, { method: "DELETE" });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "فشل حذف الحساب");
      toast.success(`تم حذف حساب ${deletingUser.full_name} نهائياً`);
      setDeletingUser(null);
      loadData();
    } catch (err: any) {
      toast.error("فشل الحذف", { description: err.message });
    } finally {
      setDeleteLoading(false);
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

  // Bulk Actions
  const handleBulkAction = async (action: string) => {
    if (selectedUsers.size === 0) return;
    setBulkLoading(true);
    try {
      const res = await fetch("/api/users/bulk", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ userIds: Array.from(selectedUsers), action }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error);
      
      toast.success(data.message, {
        description: data.tempPassword ? `كلمة المرور المؤقتة: ${data.tempPassword}` : undefined,
        duration: data.tempPassword ? 15000 : 4000,
      });
      loadData();
    } catch (err: any) {
      toast.error("فشل الإجراء المجمع", { description: err.message });
    } finally {
      setBulkLoading(false);
    }
  };

  const exportToExcel = () => {
    const data = filteredUsers.map(u => ({
      "الاسم بالكامل": u.full_name,
      "اسم المستخدم": u.username || "",
      "البريد الإلكتروني": u.email,
      "رقم الهاتف": u.phone || "",
      "الصلاحية": u.role === "supervisor" ? "منسق عام" : u.role === "coordinator" ? "منسق إدارة" : "ممرض / ممرضة",
      "الإدارة الصحية": u.departments?.name || "",
      "الوحدة الصحية": u.health_units?.name || "",
      "حالة الحساب": u.active ? "نشط" : "معطل",
      "حالة كلمة المرور": u.must_change_password ? "مؤقتة" : "تم التغيير",
      "آخر تسجيل دخول": u.last_login ? new Date(u.last_login).toLocaleString("ar-EG") : "لم يسجل دخول",
      "تاريخ الإنشاء": new Date(u.created_at).toLocaleString("ar-EG")
    }));
    const ws = XLSX.utils.json_to_sheet(data);
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, "المستخدمين");
    XLSX.writeFile(wb, "users_export.xlsx");
  };

  // Activity Log Modal
  const loadActivityLog = async (u: any) => {
    setActivityUser(u);
    setActivityLoading(true);
    setActivityData(null);
    try {
      const res = await fetch(`/api/users/${u.id}/activity`);
      const data = await res.json();
      if (!res.ok) throw new Error(data.error);
      setActivityData(data);
    } catch (err: any) {
      toast.error("فشل تحميل سجل النشاط", { description: err.message });
      setActivityUser(null);
    } finally {
      setActivityLoading(false);
    }
  };

  const toggleSelectAll = () => {
    if (selectedUsers.size === filteredUsers.length && filteredUsers.length > 0) {
      setSelectedUsers(new Set());
    } else {
      setSelectedUsers(new Set(filteredUsers.map(u => u.id)));
    }
  };

  const toggleSelectUser = (id: string) => {
    const newSet = new Set(selectedUsers);
    if (newSet.has(id)) newSet.delete(id);
    else newSet.add(id);
    setSelectedUsers(newSet);
  };

  return (
    <div className="space-y-4">
      {/* ── Statistics Cards ── */}
      <div className="grid grid-cols-2 md:grid-cols-5 gap-3">
        <Card className="bg-white border-0 shadow-sm rounded-2xl overflow-hidden">
          <CardContent className="p-4 flex flex-col items-center text-center space-y-1">
            <Users className="w-6 h-6 text-emerald-600 mb-1" />
            <p className="text-2xl font-black text-gray-800">{totalUsers}</p>
            <p className="text-[10px] font-bold text-gray-500 uppercase tracking-wider">إجمالي المستخدمين</p>
          </CardContent>
        </Card>
        <Card className="bg-white border-0 shadow-sm rounded-2xl overflow-hidden">
          <CardContent className="p-4 flex flex-col items-center text-center space-y-1">
            <CheckCircle2 className="w-6 h-6 text-green-500 mb-1" />
            <p className="text-2xl font-black text-gray-800">{activeUsers}</p>
            <p className="text-[10px] font-bold text-gray-500 uppercase tracking-wider">حسابات نشطة</p>
          </CardContent>
        </Card>
        <Card className="bg-white border-0 shadow-sm rounded-2xl overflow-hidden">
          <CardContent className="p-4 flex flex-col items-center text-center space-y-1">
            <XCircle className="w-6 h-6 text-red-500 mb-1" />
            <p className="text-2xl font-black text-gray-800">{inactiveUsers}</p>
            <p className="text-[10px] font-bold text-gray-500 uppercase tracking-wider">حسابات معطلة</p>
          </CardContent>
        </Card>
        <Card className="bg-white border-0 shadow-sm rounded-2xl overflow-hidden">
          <CardContent className="p-4 flex flex-col items-center text-center space-y-1">
            <Activity className="w-6 h-6 text-blue-500 mb-1" />
            <p className="text-2xl font-black text-gray-800">{nursesCount}</p>
            <p className="text-[10px] font-bold text-gray-500 uppercase tracking-wider">تمريض</p>
          </CardContent>
        </Card>
        <Card className="bg-white border-0 shadow-sm rounded-2xl overflow-hidden">
          <CardContent className="p-4 flex flex-col items-center text-center space-y-1">
            <Shield className="w-6 h-6 text-amber-500 mb-1" />
            <p className="text-2xl font-black text-gray-800">{coordinatorsCount}</p>
            <p className="text-[10px] font-bold text-gray-500 uppercase tracking-wider">منسقي الإدارات</p>
          </CardContent>
        </Card>
      </div>

      {/* ── Filters & Actions Bar ── */}
      <div className="bg-white p-4 rounded-2xl shadow-sm border border-slate-100 space-y-4">
        <div className="flex flex-col md:flex-row justify-between gap-4">
          <div className="flex-1 relative">
            <Search className="absolute right-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400" />
            <Input
              placeholder="بحث بالاسم، اسم المستخدم، البريد، الإدارة..."
              value={searchTerm}
              onChange={e => setSearchTerm(e.target.value)}
              className="h-10 text-xs pr-10 border-gray-200 focus:border-emerald-500 bg-slate-50"
            />
          </div>
          <div className="flex flex-wrap gap-2">
            <Select value={roleFilter} onValueChange={setRoleFilter}>
              <SelectTrigger className="h-10 text-xs w-32 bg-slate-50 border-gray-200">
                <SelectValue placeholder="الصلاحية" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all" className="text-xs">الكل</SelectItem>
                <SelectItem value="nurse" className="text-xs">تمريض</SelectItem>
                <SelectItem value="coordinator" className="text-xs">منسق إدارة</SelectItem>
                <SelectItem value="supervisor" className="text-xs">منسق عام</SelectItem>
              </SelectContent>
            </Select>
            <Select value={deptFilter} onValueChange={setDeptFilter}>
              <SelectTrigger className="h-10 text-xs w-32 bg-slate-50 border-gray-200">
                <SelectValue placeholder="الإدارة" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all" className="text-xs">كل الإدارات</SelectItem>
                {departments.map(d => (
                  <SelectItem key={d.id} value={d.id} className="text-xs">{d.name}</SelectItem>
                ))}
              </SelectContent>
            </Select>
            <Select value={statusFilter} onValueChange={setStatusFilter}>
              <SelectTrigger className="h-10 text-xs w-32 bg-slate-50 border-gray-200">
                <SelectValue placeholder="الحالة" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all" className="text-xs">جميع الحالات</SelectItem>
                <SelectItem value="active" className="text-xs">نشط</SelectItem>
                <SelectItem value="inactive" className="text-xs">معطل</SelectItem>
              </SelectContent>
            </Select>
            <Button onClick={exportToExcel} variant="outline" size="sm" className="h-10 text-xs gap-1 border-emerald-200 text-emerald-700 hover:bg-emerald-50">
              <Download className="w-4 h-4" /> تصدير Excel
            </Button>
            <Button onClick={() => { resetAddForm(); setIsAddUserOpen(true); }} size="sm" className="h-10 bg-emerald-600 hover:bg-emerald-700 text-white gap-1.5 px-4">
              <Plus className="w-4 h-4" /> إضافة حساب
            </Button>
          </div>
        </div>

        {/* Bulk Actions Menu */}
        {selectedUsers.size > 0 && (
          <div className="flex items-center gap-3 p-3 bg-blue-50/50 border border-blue-100 rounded-xl animate-in fade-in slide-in-from-top-2">
            <span className="text-xs font-bold text-blue-800">
              تم تحديد ({selectedUsers.size}) مستخدم
            </span>
            <div className="flex gap-2">
              <Button onClick={() => handleBulkAction("activate")} disabled={bulkLoading} size="sm" variant="outline" className="h-8 text-xs bg-white border-green-200 text-green-700 hover:bg-green-50">
                <CheckCircle2 className="w-3 h-3 ml-1" /> تفعيل
              </Button>
              <Button onClick={() => handleBulkAction("deactivate")} disabled={bulkLoading} size="sm" variant="outline" className="h-8 text-xs bg-white border-red-200 text-red-700 hover:bg-red-50">
                <XCircle className="w-3 h-3 ml-1" /> تعطيل
              </Button>
              <Button onClick={() => handleBulkAction("reset_password")} disabled={bulkLoading} size="sm" variant="outline" className="h-8 text-xs bg-white border-amber-200 text-amber-700 hover:bg-amber-50">
                <RefreshCw className="w-3 h-3 ml-1" /> إعادة تعيين كلمة المرور
              </Button>
            </div>
          </div>
        )}
      </div>

      {/* ── Users Table ── */}
      {loading ? (
        <div className="flex flex-col items-center py-20 gap-3">
          <Loader2 className="w-8 h-8 animate-spin text-emerald-600" />
          <p className="text-xs text-gray-400">جاري تحميل حسابات المستخدمين...</p>
        </div>
      ) : (
        <Card className="border-0 shadow-md bg-white overflow-hidden">
          <div className="overflow-x-auto">
          <table className="w-full text-right border-collapse">
            <thead>
              <tr className="bg-slate-50 border-b border-gray-100 text-xs font-bold text-gray-500">
                <th className="p-3 w-10 text-center">
                  <input type="checkbox" className="rounded text-emerald-600 focus:ring-emerald-500 w-4 h-4"
                    checked={selectedUsers.size === filteredUsers.length && filteredUsers.length > 0}
                    onChange={toggleSelectAll}
                  />
                </th>
                <th className="p-3">الاسم و البريد</th>
                <th className="p-3">اسم المستخدم</th>
                <th className="p-3">الصلاحية</th>
                <th className="p-3">الجهة</th>
                <th className="p-3 text-center">الحالة</th>
                <th className="p-3 text-center">كلمة المرور</th>
                <th className="p-3">آخر تسجيل دخول</th>
                <th className="p-3 text-center">الإجراءات</th>
              </tr>
            </thead>
            <tbody className="text-xs divide-y divide-gray-100">
              {filteredUsers.map(u => (
                <tr key={u.id} className={`hover:bg-slate-50/80 transition-colors ${selectedUsers.has(u.id) ? 'bg-emerald-50/30' : ''}`}>
                  <td className="p-3 text-center">
                    <input type="checkbox" className="rounded text-emerald-600 focus:ring-emerald-500 w-4 h-4"
                      checked={selectedUsers.has(u.id)}
                      onChange={() => toggleSelectUser(u.id)}
                    />
                  </td>
                  <td className="p-3">
                    <p className="font-bold text-gray-800">{u.full_name}</p>
                    <p className="text-[10px] text-gray-400 font-mono mt-0.5">{u.email}</p>
                  </td>
                  <td className="p-3 font-mono text-gray-600">{u.username || "—"}</td>
                  <td className="p-3">
                    <Badge className={u.role === "supervisor" ? "bg-amber-50 text-amber-700 border-amber-100" : u.role === "coordinator" ? "bg-blue-50 text-blue-700 border-blue-100" : "bg-emerald-50 text-emerald-700 border-emerald-100"}>
                      {u.role === "supervisor" ? "منسق عام" : u.role === "coordinator" ? "منسق إدارة" : "تمريض"}
                    </Badge>
                  </td>
                  <td className="p-3">
                    {u.health_units?.name ? (
                      <p className="leading-tight">{u.health_units.name} <br/><span className="text-[10px] text-gray-400">{u.departments?.name}</span></p>
                    ) : u.departments?.name ? (
                      <span>{u.departments.name}</span>
                    ) : (
                      <span className="text-gray-400">مديرية الصحة</span>
                    )}
                  </td>
                  <td className="p-3 text-center">
                    <Badge className={u.active ? "bg-emerald-50 text-emerald-700 border-emerald-100" : "bg-red-50 text-red-700 border-red-100"}>
                      {u.active ? "نشط" : "معطل"}
                    </Badge>
                  </td>
                  <td className="p-3 text-center">
                    <Badge className={u.must_change_password ? "bg-amber-50 text-amber-700 border-amber-100" : "bg-gray-50 text-gray-600 border-gray-200"}>
                      {u.must_change_password ? "مؤقتة" : "تم التغيير"}
                    </Badge>
                  </td>
                  <td className="p-3 text-gray-500 font-mono text-[10px]">
                    {u.last_login ? new Date(u.last_login).toLocaleString("ar-EG", { dateStyle: 'short', timeStyle: 'short' }) : "لم يسجل دخول"}
                  </td>
                  <td className="p-3">
                    <div className="flex items-center justify-center gap-1 flex-wrap">
                      <Button onClick={() => loadActivityLog(u)} variant="ghost" className="h-7 w-7 p-0 text-blue-600 hover:bg-blue-50 rounded-full" title="سجل النشاط">
                        <FileText className="w-3.5 h-3.5" />
                      </Button>
                      <Button onClick={() => openEditModal(u)} variant="ghost" className="h-7 w-7 p-0 text-emerald-600 hover:bg-emerald-50 rounded-full" title="تعديل">
                        <Edit2 className="w-3.5 h-3.5" />
                      </Button>
                      <Button onClick={() => setDeletingUser(u)} variant="ghost" className="h-7 w-7 p-0 text-red-600 hover:bg-red-50 rounded-full" title="حذف">
                        <XCircle className="w-3.5 h-3.5" />
                      </Button>
                    </div>
                  </td>
                </tr>
              ))}
              {filteredUsers.length === 0 && (
                <tr>
                  <td colSpan={9} className="text-center py-10 text-gray-400">
                    لا يوجد مستخدمين يطابقون شروط البحث
                  </td>
                </tr>
              )}
            </tbody>
          </table>
          </div>
        </Card>
      )}

      {/* ── Add User Modal ── */}
      {isAddUserOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/55 backdrop-blur-sm p-4">
          <Card className="w-full max-w-md border-0 shadow-2xl bg-white rounded-3xl overflow-hidden animate-in fade-in zoom-in-95 duration-200">
            <CardHeader className="bg-emerald-800 text-white flex flex-row items-center justify-between p-4">
              <CardTitle className="text-sm font-bold">إنشاء حساب مستخدم جديد</CardTitle>
              <button onClick={() => setIsAddUserOpen(false)} className="p-1 rounded-full hover:bg-white/10 text-white"><X className="w-4 h-4" /></button>
            </CardHeader>
            <CardContent className="p-5 space-y-3 max-h-[75vh] overflow-y-auto">
              <div className="grid grid-cols-2 gap-3">
                <div className="space-y-1"><Label className="text-xs text-gray-600 font-bold">الاسم بالكامل *</Label>
                  <Input placeholder="أسماء أحمد علي" value={fullName} onChange={e => setFullName(e.target.value)} className="h-9 text-xs border-gray-200" /></div>
                <div className="space-y-1"><Label className="text-xs text-gray-600 font-bold">اسم المستخدم *</Label>
                  <Input placeholder="nurse_shg001" value={username} onChange={e => setUsername(e.target.value)} className="h-9 text-xs border-gray-200 font-mono" dir="ltr" /></div>
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div className="space-y-1"><Label className="text-xs text-gray-600 font-bold">البريد الإلكتروني *</Label>
                  <Input placeholder="name@example.com" value={email} onChange={e => setEmail(e.target.value)} className="h-9 text-xs border-gray-200" dir="ltr" /></div>
                <div className="space-y-1"><Label className="text-xs text-gray-600 font-bold">رقم الهاتف</Label>
                  <Input placeholder="01xxxxxxxxx" value={phone} onChange={e => setPhone(e.target.value)} className="h-9 text-xs border-gray-200" dir="ltr" /></div>
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div className="space-y-1"><Label className="text-xs text-gray-600 font-bold">كلمة المرور المؤقتة *</Label>
                  <Input type="password" placeholder="••••••" value={password} onChange={e => setPassword(e.target.value)} className="h-9 text-xs border-gray-200" dir="ltr" /></div>
                <div className="space-y-1"><Label className="text-xs text-gray-600 font-bold">الصلاحية *</Label>
                  <Select value={role} onValueChange={(val: any) => setRole(val)}>
                    <SelectTrigger className="h-9 text-xs bg-white border-gray-200"><SelectValue /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="nurse" className="text-xs">ممرض / ممرضة</SelectItem>
                      <SelectItem value="coordinator" className="text-xs">منسق إدارة</SelectItem>
                      <SelectItem value="supervisor" className="text-xs">منسق عام المبادرة</SelectItem>
                    </SelectContent>
                  </Select></div>
              </div>

              {(role === "nurse" || role === "coordinator") && (
                <div className="grid grid-cols-2 gap-3">
                  <div className="space-y-1"><Label className="text-xs text-gray-600 font-bold">الإدارة الصحية *</Label>
                    <Select value={selectedDept} onValueChange={v => { setSelectedDept(v); setSelectedUnit(""); }}>
                      <SelectTrigger className="h-9 text-xs bg-white border-gray-200"><SelectValue placeholder="اختر الإدارة" /></SelectTrigger>
                      <SelectContent>{departments.map(d => <SelectItem key={d.id} value={d.id} className="text-xs">{d.name}</SelectItem>)}</SelectContent>
                    </Select></div>
                  {role === "nurse" && (
                    <div className="space-y-1"><Label className="text-xs text-gray-600 font-bold">الوحدة الصحية *</Label>
                      <Select value={selectedUnit} onValueChange={setSelectedUnit} disabled={!selectedDept}>
                        <SelectTrigger className="h-9 text-xs bg-white border-gray-200"><SelectValue placeholder="اختر الوحدة" /></SelectTrigger>
                        <SelectContent>{filteredUnits.map(u => <SelectItem key={u.id} value={u.id} className="text-xs">{u.name}</SelectItem>)}</SelectContent>
                      </Select></div>
                  )}
                </div>
              )}

              <div className="bg-amber-50 border border-amber-100 rounded-lg p-2 text-[10px] text-amber-700 font-medium">
                ⚠ سيُطلب من المستخدم تغيير كلمة المرور عند أول تسجيل دخول
              </div>

              <div className="flex gap-2 pt-1">
                <Button onClick={handleAddUser} size="sm" className="bg-emerald-600 hover:bg-emerald-700 text-white flex-1">إنشاء الحساب</Button>
                <Button onClick={() => setIsAddUserOpen(false)} variant="outline" size="sm" className="flex-1">إلغاء</Button>
              </div>
            </CardContent>
          </Card>
        </div>
      )}

      {/* ── Edit User Modal ── */}
      {editingUser && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/55 backdrop-blur-sm p-4">
          <Card className="w-full max-w-md border-0 shadow-2xl bg-white rounded-3xl overflow-hidden animate-in fade-in zoom-in-95 duration-200">
            <CardHeader className="bg-blue-700 text-white flex flex-row items-center justify-between p-4">
              <CardTitle className="text-sm font-bold">تعديل بيانات: {editingUser.full_name}</CardTitle>
              <button onClick={() => setEditingUser(null)} className="p-1 rounded-full hover:bg-white/10 text-white"><X className="w-4 h-4" /></button>
            </CardHeader>
            <CardContent className="p-5 space-y-3 max-h-[75vh] overflow-y-auto">
              <div className="grid grid-cols-2 gap-3">
                <div className="space-y-1"><Label className="text-xs text-gray-600 font-bold">الاسم بالكامل</Label>
                  <Input value={editFullName} onChange={e => setEditFullName(e.target.value)} className="h-9 text-xs border-gray-200" /></div>
                <div className="space-y-1"><Label className="text-xs text-gray-600 font-bold">اسم المستخدم</Label>
                  <Input value={editUsername} onChange={e => setEditUsername(e.target.value)} className="h-9 text-xs border-gray-200 font-mono" dir="ltr" /></div>
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div className="space-y-1"><Label className="text-xs text-gray-600 font-bold">البريد الإلكتروني</Label>
                  <Input value={editEmail} onChange={e => setEditEmail(e.target.value)} className="h-9 text-xs border-gray-200" dir="ltr" /></div>
                <div className="space-y-1"><Label className="text-xs text-gray-600 font-bold">رقم الهاتف</Label>
                  <Input value={editPhone} onChange={e => setEditPhone(e.target.value)} className="h-9 text-xs border-gray-200" dir="ltr" /></div>
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div className="space-y-1"><Label className="text-xs text-gray-600 font-bold">كلمة مرور جديدة (اختياري)</Label>
                  <Input type="password" placeholder="اتركها فارغة إذا لا تريد التغيير" value={editPassword} onChange={e => setEditPassword(e.target.value)} className="h-9 text-xs border-gray-200" dir="ltr" /></div>
                <div className="space-y-1"><Label className="text-xs text-gray-600 font-bold">الصلاحية</Label>
                  <Select value={editRole} onValueChange={(val: any) => setEditRole(val)}>
                    <SelectTrigger className="h-9 text-xs bg-white border-gray-200"><SelectValue /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="nurse" className="text-xs">ممرض / ممرضة</SelectItem>
                      <SelectItem value="coordinator" className="text-xs">منسق إدارة</SelectItem>
                      <SelectItem value="supervisor" className="text-xs">منسق عام المبادرة</SelectItem>
                    </SelectContent>
                  </Select></div>
              </div>

              {(editRole === "nurse" || editRole === "coordinator") && (
                <div className="grid grid-cols-2 gap-3">
                  <div className="space-y-1"><Label className="text-xs text-gray-600 font-bold">الإدارة الصحية</Label>
                    <Select value={editDept} onValueChange={v => { setEditDept(v); setEditUnit(""); }}>
                      <SelectTrigger className="h-9 text-xs bg-white border-gray-200"><SelectValue placeholder="اختر الإدارة" /></SelectTrigger>
                      <SelectContent>{departments.map(d => <SelectItem key={d.id} value={d.id} className="text-xs">{d.name}</SelectItem>)}</SelectContent>
                    </Select></div>
                  {editRole === "nurse" && (
                    <div className="space-y-1"><Label className="text-xs text-gray-600 font-bold">الوحدة الصحية</Label>
                      <Select value={editUnit} onValueChange={setEditUnit} disabled={!editDept}>
                        <SelectTrigger className="h-9 text-xs bg-white border-gray-200"><SelectValue placeholder="اختر الوحدة" /></SelectTrigger>
                        <SelectContent>{editFilteredUnits.map(u => <SelectItem key={u.id} value={u.id} className="text-xs">{u.name}</SelectItem>)}</SelectContent>
                      </Select></div>
                  )}
                </div>
              )}

              <div className="space-y-1">
                <Label className="text-xs text-gray-600 font-bold">حالة الحساب</Label>
                <Select value={editActive ? "active" : "inactive"} onValueChange={v => setEditActive(v === "active")}>
                  <SelectTrigger className="h-9 text-xs bg-white border-gray-200"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="active" className="text-xs">نشط</SelectItem>
                    <SelectItem value="inactive" className="text-xs">معطل</SelectItem>
                  </SelectContent>
                </Select>
              </div>

              <div className="flex gap-2 pt-1">
                <Button onClick={handleEditUser} disabled={editLoading} size="sm" className="bg-blue-600 hover:bg-blue-700 text-white flex-1">
                  {editLoading ? <Loader2 className="w-4 h-4 animate-spin" /> : "حفظ التعديلات"}
                </Button>
                <Button onClick={() => setEditingUser(null)} variant="outline" size="sm" className="flex-1">إلغاء</Button>
              </div>
            </CardContent>
          </Card>
        </div>
      )}

      {/* ── Delete Confirmation Modal ── */}
      {deletingUser && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/55 backdrop-blur-sm p-4">
          <Card className="w-full max-w-sm border-0 shadow-2xl bg-white rounded-3xl overflow-hidden animate-in fade-in zoom-in-95 duration-200">
            <CardHeader className="bg-red-600 text-white flex flex-row items-center justify-between p-4">
              <CardTitle className="text-sm font-bold">تأكيد الحذف النهائي</CardTitle>
              <button onClick={() => setDeletingUser(null)} className="p-1 rounded-full hover:bg-white/10 text-white"><X className="w-4 h-4" /></button>
            </CardHeader>
            <CardContent className="p-5 space-y-4">
              <div className="bg-red-50 border border-red-100 rounded-xl p-4 text-center space-y-2">
                <XCircle className="w-10 h-10 text-red-500 mx-auto" />
                <p className="text-sm font-bold text-red-800">هل أنت متأكد من حذف هذا الحساب نهائياً؟</p>
                <p className="text-xs text-red-600">الاسم: <strong>{deletingUser.full_name}</strong></p>
                <p className="text-xs text-red-600">البريد: <strong className="font-mono">{deletingUser.email}</strong></p>
                <p className="text-[10px] text-red-500 mt-2">⚠ لا يمكن التراجع عن هذا الإجراء. سيتم تسجيل عملية الحذف في سجل التدقيق.</p>
              </div>
              <div className="flex gap-2">
                <Button onClick={handleDeleteUser} disabled={deleteLoading} size="sm" className="bg-red-600 hover:bg-red-700 text-white flex-1">
                  {deleteLoading ? <Loader2 className="w-4 h-4 animate-spin" /> : "نعم، حذف نهائياً"}
                </Button>
                <Button onClick={() => setDeletingUser(null)} variant="outline" size="sm" className="flex-1">إلغاء</Button>
              </div>
            </CardContent>
          </Card>
        </div>
      )}

      {/* ── Activity Log Modal ── */}
      {activityUser && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/55 backdrop-blur-sm p-4">
          <Card className="w-full max-w-lg border-0 shadow-2xl bg-white rounded-3xl overflow-hidden animate-in fade-in zoom-in-95 duration-200">
            <CardHeader className="bg-slate-800 text-white flex flex-row items-center justify-between p-4">
              <CardTitle className="text-sm font-bold flex items-center gap-2">
                <Activity className="w-4 h-4 text-slate-300" /> 
                سجل نشاط المستخدم: {activityUser.full_name}
              </CardTitle>
              <button onClick={() => setActivityUser(null)} className="p-1 rounded-full hover:bg-white/10 text-white"><X className="w-4 h-4" /></button>
            </CardHeader>
            <CardContent className="p-5 max-h-[75vh] overflow-y-auto space-y-5">
              {activityLoading ? (
                <div className="flex flex-col items-center py-10 gap-2">
                  <Loader2 className="w-6 h-6 animate-spin text-slate-400" />
                  <p className="text-xs text-gray-500">جاري تحميل السجل...</p>
                </div>
              ) : activityData ? (
                <>
                  <div className="grid grid-cols-2 gap-3">
                    <div className="bg-slate-50 p-3 rounded-xl border border-slate-100">
                      <p className="text-[10px] text-gray-500 font-bold mb-1">تاريخ إنشاء الحساب</p>
                      <p className="text-xs font-mono text-gray-800">{new Date(activityData.accountCreationDate).toLocaleString("ar-EG")}</p>
                    </div>
                    <div className="bg-slate-50 p-3 rounded-xl border border-slate-100">
                      <p className="text-[10px] text-gray-500 font-bold mb-1">آخر تسجيل دخول</p>
                      <p className="text-xs font-mono text-gray-800">{activityData.lastLogin ? new Date(activityData.lastLogin).toLocaleString("ar-EG") : "—"}</p>
                    </div>
                    <div className="bg-slate-50 p-3 rounded-xl border border-slate-100">
                      <p className="text-[10px] text-gray-500 font-bold mb-1">آخر تعديل للملف الشخصي</p>
                      <p className="text-xs font-mono text-gray-800">{new Date(activityData.lastProfileUpdate).toLocaleString("ar-EG")}</p>
                    </div>
                    <div className="bg-emerald-50 p-3 rounded-xl border border-emerald-100">
                      <p className="text-[10px] text-emerald-600 font-bold mb-1">آخر زيارة مسجلة (للمرضى)</p>
                      {activityData.lastRecordedVisit ? (
                        <>
                          <p className="text-xs font-mono text-emerald-900">{new Date(activityData.lastRecordedVisit.created_at).toLocaleString("ar-EG")}</p>
                          <p className="text-[10px] text-emerald-700 truncate mt-0.5" title={activityData.lastRecordedVisit.patients?.full_name}>
                            المريض: {activityData.lastRecordedVisit.patients?.full_name}
                          </p>
                        </>
                      ) : (
                        <p className="text-xs text-emerald-800">لا يوجد زيارات مسجلة بواسطة هذا المستخدم</p>
                      )}
                    </div>
                  </div>

                  <div>
                    <h4 className="text-xs font-bold text-gray-700 mb-3 border-b pb-2">سجل الإجراءات والتعديلات</h4>
                    {activityData.modificationHistory.length > 0 ? (
                      <div className="space-y-2">
                        {activityData.modificationHistory.map((log: any) => (
                          <div key={log.id} className="flex gap-3 p-3 bg-white border border-gray-100 rounded-xl shadow-sm text-xs">
                            <div className="w-8 h-8 rounded-full bg-slate-100 flex items-center justify-center shrink-0">
                              <Info className="w-4 h-4 text-slate-500" />
                            </div>
                            <div>
                              <p className="font-bold text-gray-800">
                                {log.action_type === "delete_user" ? "حذف مستخدم" : log.action_type}
                              </p>
                              <p className="text-gray-500 text-[10px] mt-0.5">بواسطة: {log.performed_by_user?.full_name || "النظام"}</p>
                              <p className="text-gray-400 font-mono text-[10px] mt-0.5">{new Date(log.created_at).toLocaleString("ar-EG")}</p>
                            </div>
                          </div>
                        ))}
                      </div>
                    ) : (
                      <div className="text-center py-6 text-gray-400 bg-slate-50 rounded-xl border border-slate-100 border-dashed">
                        <p className="text-xs">لا توجد تعديلات مسجلة في السجل</p>
                      </div>
                    )}
                  </div>
                </>
              ) : null}
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
