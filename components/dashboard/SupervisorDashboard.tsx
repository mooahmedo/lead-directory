"use client";

import { useState, useEffect, useCallback } from "react";
import {
  RefreshCw, Search, Users, Activity, Calendar, Building2,
  TrendingUp, AlertCircle, CheckCircle2, XCircle, Loader2,
  ArrowUpRight, ArrowDownRight, Filter, X, BarChart2,
  Clock, Bell, AlertTriangle, ChevronDown, ChevronUp,
  Heart, Zap, Award,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Progress } from "@/components/ui/progress";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import {
  Collapsible, CollapsibleContent, CollapsibleTrigger,
} from "@/components/ui/collapsible";
import { toast } from "sonner";
import type { DashboardStats, UnitStats } from "@/lib/types";

// ─── Local resilientFetch (isolated from page.tsx monolith) ──────────────────
async function resilientFetch<T>(url: string, retries = 2): Promise<T> {
  let lastError: Error = new Error("Fetch failed");
  for (let i = 0; i <= retries; i++) {
    try {
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), 10000);
      const res = await fetch(url, { signal: controller.signal });
      clearTimeout(timeout);
      if (!res.ok) {
        const body = await res.json().catch(() => ({ error: res.statusText }));
        throw new Error(body.error || `HTTP ${res.status}`);
      }
      return res.json();
    } catch (e: any) {
      lastError = e;
      if (i < retries) await new Promise((r) => setTimeout(r, 800 * (i + 1)));
    }
  }
  throw lastError;
}

// ─── Types ────────────────────────────────────────────────────────────────────
interface Department { id: string; name: string; }
type StatusType = "active" | "inactive" | "warning" | "pending";

