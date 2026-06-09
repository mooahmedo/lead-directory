"use client";

import { useState } from "react";
import { Download, FileText, FileSpreadsheet, Loader2, ChevronDown, Users } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
  DropdownMenuSeparator,
  DropdownMenuLabel,
} from "@/components/ui/dropdown-menu";
import { toast } from "sonner";
import {
  exportToPDF,
  exportToExcel,
  exportPatientsPDF,
  exportPatientsExcel,
} from "@/lib/export-utils";

type ExportAction = "dashboard-pdf" | "dashboard-excel" | "patients-pdf" | "patients-excel";

export function ExportMenu({
  stats,
  units,
  departments,
  filters,
  lastUpdated,
}: {
  stats: any;
  units: any[];
  departments: any[];
  filters: any;
  lastUpdated: Date | null;
}) {
  const [isExporting, setIsExporting] = useState<ExportAction | null>(null);

  const handleExport = async (action: ExportAction) => {
    if (isExporting) return;

    const labels: Record<ExportAction, string> = {
      "dashboard-pdf": "تقرير لوحة التحكم PDF",
      "dashboard-excel": "تقرير لوحة التحكم Excel",
      "patients-pdf": "تقرير المرضى PDF",
      "patients-excel": "تقرير المرضى Excel",
    };

    setIsExporting(action);
    const toastId = toast.loading(`جاري تحضير ${labels[action]}...`);

    try {
      // 1. Log export action
      const exportType = action.includes("pdf") ? "PDF" : "Excel";
      const logRes = await fetch("/api/exports/log", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ export_type: exportType }),
      });

      if (!logRes.ok) {
        const errorData = await logRes.json();
        throw new Error(errorData.error || "فشل التحقق من الصلاحيات");
      }

      // 2. Generate and download
      switch (action) {
        case "dashboard-pdf":
          await exportToPDF({ stats, units, departments, filters, lastUpdated });
          break;
        case "dashboard-excel":
          await exportToExcel({ stats, units, departments, filters, lastUpdated });
          break;
        case "patients-pdf":
          await exportPatientsPDF();
          break;
        case "patients-excel":
          await exportPatientsExcel();
          break;
      }

      toast.success(`تم تصدير ${labels[action]} بنجاح`, { id: toastId });
    } catch (error: any) {
      console.error("Export error:", error);
      toast.error(`حدث خطأ أثناء التصدير`, {
        description: error.message || "الرجاء المحاولة مرة أخرى لاحقاً",
        id: toastId,
      });
    } finally {
      setIsExporting(null);
    }
  };

  return (
    <DropdownMenu dir="rtl">
      <DropdownMenuTrigger asChild>
        <Button
          disabled={!!isExporting}
          size="sm"
          className="bg-emerald-700/50 hover:bg-emerald-600/70 text-white border border-emerald-500/30 backdrop-blur-sm h-9 px-4 text-xs font-bold transition-all gap-1.5"
        >
          {isExporting ? (
            <Loader2 className="w-3.5 h-3.5 animate-spin" />
          ) : (
            <Download className="w-3.5 h-3.5" />
          )}
          تصدير التقرير
          <ChevronDown className="w-3 h-3 opacity-70 mr-1" />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-56 bg-white border-gray-100 shadow-xl rounded-xl p-1.5">
        {/* Dashboard Exports */}
        <DropdownMenuLabel className="text-[10px] font-bold text-gray-400 uppercase tracking-wider px-3 py-1.5">
          تقرير لوحة التحكم
        </DropdownMenuLabel>
        <DropdownMenuItem
          onClick={() => handleExport("dashboard-pdf")}
          disabled={!!isExporting}
          className="flex items-center gap-2.5 px-3 py-2.5 text-xs font-bold cursor-pointer rounded-lg text-gray-700 hover:bg-emerald-50 hover:text-emerald-700 focus:bg-emerald-50 focus:text-emerald-700"
        >
          <div className="p-1.5 bg-red-50 text-red-600 rounded-md">
            <FileText className="w-3.5 h-3.5" />
          </div>
          تصدير كملف PDF
        </DropdownMenuItem>
        <DropdownMenuItem
          onClick={() => handleExport("dashboard-excel")}
          disabled={!!isExporting}
          className="flex items-center gap-2.5 px-3 py-2.5 text-xs font-bold cursor-pointer rounded-lg text-gray-700 hover:bg-emerald-50 hover:text-emerald-700 focus:bg-emerald-50 focus:text-emerald-700 mt-0.5"
        >
          <div className="p-1.5 bg-green-50 text-green-600 rounded-md">
            <FileSpreadsheet className="w-3.5 h-3.5" />
          </div>
          تصدير كملف Excel
        </DropdownMenuItem>

        <DropdownMenuSeparator className="my-1.5" />

        {/* Patient Exports */}
        <DropdownMenuLabel className="text-[10px] font-bold text-gray-400 uppercase tracking-wider px-3 py-1.5">
          تقرير بيانات المرضى
        </DropdownMenuLabel>
        <DropdownMenuItem
          onClick={() => handleExport("patients-pdf")}
          disabled={!!isExporting}
          className="flex items-center gap-2.5 px-3 py-2.5 text-xs font-bold cursor-pointer rounded-lg text-gray-700 hover:bg-blue-50 hover:text-blue-700 focus:bg-blue-50 focus:text-blue-700"
        >
          <div className="p-1.5 bg-red-50 text-red-600 rounded-md">
            <Users className="w-3.5 h-3.5" />
          </div>
          تصدير المرضى PDF
        </DropdownMenuItem>
        <DropdownMenuItem
          onClick={() => handleExport("patients-excel")}
          disabled={!!isExporting}
          className="flex items-center gap-2.5 px-3 py-2.5 text-xs font-bold cursor-pointer rounded-lg text-gray-700 hover:bg-blue-50 hover:text-blue-700 focus:bg-blue-50 focus:text-blue-700 mt-0.5"
        >
          <div className="p-1.5 bg-green-50 text-green-600 rounded-md">
            <FileSpreadsheet className="w-3.5 h-3.5" />
          </div>
          تصدير المرضى Excel
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
