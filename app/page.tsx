"use client";

import { useState, useEffect, useCallback, useRef } from "react";
import { createClient } from "@/lib/supabase/client";
import { parseNationalId, formatBirthDate } from "@/lib/national-id";
import type { Department, HealthUnit, VisitSubmission, DashboardStats, UnitStats, UserProfile } from "@/lib/types";
import { SupervisorDashboard } from "@/components/dashboard/SupervisorDashboard";
import { SystemLogin, ChangePasswordView, VisitsView, PatientsView, DepartmentsUnitsView, UsersView, NurseView, InfoChip, MeasureInput } from "@/components/views/MainViews";

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
      const timeout = setTimeout(() => controller.abort("Timeout after 10s"), 10000);

      // If the caller provided a signal (e.g. from component cleanup), link it
      // so that aborting the external signal also aborts this request.
      const externalSignal = options?.signal;
      if (externalSignal) {
        if (externalSignal.aborted) {
          clearTimeout(timeout);
          throw new DOMException("Request aborted by caller", "AbortError");
        }
        const onExternalAbort = () => controller.abort(externalSignal.reason ?? "Component unmounted");
        externalSignal.addEventListener("abort", onExternalAbort, { once: true });
      }

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
      // Don't retry if the request was intentionally aborted (component unmount, navigation, etc.)
      if (e.name === "AbortError") throw e;
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
          {view === "dashboard" && profile && <SupervisorDashboard profile={profile} onLogout={() => {}} />}
          {view === "visits" && <VisitsView isOnline={isOnline} onPendingChange={setPendingCount} profile={profile} />}
          {view === "patients" && <PatientsView />}
          {view === "departments-units" && <DepartmentsUnitsView profile={profile} />}
          {view === "users" && <UsersView />}
        </main>
      </div>
    </div>
  );
}