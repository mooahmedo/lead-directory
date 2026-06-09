"use client";

import { useState, useEffect, useCallback } from "react";
import { Download, Database, RefreshCw, Loader2, FileText, CheckCircle2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { toast } from "sonner";
import { saveAs } from "file-saver";
import * as XLSX from "xlsx";
import type { UserProfile } from "@/lib/types";

export function BackupManagementView({ profile }: { profile: UserProfile }) {
  const [logs, setLogs] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [generating, setGenerating] = useState(false);

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

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-xl font-black text-gray-800">إدارة النسخ الاحتياطية</h2>
          <p className="text-xs text-gray-500 mt-1">نسخ احتياطي شامل لقواعد البيانات بصيغتي JSON و Excel</p>
        </div>
        <Button
          onClick={handleGenerateBackup}
          disabled={generating || profile.role !== "supervisor"}
          className="bg-emerald-600 hover:bg-emerald-700 text-white font-bold h-10 px-4 flex items-center gap-2"
        >
          {generating ? <Loader2 className="w-4 h-4 animate-spin" /> : <Database className="w-4 h-4" />}
          إنشاء نسخة احتياطية الآن
        </Button>
      </div>

      <Card className="border-0 shadow-md bg-white">
        <CardHeader className="border-b border-gray-100 bg-slate-50/50 pb-4">
          <div className="flex items-center justify-between">
            <CardTitle className="text-sm font-bold text-gray-700 flex items-center gap-2">
              <FileText className="w-4 h-4 text-emerald-600" />
              سجل عمليات النسخ الاحتياطي
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
                  <th className="p-4 font-bold">تاريخ الإنشاء</th>
                  <th className="p-4 font-bold">المنشئ</th>
                  <th className="p-4 font-bold">عدد السجلات</th>
                  <th className="p-4 font-bold">النوع</th>
                  <th className="p-4 font-bold">الحالة</th>
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
                        <Badge variant="outline" className="text-[9px] border-emerald-200 text-emerald-700 bg-emerald-50">Excel</Badge>
                        <Badge variant="outline" className="text-[9px] border-blue-200 text-blue-700 bg-blue-50">JSON</Badge>
                      </div>
                    </td>
                    <td className="p-4">
                      <span className="flex items-center gap-1.5 text-[11px] font-bold text-emerald-600">
                        <CheckCircle2 className="w-3.5 h-3.5" />
                        ناجح
                      </span>
                    </td>
                  </tr>
                ))}
                {!loading && logs.length === 0 && (
                  <tr>
                    <td colSpan={6} className="text-center py-12 text-gray-400">
                      لا يوجد أي سجلات نسخ احتياطي حتى الآن
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
    </div>
  );
}
