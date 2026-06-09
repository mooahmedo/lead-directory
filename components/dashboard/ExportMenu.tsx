"use client";

import { useState } from "react";
import { Download, FileText, FileSpreadsheet, Loader2, ChevronDown } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { toast } from "sonner";
import { exportToPDF, exportToExcel } from "@/lib/export-utils";

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
  const [isExporting, setIsExporting] = useState<"pdf" | "excel" | null>(null);

  const handleExport = async (type: "pdf" | "excel") => {
    if (isExporting) return;
    
    setIsExporting(type);
    const toastId = toast.loading(`جاري تحضير ملف ${type.toUpperCase()}...`);

    try {
      // 1. Log export action via secure API
      const logRes = await fetch("/api/exports/log", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ export_type: type === "pdf" ? "PDF" : "Excel" }),
      });

      if (!logRes.ok) {
        const errorData = await logRes.json();
        throw new Error(errorData.error || "فشل التحقق من الصلاحيات لتسجيل عملية التصدير");
      }

      // 2. Generate and download
      if (type === "pdf") {
        await exportToPDF({ stats, units, departments, filters, lastUpdated });
      } else {
        await exportToExcel({ stats, units, departments, filters, lastUpdated });
      }

      toast.success(`تم تصدير ملف ${type.toUpperCase()} بنجاح`, { id: toastId });
    } catch (error: any) {
      console.error("Export error:", error);
      toast.error(`حدث خطأ أثناء تصدير ${type.toUpperCase()}`, {
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
      <DropdownMenuContent align="end" className="w-48 bg-white border-gray-100 shadow-xl rounded-xl p-1.5">
        <DropdownMenuItem
          onClick={() => handleExport("pdf")}
          disabled={!!isExporting}
          className="flex items-center gap-2.5 px-3 py-2.5 text-xs font-bold cursor-pointer rounded-lg text-gray-700 hover:bg-emerald-50 hover:text-emerald-700 focus:bg-emerald-50 focus:text-emerald-700"
        >
          <div className="p-1.5 bg-red-50 text-red-600 rounded-md">
            <FileText className="w-3.5 h-3.5" />
          </div>
          تصدير كملف PDF
        </DropdownMenuItem>
        <DropdownMenuItem
          onClick={() => handleExport("excel")}
          disabled={!!isExporting}
          className="flex items-center gap-2.5 px-3 py-2.5 text-xs font-bold cursor-pointer rounded-lg text-gray-700 hover:bg-emerald-50 hover:text-emerald-700 focus:bg-emerald-50 focus:text-emerald-700 mt-1"
        >
          <div className="p-1.5 bg-green-50 text-green-600 rounded-md">
            <FileSpreadsheet className="w-3.5 h-3.5" />
          </div>
          تصدير كملف Excel
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
