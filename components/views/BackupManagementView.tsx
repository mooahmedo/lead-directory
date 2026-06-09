"use client";

import { useState, useEffect, useCallback, useRef } from "react";
import { Download, Database, RefreshCw, Loader2, FileText, CheckCircle2, UploadCloud, AlertTriangle, ShieldAlert, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { toast } from "sonner";
import { saveAs } from "file-saver";
import * as XLSX from "xlsx";
import type { UserProfile } from "@/lib/types";

export function BackupManagementView({ profile }: { profile: UserProfile }) {
  const [logs, setLogs] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [generating, setGenerating] = useState(false);

  // Restore state
  const [restoring, setRestoring] = useState(false);
  const [fileToRestore, setFileToRestore] = useState<File | null>(null);
  const [showRestoreModal, setShowRestoreModal] = useState(false);
  const [confirmText, setConfirmText] = useState("");
  const fileInputRef = useRef<HTMLInputElement>(null);

  // Reset state
  const [resetType, setResetType] = useState<"patient_data" | "operational_data" | null>(null);
  const [showResetModal, setShowResetModal] = useState(false);
  const [resetConfirmText, setResetConfirmText] = useState("");
  const [resetting, setResetting] = useState(false);

  const loadLogs = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch("/api/backups");
      if (!res.ok) throw new Error("فشل تحميل سجل النسخ الاحتياطي");
      const data = await res.json();
      setLogs(data.logs || []);
    } catch (err: any) {
      toast.error(err.message);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    loadLogs();
  }, [loadLogs]);

  // Helper to generate backup before reset
  const generateAutomaticBackup = async (): Promise<string> => {
    const res = await fetch("/api/backups", { method: "POST" });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || "فشل إنشاء النسخة الاحتياطية التلقائية");
    
    const { backup, fileName } = data;
    const jsonStr = JSON.stringify(backup, null, 2);
    const jsonBlob = new Blob([jsonStr], { type: "application/json" });
    saveAs(jsonBlob, `PRE_RESET_${fileName}.json`);
    
    return `PRE_RESET_${fileName}.json`;
  };

  const executeReset = async () => {
    const requiredText = resetType === "patient_data" ? "DELETE PATIENT DATA" : "DELETE OPERATIONAL DATA";
    if (resetConfirmText !== requiredText) {
      toast.error("يرجى إدخال نص التأكيد بشكل صحيح");
      return;
    }

    setResetting(true);
    const toastId = toast.loading("جاري مسح البيانات. يرجى عدم إغلاق النافذة...");

    try {
      // 1. Mandatory Backup
      toast.loading("جاري إنشاء نسخة احتياطية إلزامية قبل المسح...", { id: toastId });
      const backupFileName = await generateAutomaticBackup();

      // 2. Execute Reset
      toast.loading("جاري مسح البيانات المحددة...", { id: toastId });
      const res = await fetch("/api/system/reset", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ resetType, backupFile: backupFileName }),
      });

      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "حدث خطأ أثناء المسح");

      toast.success(data.message || `تمت عملية المسح بنجاح (حذف ${data.recordsDeleted} سجل)`, { id: toastId });
      setShowResetModal(false);
      setResetType(null);
      setResetConfirmText("");
      loadLogs();
      
      setTimeout(() => window.location.reload(), 2000);
    } catch (err: any) {
      console.error(err);
      toast.error(err.message || "فشل إكمال عملية المسح", { id: toastId });
    } finally {
      setResetting(false);
    }
  };

  const handleGenerateBackup = async () => {
    if (generating) return;
    setGenerating(true);
    const toastId = toast.loading("جاري تجميع بيانات النظام وإنشاء النسخة الاحتياطية...");

    try {
      const res = await fetch("/api/backups", { method: "POST" });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "فشل إنشاء النسخة الاحتياطية");

      const { backup, fileName, totalRecords } = data;

      // 1. Generate JSON Backup
      const jsonStr = JSON.stringify(backup, null, 2);
      const jsonBlob = new Blob([jsonStr], { type: "application/json" });
      saveAs(jsonBlob, `${fileName}.json`);

      // 2. Generate Excel Backup
      const workbook = XLSX.utils.book_new();
      
      const patientsSheet = XLSX.utils.json_to_sheet(backup.patients);
      XLSX.utils.book_append_sheet(workbook, patientsSheet, "Patients");
      
      const visitsSheet = XLSX.utils.json_to_sheet(backup.visits.map((v: any) => ({
        id: v.id,
        patient_id: v.patient_id,
        unit_id: v.unit_id,
        visit_type: v.visit_type,
        visit_date: v.visit_date,
        weight: v.weight,
        height: v.height,
        sugar_type: v.sugar_type,
        sugar_level: v.sugar_level,
        hba1c: v.hba1c,
        systolic: v.systolic,
        diastolic: v.diastolic,
        cholesterol: v.cholesterol,
        triglycerides: v.triglycerides,
        ldl: v.ldl,
        hdl: v.hdl,
        creatinine: v.creatinine,
        egfr: v.egfr,
        referred: v.referred,
        referral_dest: v.referral_dest
      })));
      XLSX.utils.book_append_sheet(workbook, visitsSheet, "Visits");
      
      const unitsSheet = XLSX.utils.json_to_sheet(backup.health_units);
      XLSX.utils.book_append_sheet(workbook, unitsSheet, "Health_Units");

      XLSX.writeFile(workbook, `${fileName}.xlsx`);

      toast.success(`تم إنشاء وتنزيل النسخة الاحتياطية بنجاح (${totalRecords} سجل)`, { id: toastId });
      loadLogs(); // Refresh logs
    } catch (err: any) {
      console.error(err);
      toast.error(err.message, { id: toastId });
    } finally {
      setGenerating(false);
    }
  };

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    if (file.type !== "application/json" && !file.name.endsWith(".json")) {
      toast.error("يرجى اختيار ملف بصيغة JSON");
      return;
    }
    setFileToRestore(file);
    setShowRestoreModal(true);
  };

  const executeRestore = async () => {
    if (confirmText !== "RESTORE SYSTEM DATA") {
      toast.error("يرجى إدخال نص التأكيد بشكل صحيح");
      return;
    }
    if (!fileToRestore) return;

    setRestoring(true);
    const toastId = toast.loading("جاري استرجاع البيانات. يرجى عدم إغلاق النافذة...");

    try {
      const fileContent = await fileToRestore.text();
      const backupData = JSON.parse(fileContent);

      // We attach the filename to metadata to log it later
      if (!backupData.metadata) backupData.metadata = {};
      backupData.metadata.file_name = fileToRestore.name;

      const res = await fetch("/api/backups/restore", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ backupData }),
      });

      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "حدث خطأ غير متوقع أثناء الاسترجاع");

      toast.success(data.message || `تم استرجاع عدد ${data.restoredRecords} سجل بنجاح`, { id: toastId });
      setShowRestoreModal(false);
      setFileToRestore(null);
      setConfirmText("");
      loadLogs();
      
      // Auto refresh the page after successful restore to reset states
      setTimeout(() => window.location.reload(), 2000);
    } catch (err: any) {
      console.error(err);
      toast.error(err.message || "فشل تحليل ملف الاسترجاع", { id: toastId });
    } finally {
      setRestoring(false);
      if (fileInputRef.current) fileInputRef.current.value = "";
    }
  };

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-xl font-black text-gray-800">إدارة النسخ الاحتياطية والاسترجاع</h2>
          <p className="text-xs text-gray-500 mt-1">نسخ احتياطي شامل لقواعد البيانات واسترجاعها (JSON / Excel)</p>
        </div>
        <div className="flex gap-3">
          <input
            type="file"
            accept=".json"
            className="hidden"
            ref={fileInputRef}
            onChange={handleFileChange}
          />
          <Button
            onClick={() => fileInputRef.current?.click()}
            disabled={generating || restoring || resetting || profile.role !== "supervisor"}
            variant="outline"
            className="border-blue-200 text-blue-700 hover:bg-blue-50 font-bold h-10 px-4 flex items-center gap-2"
          >
            <UploadCloud className="w-4 h-4" />
            استرجاع من ملف JSON
          </Button>
          <Button
            onClick={handleGenerateBackup}
            disabled={generating || restoring || resetting || profile.role !== "supervisor"}
            className="bg-emerald-600 hover:bg-emerald-700 text-white font-bold h-10 px-4 flex items-center gap-2"
          >
            {generating ? <Loader2 className="w-4 h-4 animate-spin" /> : <Database className="w-4 h-4" />}
            إنشاء نسخة احتياطية الآن
          </Button>
        </div>
      </div>

      <Card className="border-0 shadow-md bg-white">
        <CardHeader className="border-b border-gray-100 bg-slate-50/50 pb-4">
          <div className="flex items-center justify-between">
            <CardTitle className="text-sm font-bold text-gray-700 flex items-center gap-2">
              <FileText className="w-4 h-4 text-emerald-600" />
              سجل عمليات النسخ الاحتياطي والاسترجاع
            </CardTitle>
            <Button onClick={loadLogs} variant="ghost" size="sm" className="h-8 w-8 p-0" disabled={loading}>
              <RefreshCw className={`w-4 h-4 text-gray-500 ${loading ? "animate-spin" : ""}`} />
            </Button>
          </div>
        </CardHeader>
        <CardContent className="p-0">
          <div className="overflow-x-auto">
            <table className="w-full text-right border-collapse">
              <thead>
                <tr className="bg-white border-b border-gray-100 text-[11px] font-bold text-gray-400 uppercase tracking-wider">
                  <th className="p-4 font-bold">اسم الملف</th>
                  <th className="p-4 font-bold">التاريخ</th>
                  <th className="p-4 font-bold">المشرف</th>
                  <th className="p-4 font-bold">عدد السجلات</th>
                  <th className="p-4 font-bold">النوع</th>
                  <th className="p-4 font-bold">العملية</th>
                </tr>
              </thead>
              <tbody className="text-xs divide-y divide-gray-50">
                {logs.map((log) => (
                  <tr key={log.id} className="hover:bg-slate-50/50 transition-colors">
                    <td className="p-4 font-mono font-medium text-emerald-700">{log.file_name}</td>
                    <td className="p-4 text-gray-600" dir="ltr" style={{ textAlign: "right" }}>
                      {new Date(log.created_at).toLocaleString("ar-EG", { dateStyle: "medium", timeStyle: "short" })}
                    </td>
                    <td className="p-4 text-gray-800 font-medium">{log.user_name || log.user_email}</td>
                    <td className="p-4">
                      <Badge variant="secondary" className="bg-slate-100 text-slate-700 font-mono">
                        {log.record_count.toLocaleString("ar-EG")} سجل
                      </Badge>
                    </td>
                    <td className="p-4">
                      <div className="flex gap-1">
                        {log.backup_type === "excel" ? (
                          <Badge variant="outline" className="text-[9px] border-emerald-200 text-emerald-700 bg-emerald-50">Excel</Badge>
                        ) : log.backup_type === "json" ? (
                          <Badge variant="outline" className="text-[9px] border-blue-200 text-blue-700 bg-blue-50">JSON</Badge>
                        ) : (
                          <Badge variant="outline" className="text-[9px] border-purple-200 text-purple-700 bg-purple-50">Full / Manual</Badge>
                        )}
                      </div>
                    </td>
                    <td className="p-4">
                      <span className={`flex items-center gap-1.5 text-[11px] font-bold ${log.action === "restored" ? "text-blue-600" : "text-emerald-600"}`}>
                        <CheckCircle2 className="w-3.5 h-3.5" />
                        {log.action === "restored" ? "استرجاع" : "نسخ احتياطي"}
                      </span>
                    </td>
                  </tr>
                ))}
                {!loading && logs.length === 0 && (
                  <tr>
                    <td colSpan={6} className="text-center py-12 text-gray-400">
                      لا يوجد أي سجلات حتى الآن
                    </td>
                  </tr>
                )}
                {loading && logs.length === 0 && (
                  <tr>
                    <td colSpan={6} className="text-center py-12">
                      <Loader2 className="w-6 h-6 animate-spin text-emerald-500 mx-auto" />
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </CardContent>
      </Card>

      {/* Danger Zone */}
      <Card className="border-red-200 shadow-md bg-white overflow-hidden mt-8">
        <CardHeader className="bg-red-50/50 border-b border-red-100">
          <CardTitle className="text-red-700 flex items-center gap-2 text-sm font-bold">
            <AlertTriangle className="w-5 h-5" /> منطقة الخطر (Danger Zone)
          </CardTitle>
        </CardHeader>
        <CardContent className="p-6">
          <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
            <div className="border border-gray-200 rounded-xl p-5 hover:border-red-300 transition-colors bg-white shadow-sm">
              <h3 className="font-bold text-gray-800 text-sm">مسح بيانات المرضى والزيارات</h3>
              <p className="text-xs text-gray-500 mt-2 mb-4 leading-relaxed">
                يؤدي هذا الإجراء إلى حذف جميع سجلات المرضى والزيارات المرتبطة بهم بالكامل. لن يتم حذف المستخدمين أو الإدارات.
                سيتم تنزيل نسخة احتياطية تلقائياً قبل المسح.
              </p>
              <Button
                onClick={() => { setResetType("patient_data"); setShowResetModal(true); }}
                disabled={generating || restoring || resetting || profile.role !== "supervisor"}
                variant="outline"
                className="w-full border-red-200 text-red-600 hover:bg-red-50 hover:text-red-700 h-9 text-xs font-bold"
              >
                <Trash2 className="w-3.5 h-3.5 ml-1.5" /> تفريغ بيانات المرضى
              </Button>
            </div>

            <div className="border border-red-200 rounded-xl p-5 hover:border-red-300 transition-colors bg-red-50/30 shadow-sm">
              <h3 className="font-bold text-red-800 text-sm">إعادة ضبط النظام (Operational Reset)</h3>
              <p className="text-xs text-red-600 mt-2 mb-4 leading-relaxed">
                مسح شامل يشمل جميع بيانات المرضى، الزيارات، والمستخدمين (باستثناء حساب المشرف الحالي). ستبقى الوحدات والإدارات كما هي.
                سيتم تنزيل نسخة احتياطية تلقائياً قبل المسح.
              </p>
              <Button
                onClick={() => { setResetType("operational_data"); setShowResetModal(true); }}
                disabled={generating || restoring || resetting || profile.role !== "supervisor"}
                className="w-full bg-red-600 hover:bg-red-700 text-white h-9 text-xs font-bold"
              >
                <AlertTriangle className="w-3.5 h-3.5 ml-1.5" /> إعادة ضبط النظام بالكامل
              </Button>
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Restore Confirmation Modal */}
      {showRestoreModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm p-4" dir="rtl">
          <Card className="w-full max-w-md border-2 border-red-500 shadow-2xl bg-white rounded-2xl overflow-hidden animate-in fade-in zoom-in-95 duration-200">
            <CardHeader className="bg-red-50 border-b border-red-100 flex flex-row items-start gap-3 p-5">
              <ShieldAlert className="w-6 h-6 text-red-600 shrink-0 mt-0.5" />
              <div>
                <CardTitle className="text-red-800 font-bold">تحذير بالغ الأهمية: استرجاع البيانات</CardTitle>
                <p className="text-xs text-red-600 mt-1 leading-relaxed">
                  أنت على وشك استرجاع البيانات من الملف <span className="font-mono bg-red-100 px-1 rounded">{fileToRestore?.name}</span>. هذه العملية ستؤدي إلى <span className="font-bold underline">مسح جميع بيانات المرضى والزيارات الحالية</span> واستبدالها ببيانات الملف.
                </p>
              </div>
            </CardHeader>
            <CardContent className="p-5 space-y-4">
              <div className="bg-amber-50 p-3 rounded-lg border border-amber-200">
                <p className="text-[11px] text-amber-800 font-bold flex items-center gap-1.5">
                  <AlertTriangle className="w-3.5 h-3.5" /> إجراء لا يمكن التراجع عنه
                </p>
                <p className="text-[10px] text-amber-700 mt-1">تأكد من أنك قمت بعمل نسخة احتياطية حديثة قبل متابعة الاسترجاع.</p>
              </div>
              <div className="space-y-1.5">
                <label className="text-xs font-bold text-gray-700">لتأكيد العملية، اكتب: RESTORE SYSTEM DATA</label>
                <Input
                  value={confirmText}
                  onChange={(e) => setConfirmText(e.target.value)}
                  dir="ltr"
                  placeholder="RESTORE SYSTEM DATA"
                  className="font-mono text-center bg-gray-50 focus:border-red-500 focus:ring-red-500"
                />
              </div>
              <div className="flex gap-2 pt-2">
                <Button
                  onClick={() => {
                    setShowRestoreModal(false);
                    setFileToRestore(null);
                    setConfirmText("");
                    if (fileInputRef.current) fileInputRef.current.value = "";
                  }}
                  variant="outline"
                  className="flex-1"
                  disabled={restoring}
                >
                  إلغاء
                </Button>
                <Button
                  onClick={executeRestore}
                  disabled={confirmText !== "RESTORE SYSTEM DATA" || restoring}
                  className="flex-1 bg-red-600 hover:bg-red-700 text-white font-bold"
                >
                  {restoring ? <Loader2 className="w-4 h-4 animate-spin" /> : "تأكيد واسترجاع"}
                </Button>
              </div>
            </CardContent>
          </Card>
        </div>
      )}

      {/* Reset Confirmation Modal */}
      {showResetModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm p-4" dir="rtl">
          <Card className="w-full max-w-md border-2 border-red-600 shadow-2xl bg-white rounded-2xl overflow-hidden animate-in fade-in zoom-in-95 duration-200">
            <CardHeader className="bg-red-600 text-white flex flex-row items-start gap-3 p-5">
              <AlertTriangle className="w-6 h-6 text-white shrink-0 mt-0.5" />
              <div>
                <CardTitle className="text-white font-bold">تأكيد عملية المسح الإلزامي</CardTitle>
                <p className="text-xs text-red-100 mt-1 leading-relaxed">
                  {resetType === "patient_data"
                    ? "أنت على وشك مسح جميع بيانات المرضى والزيارات. لن تتمكن من استرجاعها بدون النسخة الاحتياطية التي سيتم إنشاؤها تلقائياً."
                    : "أنت على وشك إجراء مسح شامل للمنصة. سيتم مسح بيانات المرضى والزيارات والمستخدمين."}
                </p>
              </div>
            </CardHeader>
            <CardContent className="p-5 space-y-4">
              <div className="space-y-1.5">
                <label className="text-xs font-bold text-gray-700">
                  لتأكيد العملية، اكتب: {resetType === "patient_data" ? "DELETE PATIENT DATA" : "DELETE OPERATIONAL DATA"}
                </label>
                <Input
                  value={resetConfirmText}
                  onChange={(e) => setResetConfirmText(e.target.value)}
                  dir="ltr"
                  placeholder={resetType === "patient_data" ? "DELETE PATIENT DATA" : "DELETE OPERATIONAL DATA"}
                  className="font-mono text-center bg-gray-50 focus:border-red-500 focus:ring-red-500"
                />
              </div>
              <div className="flex gap-2 pt-2">
                <Button
                  onClick={() => {
                    setShowResetModal(false);
                    setResetType(null);
                    setResetConfirmText("");
                  }}
                  variant="outline"
                  className="flex-1"
                  disabled={resetting}
                >
                  إلغاء
                </Button>
                <Button
                  onClick={executeReset}
                  disabled={
                    resetting ||
                    (resetType === "patient_data" && resetConfirmText !== "DELETE PATIENT DATA") ||
                    (resetType === "operational_data" && resetConfirmText !== "DELETE OPERATIONAL DATA")
                  }
                  className="flex-1 bg-red-600 hover:bg-red-700 text-white font-bold"
                >
                  {resetting ? <Loader2 className="w-4 h-4 animate-spin" /> : "تأكيد ومسح البيانات"}
                </Button>
              </div>
            </CardContent>
          </Card>
        </div>
      )}
    </div>
  );
}