// ─── Status Badge System ──────────────────────────────────────────────────────
function StatusBadge({ status }: { status: StatusType }) {
  const cfg = {
    active:   { label: "نشطة",        cls: "bg-emerald-50 text-emerald-700 border-emerald-200", icon: <CheckCircle2 className="w-3 h-3" /> },
    inactive: { label: "غير نشطة",    cls: "bg-red-50 text-red-700 border-red-200",             icon: <XCircle className="w-3 h-3" /> },
    warning:  { label: "تحتاج انتباه",cls: "bg-amber-50 text-amber-700 border-amber-200",       icon: <AlertTriangle className="w-3 h-3" /> },
    pending:  { label: "معلقة",       cls: "bg-slate-50 text-slate-600 border-slate-200",       icon: <Clock className="w-3 h-3" /> },
  }[status];
  return (
    <span className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-bold border ${cfg.cls}`}>
      {cfg.icon} {cfg.label}
    </span>
  );
}

// ─── KPI Card ─────────────────────────────────────────────────────────────────
function KPICard({ icon, label, value, sublabel, color, trend }: {
  icon: React.ReactNode;
  label: string;
  value: string | number;
  sublabel?: string;
  color: "emerald" | "teal" | "blue" | "purple" | "amber";
  trend?: "up" | "down" | "neutral";
}) {
  const palettes = {
    emerald: { grad: "from-emerald-500 to-emerald-700", shadow: "shadow-emerald-100/70" },
    teal:    { grad: "from-teal-500 to-teal-700",       shadow: "shadow-teal-100/70" },
    blue:    { grad: "from-blue-500 to-blue-700",       shadow: "shadow-blue-100/70" },
    purple:  { grad: "from-violet-500 to-violet-700",   shadow: "shadow-violet-100/70" },
    amber:   { grad: "from-amber-500 to-amber-600",     shadow: "shadow-amber-100/70" },
  };
  const p = palettes[color];
  return (
    <Card className={`border-0 shadow-lg ${p.shadow} bg-white hover:shadow-xl hover:-translate-y-0.5 transition-all duration-300 group cursor-default`}>
      <CardContent className="p-5">
        <div className="flex items-start justify-between">
          <div className={`p-3 rounded-2xl bg-gradient-to-br ${p.grad} text-white shadow-md group-hover:scale-105 transition-transform duration-200`}>
            {icon}
          </div>
          {trend && trend !== "neutral" && (
            <div className={`flex items-center gap-1 text-[10px] font-bold px-2 py-1 rounded-full ${
              trend === "up" ? "bg-emerald-50 text-emerald-600" : "bg-red-50 text-red-600"
            }`}>
              {trend === "up" ? <ArrowUpRight className="w-3 h-3" /> : <ArrowDownRight className="w-3 h-3" />}
            </div>
          )}
        </div>
        <div className="mt-4">
          <p className="text-3xl font-black text-gray-800 leading-none tracking-tight">
            {typeof value === "number" ? value.toLocaleString("ar-EG") : value}
          </p>
          <p className="text-xs font-semibold text-gray-500 mt-2">{label}</p>
          {sublabel && <p className="text-[10px] text-gray-400 mt-0.5">{sublabel}</p>}
        </div>
      </CardContent>
    </Card>
  );
}

// ─── Chart Placeholder ────────────────────────────────────────────────────────
function ChartPlaceholder({ title, subtitle, icon }: { title: string; subtitle: string; icon: React.ReactNode }) {
  return (
    <Card className="border-0 shadow-md bg-white overflow-hidden">
      <CardHeader className="pb-2 pt-4 px-4">
        <div className="flex items-center justify-between">
          <div>
            <CardTitle className="text-xs font-bold text-gray-700">{title}</CardTitle>
            <p className="text-[10px] text-gray-400 mt-0.5">{subtitle}</p>
          </div>
          <div className="p-2 bg-slate-50 rounded-xl text-slate-300">{icon}</div>
        </div>
      </CardHeader>
      <CardContent className="px-4 pb-4">
        <div className="h-40 flex flex-col items-center justify-center gap-3 bg-gradient-to-br from-slate-50 to-gray-50 rounded-xl border border-slate-200 border-dashed">
          {/* Decorative skeleton bars */}
          <div className="flex items-end gap-1.5 h-12 opacity-15">
            {[35, 60, 28, 75, 50, 68, 42, 85, 55, 72, 30, 80].map((h, i) => (
              <div key={i} className="w-3.5 bg-emerald-400 rounded-t-sm" style={{ height: `${h}%` }} />
            ))}
          </div>
          <div className="text-center">
            <p className="text-[11px] font-bold text-slate-400">الرسم البياني قيد التطوير</p>
            <p className="text-[10px] text-slate-300 mt-0.5">سيتوفر عند توفر بيانات كافية</p>
          </div>
        </div>
      </CardContent>
    </Card>
  );
}

// ─── Empty State ──────────────────────────────────────────────────────────────
function EmptyState({ icon, title, message }: { icon: React.ReactNode; title: string; message: string }) {
  return (
    <div className="flex flex-col items-center justify-center gap-3 py-8 bg-slate-50/50 rounded-xl border border-dashed border-slate-200">
      <div className="w-11 h-11 rounded-full bg-white shadow-sm flex items-center justify-center text-slate-300 border border-slate-100">
        {icon}
      </div>
      <div className="text-center">
        <p className="text-xs font-bold text-slate-500">{title}</p>
        <p className="text-[10px] text-slate-400 mt-0.5">{message}</p>
      </div>
    </div>
  );
}

// ─── Unit Card (Redesigned) ───────────────────────────────────────────────────
function UnitCard({ unit }: { unit: UnitStats }) {
  const pct = unit.daily_target > 0
    ? Math.min(100, Math.round((unit.today_visits / unit.daily_target) * 100))
    : 0;
  const monthPct = unit.monthly_target > 0
    ? Math.min(100, Math.round((unit.month_visits / unit.monthly_target) * 100))
    : 0;

  const status: StatusType = !unit.active
    ? "inactive"
    : pct >= 80 ? "active"
    : "warning";

  const barColor = pct >= 80 ? "bg-emerald-500" : pct >= 40 ? "bg-amber-500" : "bg-red-400";
  const valueColor = pct >= 80 ? "text-emerald-700" : pct >= 40 ? "text-amber-700" : "text-red-500";

  return (
    <div className="bg-white rounded-2xl p-4 border border-gray-100 shadow-sm hover:shadow-md hover:border-emerald-100 transition-all duration-200 group">
      {/* Top row */}
      <div className="flex items-start justify-between mb-3">
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-1.5 mb-1.5 flex-wrap">
            <span className="text-[10px] font-mono font-bold text-slate-400 bg-slate-100 px-1.5 py-0.5 rounded">
              {unit.code}
            </span>
            <StatusBadge status={status} />
          </div>
          <p className="text-sm font-bold text-gray-800 leading-tight group-hover:text-emerald-700 transition-colors truncate pr-1">
            {unit.name}
          </p>
        </div>
        {/* Today count */}
        <div className="text-left shrink-0 ml-2">
          <p className={`text-2xl font-black leading-none ${valueColor}`}>{unit.today_visits}</p>
          <p className="text-[9px] text-gray-400 mt-0.5 text-left">من {unit.daily_target}</p>
        </div>
      </div>

      {/* Daily progress */}
      <div className="space-y-1 mb-3">
        <div className="flex justify-between items-center">
          <span className="text-[10px] font-medium text-gray-400">الأداء اليومي</span>
          <span className={`text-[10px] font-black ${valueColor}`}>{pct}%</span>
        </div>
        <div className="h-2 bg-gray-100 rounded-full overflow-hidden">
          <div
            className={`h-full rounded-full transition-all duration-700 ease-out ${barColor}`}
            style={{ width: `${pct}%` }}
          />
        </div>
      </div>

      {/* Footer */}
      <div className="flex items-center justify-between pt-2.5 border-t border-gray-50">
        <div className="flex items-center gap-3">
          <div>
            <p className="text-[9px] text-gray-400">الشهر</p>
            <p className="text-[11px] font-bold text-gray-700">{unit.month_visits}</p>
          </div>
          <div className="w-px h-5 bg-gray-100" />
          <div>
            <p className="text-[9px] text-gray-400">الهدف الشهري</p>
            <p className="text-[11px] font-bold text-gray-700">{unit.monthly_target}</p>
          </div>
        </div>
        {/* Monthly mini-bar */}
        <div className="flex items-center gap-1.5">
          <div className="w-14 h-1.5 bg-gray-100 rounded-full overflow-hidden">
            <div
              className={`h-full rounded-full ${monthPct >= 80 ? "bg-emerald-400" : monthPct >= 40 ? "bg-amber-400" : "bg-red-300"}`}
              style={{ width: `${monthPct}%` }}
            />
          </div>
          <span className="text-[9px] text-gray-400">{monthPct}%</span>
        </div>
      </div>
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════════════════════
// MAIN SUPERVISOR DASHBOARD COMPONENT
// ═══════════════════════════════════════════════════════════════════════════════
export function SupervisorDashboard({ onLogout }: { onLogout: () => void }) {
  const [stats, setStats] = useState<DashboardStats | null>(null);
  const [units, setUnits] = useState<UnitStats[]>([]);
  const [departments, setDepartments] = useState<Department[]>([]);
  const [loading, setLoading] = useState(true);
  const [lastUpdated, setLastUpdated] = useState<Date | null>(null);
  const [openDepts, setOpenDepts] = useState<Record<string, boolean>>({});

  // Filters (local state — wired to unit list)
  const [searchUnit, setSearchUnit] = useState("");
  const [filterDept, setFilterDept] = useState("all");
  const [filterStatus, setFilterStatus] = useState("all");
  const [filterDateRange, setFilterDateRange] = useState("today");

  const loadData = useCallback(async () => {
    setLoading(true);
    try {
      const data = await resilientFetch<{ stats: DashboardStats; units: UnitStats[] }>("/api/dashboard");
      setStats(data.stats);
      setUnits(data.units);
      setLastUpdated(new Date());

      // Build departments list from units
      const deptMap = new Map<string, string>();
      data.units.forEach((u) => {
        if (u.department_id && u.department_name) deptMap.set(u.department_id, u.department_name);
      });
      setDepartments(Array.from(deptMap.entries()).map(([id, name]) => ({ id, name })));

      // Start all collapsed except all expanded by default
      const deptOpen: Record<string, boolean> = {};
      data.units.forEach((u) => { deptOpen[u.department_id] = true; });
      setOpenDepts(deptOpen);
    } catch (err: any) {
      toast.error("فشل تحميل البيانات", { description: err.message });
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { loadData(); }, [loadData]);

  const resetFilters = () => {
    setSearchUnit("");
    setFilterDept("all");
    setFilterStatus("all");
    setFilterDateRange("today");
  };

  const hasActiveFilters =
    !!searchUnit || filterDept !== "all" || filterStatus !== "all" || filterDateRange !== "today";

  // Filtered units
  const filteredUnits = units.filter((u) => {
    if (searchUnit && !u.name.includes(searchUnit) && !u.code.toLowerCase().includes(searchUnit.toLowerCase())) return false;
    if (filterDept !== "all" && u.department_id !== filterDept) return false;
    if (filterStatus === "active" && !u.active) return false;
    if (filterStatus === "inactive" && u.active) return false;
    if (filterStatus === "low") {
      const pct = u.daily_target > 0 ? u.today_visits / u.daily_target : 1;
      if (!u.active || pct >= 0.4) return false;
    }
    return true;
  });

  const deptGroups = filteredUnits.reduce<Record<string, UnitStats[]>>((acc, u) => {
    if (!acc[u.department_id]) acc[u.department_id] = [];
    acc[u.department_id].push(u);
    return acc;
  }, {});

  // Insights
  const topUnits = [...units]
    .filter((u) => u.active && u.daily_target > 0)
    .sort((a, b) => b.today_visits / b.daily_target - a.today_visits / a.daily_target)
    .slice(0, 3);

  const needAttentionUnits = units
    .filter((u) => u.active && u.daily_target > 0 && u.today_visits / u.daily_target < 0.4)
    .slice(0, 4);

  return (
    <div className="space-y-5" dir="rtl">

      {/* ═══ DASHBOARD HEADER ═════════════════════════════════════════════════ */}
      <div className="bg-gradient-to-l from-emerald-600 to-emerald-800 rounded-2xl p-5 shadow-xl shadow-emerald-900/20">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
          <div>
            <div className="flex items-center gap-2 mb-1.5">
              <Heart className="w-3.5 h-3.5 text-emerald-300" />
              <p className="text-[10px] font-bold text-emerald-300 uppercase tracking-widest">
                مبادرة صحة لكل المصريين — برنامج الأمراض المزمنة
              </p>
            </div>
            <h1 className="text-xl font-black text-white">لوحة التحكم الرئيسية</h1>
            <p className="text-xs text-emerald-200/75 mt-1 leading-relaxed">
              متابعة الأداء التشغيلي لمبادرة الأمراض المزمنة — مديرية الصحة بسوهاج
            </p>
          </div>
          <div className="flex flex-col items-start sm:items-end gap-2 shrink-0">
            {lastUpdated && (
              <div className="flex items-center gap-1.5 text-emerald-200/80 text-[11px]">
                <Clock className="w-3 h-3" />
                <span>
                  آخر تحديث: {lastUpdated.toLocaleTimeString("ar-EG", { hour: "2-digit", minute: "2-digit" })}
                </span>
              </div>
            )}
            <Button
              onClick={loadData}
              disabled={loading}
              size="sm"
              className="bg-white/15 hover:bg-white/25 text-white border border-white/20 backdrop-blur-sm h-9 px-4 text-xs font-bold transition-all gap-1.5"
            >
              <RefreshCw className={`w-3.5 h-3.5 ${loading ? "animate-spin" : ""}`} />
              تحديث البيانات
            </Button>
          </div>
        </div>
      </div>

      {/* ═══ LOADING STATE ════════════════════════════════════════════════════ */}
      {loading && !stats ? (
        <div className="flex flex-col items-center justify-center py-28 gap-4">
          <div className="relative w-14 h-14">
            <div className="absolute inset-0 rounded-full border-4 border-emerald-100" />
            <div className="absolute inset-0 rounded-full border-4 border-emerald-600 border-t-transparent animate-spin" />
          </div>
          <div className="text-center">
            <p className="text-sm font-bold text-gray-600">جارٍ تحميل البيانات</p>
            <p className="text-xs text-gray-400 mt-1">يُرجى الانتظار لحظة...</p>
          </div>
        </div>
      ) : stats ? (
        <>
          {/* ═══ KPI CARDS ════════════════════════════════════════════════════ */}
          <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
            <KPICard
              icon={<Users className="w-5 h-5" />}
              label="إجمالي المرضى المسجلين"
              value={stats.totalPatients}
              sublabel="منذ انطلاق المبادرة"
              color="emerald"
              trend="up"
            />
            <KPICard
              icon={<Activity className="w-5 h-5" />}
              label="إجمالي الزيارات"
              value={stats.totalVisits}
              sublabel="جميع الوحدات الصحية"
              color="teal"
              trend="up"
            />
            <KPICard
              icon={<Calendar className="w-5 h-5" />}
              label="زيارات اليوم"
              value={stats.todayVisits}
              sublabel={new Date().toLocaleDateString("ar-EG", { weekday: "long", day: "numeric", month: "long" })}
              color="blue"
              trend="neutral"
            />
            <KPICard
              icon={<Building2 className="w-5 h-5" />}
              label="الوحدات الصحية النشطة"
              value={stats.activeUnits}
              sublabel={stats.inactiveUnits > 0 ? `${stats.inactiveUnits} وحدة موقوفة` : "جميع الوحدات تعمل"}
              color="purple"
              trend="neutral"
            />
          </div>

          {/* ═══ SECONDARY METRICS ════════════════════════════════════════════ */}
          <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
            {[
              { label: "مرضى جدد (أول مرة)", value: stats.newPatients, style: "bg-emerald-50 border-emerald-100 text-emerald-700", icon: <TrendingUp className="w-3.5 h-3.5" /> },
              { label: "مرضى مترددون", value: stats.returningPatients, style: "bg-blue-50 border-blue-100 text-blue-700", icon: <RefreshCw className="w-3.5 h-3.5" /> },
              { label: "حالات إحالة", value: stats.referrals, style: "bg-amber-50 border-amber-100 text-amber-700", icon: <ArrowUpRight className="w-3.5 h-3.5" /> },
              {
                label: "وحدات غير نشطة",
                value: stats.inactiveUnits,
                style: stats.inactiveUnits > 0
                  ? "bg-red-50 border-red-100 text-red-700"
                  : "bg-slate-50 border-slate-100 text-slate-500",
                icon: <AlertCircle className="w-3.5 h-3.5" />,
              },
            ].map(({ label, value, style, icon }) => (
              <div key={label} className={`flex items-center justify-between p-3 rounded-xl border ${style} transition-all`}>
                <div className="flex items-center gap-2">
                  {icon}
                  <span className="text-[11px] font-semibold leading-tight">{label}</span>
                </div>
                <span className="text-sm font-black">{value.toLocaleString("ar-EG")}</span>
              </div>
            ))}
          </div>

          {/* ═══ FILTER BAR ═══════════════════════════════════════════════════ */}
          <Card className="border-0 shadow-md bg-white">
            <CardContent className="p-4 space-y-3">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <Filter className="w-4 h-4 text-gray-400" />
                  <span className="text-xs font-bold text-gray-700">تصفية وفلترة</span>
                  {hasActiveFilters && (
                    <Badge className="bg-emerald-100 text-emerald-700 border-0 text-[10px] px-2 h-4">
                      مفعّل
                    </Badge>
                  )}
                </div>
                {hasActiveFilters && (
                  <Button
                    onClick={resetFilters}
                    variant="ghost"
                    size="sm"
                    className="h-7 text-[11px] text-gray-400 hover:text-red-500 gap-1 px-2"
                  >
                    <X className="w-3 h-3" /> إعادة تعيين
                  </Button>
                )}
              </div>
              <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
                {/* Date range (UI only — API filtering pending) */}
                <Select value={filterDateRange} onValueChange={setFilterDateRange}>
                  <SelectTrigger className="h-9 text-xs bg-slate-50 border-slate-200">
                    <SelectValue placeholder="الفترة الزمنية" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="today" className="text-xs">اليوم فقط</SelectItem>
                    <SelectItem value="week" className="text-xs">هذا الأسبوع</SelectItem>
                    <SelectItem value="month" className="text-xs">هذا الشهر</SelectItem>
                    <SelectItem value="quarter" className="text-xs">هذا الربع</SelectItem>
                  </SelectContent>
                </Select>
                {/* Department */}
                <Select value={filterDept} onValueChange={setFilterDept}>
                  <SelectTrigger className="h-9 text-xs bg-slate-50 border-slate-200">
                    <SelectValue placeholder="الإدارة الصحية" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="all" className="text-xs">كل الإدارات</SelectItem>
                    {departments.map((d) => (
                      <SelectItem key={d.id} value={d.id} className="text-xs">{d.name}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                {/* Status */}
                <Select value={filterStatus} onValueChange={setFilterStatus}>
                  <SelectTrigger className="h-9 text-xs bg-slate-50 border-slate-200">
                    <SelectValue placeholder="حالة الوحدة" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="all" className="text-xs">جميع الحالات</SelectItem>
                    <SelectItem value="active" className="text-xs">نشطة فقط</SelectItem>
                    <SelectItem value="inactive" className="text-xs">غير نشطة</SelectItem>
                    <SelectItem value="low" className="text-xs">أداء منخفض (&lt;40%)</SelectItem>
                  </SelectContent>
                </Select>
                {/* Unit search */}
                <div className="relative">
                  <Search className="absolute right-3 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-gray-400" />
                  <Input
                    placeholder="ابحث عن وحدة..."
                    value={searchUnit}
                    onChange={(e) => setSearchUnit(e.target.value)}
                    className="h-9 text-xs pr-9 bg-slate-50 border-slate-200 focus:border-emerald-400"
                  />
                </div>
              </div>
            </CardContent>
          </Card>

          {/* ═══ PERFORMANCE & MONITORING ════════════════════════════════════ */}
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
            {/* Top Performers */}
            <Card className="border-0 shadow-md bg-white">
              <CardHeader className="pb-2 pt-4 px-4">
                <div className="flex items-center gap-2.5">
                  <div className="p-2 bg-yellow-50 rounded-xl">
                    <Award className="w-4 h-4 text-yellow-600" />
                  </div>
                  <div>
                    <CardTitle className="text-xs font-bold text-gray-700">أعلى الوحدات أداءً اليوم</CardTitle>
                    <p className="text-[10px] text-gray-400 mt-0.5">الوحدات التي حققت أعلى نسبة من الهدف اليومي</p>
                  </div>
                </div>
              </CardHeader>
              <CardContent className="px-4 pb-4">
                {topUnits.length > 0 ? (
                  <div className="space-y-3">
                    {topUnits.map((u, i) => {
                      const pct = Math.min(100, Math.round((u.today_visits / u.daily_target) * 100));
                      const medals = ["🥇", "🥈", "🥉"];
                      return (
                        <div key={u.id} className="flex items-center gap-3">
                          <span className="text-base shrink-0 w-6 text-center">{medals[i]}</span>
                          <div className="flex-1 min-w-0">
                            <p className="text-[11px] font-bold text-gray-800 truncate">{u.name}</p>
                            <div className="flex items-center gap-2 mt-1">
                              <div className="flex-1 h-1.5 bg-gray-100 rounded-full overflow-hidden">
                                <div className="h-full bg-emerald-500 rounded-full transition-all duration-500" style={{ width: `${pct}%` }} />
                              </div>
                              <span className="text-[10px] font-black text-emerald-700 shrink-0">{pct}%</span>
                            </div>
                          </div>
                          <div className="text-left shrink-0">
                            <p className="text-sm font-black text-emerald-700 leading-none">{u.today_visits}</p>
                            <p className="text-[9px] text-gray-400 mt-0.5">/{u.daily_target}</p>
                          </div>
                        </div>
                      );
                    })}
                  </div>
                ) : (
                  <EmptyState
                    icon={<Award className="w-5 h-5" />}
                    title="لا توجد بيانات بعد"
                    message="لم يتم تسجيل زيارات اليوم حتى الآن"
                  />
                )}
              </CardContent>
            </Card>

            {/* Needs Attention */}
            <Card className="border-0 shadow-md bg-white">
              <CardHeader className="pb-2 pt-4 px-4">
                <div className="flex items-center gap-2.5">
                  <div className="p-2 bg-amber-50 rounded-xl">
                    <AlertTriangle className="w-4 h-4 text-amber-600" />
                  </div>
                  <div>
                    <CardTitle className="text-xs font-bold text-gray-700">وحدات تحتاج متابعة</CardTitle>
                    <p className="text-[10px] text-gray-400 mt-0.5">نشطة لكن أداؤها دون 40% من الهدف اليومي</p>
                  </div>
                </div>
              </CardHeader>
              <CardContent className="px-4 pb-4">
                {needAttentionUnits.length > 0 ? (
                  <div className="space-y-2">
                    {needAttentionUnits.map((u) => {
                      const pct = u.daily_target > 0
                        ? Math.min(100, Math.round((u.today_visits / u.daily_target) * 100))
                        : 0;
                      return (
                        <div key={u.id} className="flex items-center gap-3 p-2.5 bg-amber-50/60 rounded-xl border border-amber-100">
                          <AlertCircle className="w-4 h-4 text-amber-500 shrink-0" />
                          <div className="flex-1 min-w-0">
                            <p className="text-[11px] font-bold text-gray-800 truncate">{u.name}</p>
                            <div className="flex items-center gap-2 mt-1">
                              <div className="flex-1 h-1.5 bg-amber-100 rounded-full overflow-hidden">
                                <div className="h-full bg-amber-400 rounded-full" style={{ width: `${pct}%` }} />
                              </div>
                              <span className="text-[10px] font-black text-amber-700 shrink-0">{pct}%</span>
                            </div>
                          </div>
                          <div className="text-left shrink-0">
                            <p className="text-sm font-black text-amber-700 leading-none">{u.today_visits}</p>
                            <p className="text-[9px] text-gray-400 mt-0.5">/{u.daily_target}</p>
                          </div>
                        </div>
                      );
                    })}
                  </div>
                ) : (
                  <EmptyState
                    icon={<CheckCircle2 className="w-5 h-5 text-emerald-400" />}
                    title="جميع الوحدات تعمل بشكل ممتاز"
                    message="لا توجد وحدات تحتاج متابعة اليوم"
                  />
                )}
              </CardContent>
            </Card>
          </div>

          {/* ═══ CHARTS SECTION ═══════════════════════════════════════════════ */}
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <ChartPlaceholder
              title="اتجاه الزيارات اليومية"
              subtitle="مقارنة زيارات آخر 14 يوماً"
              icon={<BarChart2 className="w-5 h-5" />}
            />
            <ChartPlaceholder
              title="الأداء الشهري التراكمي"
              subtitle="نسبة تحقيق الهدف الشهري لكل وحدة"
              icon={<TrendingUp className="w-5 h-5" />}
            />
            <ChartPlaceholder
              title="توزيع المرضى حسب نوع الزيارة"
              subtitle="نسبة أول مرة مقابل متردد"
              icon={<Users className="w-5 h-5" />}
            />
            <ChartPlaceholder
              title="مقارنة أداء الوحدات الصحية"
              subtitle="ترتيب الوحدات تنازلياً حسب الإنجاز"
              icon={<Activity className="w-5 h-5" />}
            />
          </div>

          {/* ═══ ALERTS & RECENT ACTIVITY ════════════════════════════════════ */}
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
            {/* Alerts */}
            <Card className="border-0 shadow-md bg-white">
              <CardHeader className="pb-2 pt-4 px-4">
                <div className="flex items-center gap-2.5">
                  <div className="p-2 bg-red-50 rounded-xl">
                    <Bell className="w-4 h-4 text-red-500" />
                  </div>
                  <div>
                    <CardTitle className="text-xs font-bold text-gray-700">التنبيهات والإشعارات</CardTitle>
                    <p className="text-[10px] text-gray-400 mt-0.5">أحداث تستدعي الانتباه الفوري</p>
                  </div>
                </div>
              </CardHeader>
              <CardContent className="px-4 pb-4 space-y-2">
                {stats.inactiveUnits > 0 && (
                  <div className="flex items-start gap-3 p-3 bg-red-50 rounded-xl border border-red-100">
                    <XCircle className="w-4 h-4 text-red-500 shrink-0 mt-0.5" />
                    <div>
                      <p className="text-[11px] font-bold text-red-800">{stats.inactiveUnits} وحدة صحية موقوفة</p>
                      <p className="text-[10px] text-red-600 mt-0.5">راجع صفحة الوحدات الصحية لإعادة التفعيل</p>
                    </div>
                  </div>
                )}
                {needAttentionUnits.length > 0 && (
                  <div className="flex items-start gap-3 p-3 bg-amber-50 rounded-xl border border-amber-100">
                    <AlertTriangle className="w-4 h-4 text-amber-500 shrink-0 mt-0.5" />
                    <div>
                      <p className="text-[11px] font-bold text-amber-800">{needAttentionUnits.length} وحدة تحتاج متابعة اليوم</p>
                      <p className="text-[10px] text-amber-600 mt-0.5">هذه الوحدات لم تحقق 40% من هدفها اليومي</p>
                    </div>
                  </div>
                )}
                {stats.inactiveUnits === 0 && needAttentionUnits.length === 0 && (
                  <EmptyState
                    icon={<Bell className="w-5 h-5" />}
                    title="لا توجد تنبيهات نشطة"
                    message="النظام يعمل بشكل طبيعي"
                  />
                )}
              </CardContent>
            </Card>

            {/* Recent Activity (placeholder) */}
            <Card className="border-0 shadow-md bg-white">
              <CardHeader className="pb-2 pt-4 px-4">
                <div className="flex items-center gap-2.5">
                  <div className="p-2 bg-blue-50 rounded-xl">
                    <Zap className="w-4 h-4 text-blue-500" />
                  </div>
                  <div>
                    <CardTitle className="text-xs font-bold text-gray-700">آخر النشاطات</CardTitle>
                    <p className="text-[10px] text-gray-400 mt-0.5">أحدث الزيارات المسجلة في النظام</p>
                  </div>
                </div>
              </CardHeader>
              <CardContent className="px-4 pb-4">
                <EmptyState
                  icon={<Zap className="w-5 h-5" />}
                  title="سجل النشاط قيد التطوير"
                  message="سيعرض آخر الزيارات المسجلة بشكل فوري"
                />
              </CardContent>
            </Card>
          </div>

          {/* ═══ UNITS SECTION ════════════════════════════════════════════════ */}
          <div>
            <div className="flex items-center justify-between mb-4">
              <div>
                <h2 className="text-sm font-bold text-gray-800">الوحدات الصحية — مُجمَّعة بالإدارات</h2>
                <p className="text-[11px] text-gray-400 mt-0.5">
                  {filteredUnits.length} وحدة صحية {hasActiveFilters ? "(نتائج الفلتر)" : ""}
                </p>
              </div>
            </div>

            {Object.keys(deptGroups).length === 0 ? (
              <EmptyState
                icon={<Building2 className="w-6 h-6" />}
                title="لا توجد نتائج"
                message={hasActiveFilters ? "جرّب تعديل معايير الفلتر" : "لا توجد وحدات صحية مسجلة"}
              />
            ) : (
              <div className="space-y-4">
                {Object.entries(deptGroups).map(([deptId, deptUnits]) => {
                  const deptName = deptUnits[0]?.department_name || "قسم غير محدد";
                  const isOpen = openDepts[deptId] !== false;
                  const totalToday = deptUnits.reduce((s, u) => s + u.today_visits, 0);
                  const totalTarget = deptUnits.reduce((s, u) => s + u.daily_target, 0);
                  const deptPct = totalTarget > 0 ? Math.min(100, Math.round((totalToday / totalTarget) * 100)) : 0;
                  const activeCount = deptUnits.filter((u) => u.active).length;

                  return (
                    <Collapsible
                      key={deptId}
                      open={isOpen}
                      onOpenChange={(open) => setOpenDepts((prev) => ({ ...prev, [deptId]: open }))}
                    >
                      <Card className="border-0 shadow-md bg-white overflow-hidden">
                        <CollapsibleTrigger asChild>
                          <button className="w-full px-5 py-4 flex items-center justify-between hover:bg-emerald-50/40 transition-colors group">
                            <div className="flex items-center gap-3">
                              <div className="w-9 h-9 rounded-xl bg-emerald-100 flex items-center justify-center shrink-0">
                                <Building2 className="w-4 h-4 text-emerald-700" />
                              </div>
                              <div className="text-right">
                                <p className="font-bold text-sm text-gray-800 group-hover:text-emerald-700 transition-colors">
                                  {deptName}
                                </p>
                                <div className="flex items-center gap-2 mt-0.5">
                                  <Badge variant="secondary" className="text-[9px] h-4 bg-emerald-100 text-emerald-700 border-0 px-1.5">
                                    {deptUnits.length} وحدة
                                  </Badge>
                                  <Badge variant="secondary" className="text-[9px] h-4 bg-slate-100 text-slate-600 border-0 px-1.5">
                                    {activeCount} نشطة
                                  </Badge>
                                </div>
                              </div>
                            </div>
                            <div className="flex items-center gap-4">
                              <div className="text-left">
                                <p className="text-[11px] text-gray-500 font-medium">
                                  {totalToday} / {totalTarget} اليوم
                                </p>
                                <div className="flex items-center gap-1.5 mt-1">
                                  <div className="w-20 h-1.5 bg-gray-100 rounded-full overflow-hidden">
                                    <div
                                      className={`h-full rounded-full transition-all duration-500 ${
                                        deptPct >= 80 ? "bg-emerald-500" : deptPct >= 40 ? "bg-amber-400" : "bg-red-400"
                                      }`}
                                      style={{ width: `${deptPct}%` }}
                                    />
                                  </div>
                                  <span className={`text-[10px] font-black ${
                                    deptPct >= 80 ? "text-emerald-600" : deptPct >= 40 ? "text-amber-600" : "text-red-500"
                                  }`}>{deptPct}%</span>
                                </div>
                              </div>
                              {isOpen ? (
                                <ChevronUp className="w-4 h-4 text-gray-400" />
                              ) : (
                                <ChevronDown className="w-4 h-4 text-gray-400" />
                              )}
                            </div>
                          </button>
                        </CollapsibleTrigger>
                        <CollapsibleContent>
                          <div className="px-4 pb-4 pt-2 border-t border-gray-50 bg-slate-50/30">
                            <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-3 gap-3 mt-2">
                              {deptUnits.map((unit) => (
                                <UnitCard key={unit.id} unit={unit} />
                              ))}
                            </div>
                          </div>
                        </CollapsibleContent>
                      </Card>
                    </Collapsible>
                  );
                })}
              </div>
            )}
          </div>
        </>
      ) : null}
    </div>
  );
}
