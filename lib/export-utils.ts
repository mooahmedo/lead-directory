import jsPDF from "jspdf";
import html2canvas from "html2canvas";
import ExcelJS from "exceljs";
import { saveAs } from "file-saver";

// Helper to create an off-screen element, capture it, and return canvas
async function captureElement(htmlContent: string, width = 800) {
  const container = document.createElement("div");
  container.style.position = "absolute";
  container.style.left = "-9999px";
  container.style.top = "0";
  container.style.width = `${width}px`;
  container.style.backgroundColor = "#f8fafc";
  container.style.direction = "rtl";
  container.innerHTML = htmlContent;
  document.body.appendChild(container);

  // Allow styles and fonts to render
  await new Promise((resolve) => setTimeout(resolve, 500));

  const canvas = await html2canvas(container, {
    scale: 2,
    useCORS: true,
    logging: false,
  });

  document.body.removeChild(container);
  return canvas;
}

export async function exportToPDF({ stats, units, departments, filters, lastUpdated }: any) {
  const doc = new jsPDF("p", "mm", "a4");
  const pageWidth = doc.internal.pageSize.getWidth();
  const pageHeight = doc.internal.pageSize.getHeight();
  const margin = 10;

  // 1. Cover Page
  const generatedAt = new Date().toLocaleString("ar-EG");
  const coverHtml = `
    <div style="padding: 60px; height: 1000px; display: flex; flex-direction: column; justify-content: center; align-items: center; background: linear-gradient(to bottom right, #064e3b, #047857); color: white; text-align: center; font-family: system-ui, sans-serif;">
      <h3 style="font-size: 24px; color: #6ee7b7; margin-bottom: 20px;">وزارة الصحة والسكان</h3>
      <h1 style="font-size: 48px; font-weight: 900; margin: 0;">لوحة التحكم والتقرير التنفيذي</h1>
      <h2 style="font-size: 32px; font-weight: bold; margin-top: 10px;">مبادرة الأمراض المزمنة</h2>
      <div style="margin-top: 60px; padding: 20px; background: rgba(255,255,255,0.1); border-radius: 16px;">
        <p style="font-size: 20px; margin: 5px 0;">تاريخ التقرير: ${generatedAt}</p>
        <p style="font-size: 20px; margin: 5px 0;">تم الإنشاء بواسطة: نظام الإدارة الإلكتروني</p>
      </div>
    </div>
  `;
  const coverCanvas = await captureElement(coverHtml, 800);
  const coverHeight = (coverCanvas.height * pageWidth) / coverCanvas.width;
  doc.addImage(coverCanvas.toDataURL("image/png"), "PNG", 0, 0, pageWidth, coverHeight);

  // 2. Capture Dashboard Area
  const dashboardEl = document.getElementById("dashboard-export-area");
  if (dashboardEl) {
    doc.addPage();
    const dashboardCanvas = await html2canvas(dashboardEl, {
      scale: 2,
      useCORS: true,
      logging: false,
      backgroundColor: "#f8fafc",
    });

    const imgWidth = pageWidth - 2 * margin;
    const imgHeight = (dashboardCanvas.height * imgWidth) / dashboardCanvas.width;
    const imgData = dashboardCanvas.toDataURL("image/png");

    let remainingHeight = imgHeight;
    let yOffset = margin;

    doc.addImage(imgData, "PNG", margin, yOffset, imgWidth, imgHeight);
    remainingHeight -= (pageHeight - margin * 2);

    while (remainingHeight > 0) {
      doc.addPage();
      yOffset -= (pageHeight - margin * 2);
      doc.addImage(imgData, "PNG", margin, yOffset, imgWidth, imgHeight);
      remainingHeight -= (pageHeight - margin * 2);
    }
  }

  const filename = `Dashboard_Report_${new Date().toISOString().slice(0, 16).replace("T", "_").replace(":", "-")}.pdf`;
  doc.save(filename);
}

export async function exportToExcel({ stats, units, departments, filters, lastUpdated }: any) {
  const workbook = new ExcelJS.Workbook();
  workbook.creator = "Ministry of Health";
  workbook.lastModifiedBy = "Supervisor";
  workbook.created = new Date();

  const addSheet = (name: string) => {
    const sheet = workbook.addWorksheet(name, { views: [{ rightToLeft: true }] });
    return sheet;
  };

  // Sheet 1: Executive Summary
  const ws1 = addSheet("ملخص تنفيذي");
  ws1.columns = [{ width: 30 }, { width: 30 }];
  ws1.addRow(["تاريخ التقرير", new Date().toLocaleString("ar-EG")]);
  ws1.addRow(["إجمالي المرضى المسجلين", stats.totalPatients]);
  ws1.addRow(["إجمالي الزيارات", stats.totalVisits]);
  ws1.addRow(["زيارات اليوم", stats.todayVisits]);
  ws1.addRow(["الوحدات الصحية النشطة", stats.activeUnits]);
  ws1.addRow(["الوحدات المتوقفة", stats.inactiveUnits]);
  
  ws1.getRow(1).font = { bold: true };
  
  // Sheet 2: KPI Overview
  const ws2 = addSheet("مؤشرات الأداء");
  ws2.columns = [{ width: 30 }, { width: 30 }];
  ws2.addRow(["حالات أول مرة", stats.newPatients]);
  ws2.addRow(["حالات مترددة", stats.returningPatients]);
  ws2.addRow(["حالات إحالة", stats.referrals]);

  // Sheet 3: Unit Level Details
  const ws3 = addSheet("تفاصيل الوحدات");
  ws3.columns = [
    { header: "كود الوحدة", key: "code", width: 15 },
    { header: "اسم الوحدة", key: "name", width: 40 },
    { header: "الإدارة", key: "department", width: 30 },
    { header: "الهدف اليومي", key: "daily_target", width: 15 },
    { header: "الهدف الشهري", key: "monthly_target", width: 15 },
    { header: "زيارات اليوم", key: "today_visits", width: 15 },
    { header: "زيارات الشهر", key: "month_visits", width: 15 },
    { header: "الإنجاز اليومي (%)", key: "pct", width: 20 },
    { header: "الحالة", key: "status", width: 15 },
  ];
  
  ws3.getRow(1).font = { bold: true, color: { argb: "FFFFFFFF" } };
  ws3.getRow(1).fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FF059669" } };

  units.forEach((u: any) => {
    const pct = u.daily_target > 0 ? Math.round((u.today_visits / u.daily_target) * 100) : 0;
    const status = !u.active ? "موقوفة" : pct >= 80 ? "نشطة" : pct >= 40 ? "متوسطة" : "تحتاج متابعة";
    
    ws3.addRow({
      code: u.code,
      name: u.name,
      department: u.department_name,
      daily_target: u.daily_target,
      monthly_target: u.monthly_target,
      today_visits: u.today_visits,
      month_visits: u.month_visits,
      pct: pct,
      status: status,
    });
  });

  // Sheet 4: Dashboard Snapshot (Charts & Data)
  const ws4 = addSheet("لقطة لوحة التحكم");
  const dashboardEl = document.getElementById("dashboard-export-area");
  if (dashboardEl) {
    const dashboardCanvas = await html2canvas(dashboardEl, {
      scale: 1, // smaller scale for excel to save file size
      useCORS: true,
      logging: false,
    });
    const base64Image = dashboardCanvas.toDataURL("image/png");
    const imageId = workbook.addImage({
      base64: base64Image,
      extension: "png",
    });
    ws4.addImage(imageId, {
      tl: { col: 0, row: 0 },
      ext: { width: dashboardCanvas.width, height: dashboardCanvas.height },
    });
  }

  // Download
  const buffer = await workbook.xlsx.writeBuffer();
  const filename = `Dashboard_Report_${new Date().toISOString().slice(0, 16).replace("T", "_").replace(":", "-")}.xlsx`;
  saveAs(new Blob([buffer]), filename);
}

// ═══════════════════════════════════════════════════════════════════════════════
// PHASE 2 — PATIENT EXPORT SYSTEM
// ═══════════════════════════════════════════════════════════════════════════════

interface PatientExportData {
  departments: Record<string, {
    department_name: string;
    records: any[];
    totals: { total: number; new_patients: number; returning: number; referred: number };
  }>;
  grandTotals: { total: number; new_patients: number; returning: number; referred: number };
  exportedAt: string;
  exportedBy: string;
}

async function fetchPatientExportData(): Promise<PatientExportData> {
  const res = await fetch("/api/exports/patients");
  if (!res.ok) {
    const body = await res.json().catch(() => ({ error: res.statusText }));
    throw new Error(body.error || `HTTP ${res.status}`);
  }
  return res.json();
}

function formatDate(dateStr: string | null | undefined): string {
  if (!dateStr) return "—";
  try {
    return new Date(dateStr).toLocaleDateString("ar-EG", {
      year: "numeric", month: "2-digit", day: "2-digit",
    });
  } catch {
    return "—";
  }
}

function getScreeningSummary(v: any): string {
  const parts: string[] = [];
  if (v.sugar_level != null) parts.push(`سكر: ${v.sugar_level} (${v.sugar_type || "—"})`);
  if (v.hba1c != null) parts.push(`HbA1c: ${v.hba1c}`);
  if (v.systolic != null && v.diastolic != null) parts.push(`ضغط: ${v.systolic}/${v.diastolic}`);
  if (v.cholesterol != null) parts.push(`كوليسترول: ${v.cholesterol}`);
  if (v.creatinine != null) parts.push(`كرياتينين: ${v.creatinine}`);
  return parts.length > 0 ? parts.join(" | ") : "لا توجد فحوصات";
}

function getDiagnosis(v: any): string {
  const findings: string[] = [];
  if (v.sugar_level != null) {
    if (v.sugar_type === "صائم" && v.sugar_level >= 126) findings.push("سكري");
    else if (v.sugar_type === "عشوائي" && v.sugar_level >= 200) findings.push("سكري");
    else if (v.sugar_type === "صائم" && v.sugar_level >= 100) findings.push("ما قبل السكري");
  }
  if (v.hba1c != null) {
    if (v.hba1c >= 6.5) findings.push("HbA1c مرتفع");
  }
  if (v.systolic != null && v.systolic >= 140) findings.push("ارتفاع ضغط");
  if (v.diastolic != null && v.diastolic >= 90) findings.push("ارتفاع ضغط انبساطي");
  if (v.cholesterol != null && v.cholesterol >= 240) findings.push("كوليسترول مرتفع");
  if (v.creatinine != null && v.creatinine >= 1.3) findings.push("كرياتينين مرتفع");
  return findings.length > 0 ? findings.join("، ") : "طبيعي";
}

// ─── Patient PDF Export ──────────────────────────────────────────────────────
export async function exportPatientsPDF() {
  const data = await fetchPatientExportData();
  const doc = new jsPDF("l", "mm", "a4"); // Landscape for wide tables
  const pageWidth = doc.internal.pageSize.getWidth();
  const pageHeight = doc.internal.pageSize.getHeight();

  // Cover page
  const generatedAt = new Date().toLocaleString("ar-EG");
  const coverHtml = `
    <div style="padding: 60px; height: 700px; display: flex; flex-direction: column; justify-content: center; align-items: center; background: linear-gradient(to bottom right, #064e3b, #047857); color: white; text-align: center; font-family: system-ui, sans-serif;">
      <h3 style="font-size: 22px; color: #6ee7b7; margin-bottom: 16px;">وزارة الصحة والسكان</h3>
      <h1 style="font-size: 40px; font-weight: 900; margin: 0;">تقرير بيانات المرضى والزيارات</h1>
      <h2 style="font-size: 26px; font-weight: bold; margin-top: 10px;">مبادرة الأمراض المزمنة — مديرية الصحة بسوهاج</h2>
      <div style="margin-top: 40px; padding: 16px 28px; background: rgba(255,255,255,0.12); border-radius: 14px; display: inline-block;">
        <p style="font-size: 18px; margin: 4px 0;">تاريخ التقرير: ${generatedAt}</p>
        <p style="font-size: 18px; margin: 4px 0;">إجمالي السجلات: ${data.grandTotals.total.toLocaleString("ar-EG")}</p>
        <p style="font-size: 18px; margin: 4px 0;">حالات أول مرة: ${data.grandTotals.new_patients.toLocaleString("ar-EG")} | مترددون: ${data.grandTotals.returning.toLocaleString("ar-EG")} | إحالات: ${data.grandTotals.referred.toLocaleString("ar-EG")}</p>
      </div>
    </div>
  `;
  const coverCanvas = await captureElement(coverHtml, 1100);
  const coverH = (coverCanvas.height * pageWidth) / coverCanvas.width;
  doc.addImage(coverCanvas.toDataURL("image/png"), "PNG", 0, 0, pageWidth, coverH);

  // Per-department pages
  const deptEntries = Object.entries(data.departments);
  for (let di = 0; di < deptEntries.length; di++) {
    const [, dept] = deptEntries[di];
    // Build HTML table for this department
    const rows = dept.records.map((v: any, i: number) => `
      <tr style="background: ${i % 2 === 0 ? "#fff" : "#f8fafc"};">
        <td style="padding:4px 6px; border:1px solid #e2e8f0; font-size:11px;">${i + 1}</td>
        <td style="padding:4px 6px; border:1px solid #e2e8f0; font-size:11px;">${v.patients?.national_id || "—"}</td>
        <td style="padding:4px 6px; border:1px solid #e2e8f0; font-size:11px; font-weight:bold;">${v.patients?.full_name || "—"}</td>
        <td style="padding:4px 6px; border:1px solid #e2e8f0; font-size:11px;">${v.patients?.age ?? "—"}</td>
        <td style="padding:4px 6px; border:1px solid #e2e8f0; font-size:11px;">${v.patients?.gender || "—"}</td>
        <td style="padding:4px 6px; border:1px solid #e2e8f0; font-size:11px;">${v.patients?.phone || "—"}</td>
        <td style="padding:4px 6px; border:1px solid #e2e8f0; font-size:11px;">${formatDate(v.visit_date)}</td>
        <td style="padding:4px 6px; border:1px solid #e2e8f0; font-size:11px;">${v.visit_type || "—"}</td>
        <td style="padding:4px 6px; border:1px solid #e2e8f0; font-size:11px;">${v.health_units?.name || "—"}</td>
        <td style="padding:4px 6px; border:1px solid #e2e8f0; font-size:10px;">${getScreeningSummary(v)}</td>
        <td style="padding:4px 6px; border:1px solid #e2e8f0; font-size:10px;">${getDiagnosis(v)}</td>
        <td style="padding:4px 6px; border:1px solid #e2e8f0; font-size:11px;">${v.referred ? "نعم" : "لا"}</td>
      </tr>
    `).join("");

    const tableHtml = `
      <div style="padding: 16px; font-family: system-ui, sans-serif; direction: rtl;">
        <div style="background: #059669; color: white; padding: 10px 16px; border-radius: 10px 10px 0 0; margin-bottom: 0;">
          <h2 style="font-size: 16px; margin: 0; font-weight: 900;">${dept.department_name}</h2>
          <p style="font-size: 12px; margin: 4px 0 0; opacity: 0.8;">
            إجمالي: ${dept.totals.total} | أول مرة: ${dept.totals.new_patients} | مترددون: ${dept.totals.returning} | إحالات: ${dept.totals.referred}
          </p>
        </div>
        <table style="width: 100%; border-collapse: collapse; direction: rtl;">
          <thead>
            <tr style="background: #065f46; color: white;">
              <th style="padding:5px 6px; border:1px solid #047857; font-size:11px; font-weight:bold; text-align:right;">#</th>
              <th style="padding:5px 6px; border:1px solid #047857; font-size:11px; font-weight:bold; text-align:right;">الرقم القومي</th>
              <th style="padding:5px 6px; border:1px solid #047857; font-size:11px; font-weight:bold; text-align:right;">الاسم</th>
              <th style="padding:5px 6px; border:1px solid #047857; font-size:11px; font-weight:bold; text-align:right;">العمر</th>
              <th style="padding:5px 6px; border:1px solid #047857; font-size:11px; font-weight:bold; text-align:right;">النوع</th>
              <th style="padding:5px 6px; border:1px solid #047857; font-size:11px; font-weight:bold; text-align:right;">الهاتف</th>
              <th style="padding:5px 6px; border:1px solid #047857; font-size:11px; font-weight:bold; text-align:right;">تاريخ الزيارة</th>
              <th style="padding:5px 6px; border:1px solid #047857; font-size:11px; font-weight:bold; text-align:right;">نوع الزيارة</th>
              <th style="padding:5px 6px; border:1px solid #047857; font-size:11px; font-weight:bold; text-align:right;">الوحدة</th>
              <th style="padding:5px 6px; border:1px solid #047857; font-size:11px; font-weight:bold; text-align:right;">الفحوصات</th>
              <th style="padding:5px 6px; border:1px solid #047857; font-size:11px; font-weight:bold; text-align:right;">التشخيص</th>
              <th style="padding:5px 6px; border:1px solid #047857; font-size:11px; font-weight:bold; text-align:right;">إحالة</th>
            </tr>
          </thead>
          <tbody>${rows}</tbody>
        </table>
      </div>
    `;

    const tableCanvas = await captureElement(tableHtml, 1400);
    const margin = 8;
    const imgWidth = pageWidth - 2 * margin;
    const imgHeight = (tableCanvas.height * imgWidth) / tableCanvas.width;
    const imgData = tableCanvas.toDataURL("image/png");

    // Paginate
    let remaining = imgHeight;
    let yOffset = margin;
    doc.addPage();
    doc.addImage(imgData, "PNG", margin, yOffset, imgWidth, imgHeight);
    remaining -= (pageHeight - margin * 2);

    while (remaining > 0) {
      doc.addPage();
      yOffset -= (pageHeight - margin * 2);
      doc.addImage(imgData, "PNG", margin, yOffset, imgWidth, imgHeight);
      remaining -= (pageHeight - margin * 2);
    }
  }

  const filename = `Patient_Report_${new Date().toISOString().slice(0, 16).replace("T", "_").replace(":", "-")}.pdf`;
  doc.save(filename);
}

// ─── Patient Excel Export ────────────────────────────────────────────────────
export async function exportPatientsExcel() {
  const data = await fetchPatientExportData();
  const workbook = new ExcelJS.Workbook();
  workbook.creator = "Ministry of Health";
  workbook.created = new Date();

  const headerStyle: Partial<ExcelJS.Style> = {
    font: { bold: true, color: { argb: "FFFFFFFF" }, size: 11 },
    fill: { type: "pattern", pattern: "solid", fgColor: { argb: "FF059669" } },
    alignment: { horizontal: "right", vertical: "middle", wrapText: true },
    border: {
      top: { style: "thin", color: { argb: "FF047857" } },
      bottom: { style: "thin", color: { argb: "FF047857" } },
      left: { style: "thin", color: { argb: "FF047857" } },
      right: { style: "thin", color: { argb: "FF047857" } },
    },
  };

  // Sheet 1: Summary
  const wsSummary = workbook.addWorksheet("ملخص التقرير", { views: [{ rightToLeft: true }] });
  wsSummary.columns = [{ width: 35 }, { width: 25 }];
  wsSummary.addRow(["تقرير بيانات المرضى والزيارات", ""]);
  wsSummary.getRow(1).font = { bold: true, size: 16, color: { argb: "FF059669" } };
  wsSummary.mergeCells("A1:B1");
  wsSummary.addRow([]);
  wsSummary.addRow(["تاريخ التقرير", new Date().toLocaleString("ar-EG")]);
  wsSummary.addRow(["إجمالي السجلات", data.grandTotals.total]);
  wsSummary.addRow(["حالات أول مرة", data.grandTotals.new_patients]);
  wsSummary.addRow(["حالات مترددة", data.grandTotals.returning]);
  wsSummary.addRow(["حالات إحالة", data.grandTotals.referred]);
  wsSummary.addRow([]);
  wsSummary.addRow(["الإدارة", "عدد السجلات"]);
  wsSummary.getRow(9).font = { bold: true };
  Object.values(data.departments).forEach((dept) => {
    wsSummary.addRow([dept.department_name, dept.totals.total]);
  });

  // Sheet per department
  const columns = [
    { header: "#", key: "index", width: 6 },
    { header: "الرقم القومي", key: "national_id", width: 18 },
    { header: "اسم المريض", key: "full_name", width: 28 },
    { header: "العمر", key: "age", width: 8 },
    { header: "النوع", key: "gender", width: 8 },
    { header: "الهاتف", key: "phone", width: 16 },
    { header: "المحافظة", key: "governorate", width: 14 },
    { header: "تاريخ الزيارة", key: "visit_date", width: 14 },
    { header: "نوع الزيارة", key: "visit_type", width: 12 },
    { header: "الوحدة الصحية", key: "unit_name", width: 28 },
    { header: "السكر", key: "sugar", width: 16 },
    { header: "HbA1c", key: "hba1c", width: 9 },
    { header: "الضغط", key: "bp", width: 12 },
    { header: "الكوليسترول", key: "cholesterol", width: 12 },
    { header: "الكرياتينين", key: "creatinine", width: 12 },
    { header: "التشخيص", key: "diagnosis", width: 24 },
    { header: "إحالة", key: "referred", width: 8 },
    { header: "جهة الإحالة", key: "referral_dest", width: 20 },
    { header: "تاريخ التسجيل", key: "created_at", width: 14 },
  ];

  Object.values(data.departments).forEach((dept) => {
    // Trim sheet name to 31 chars (Excel limit)
    const sheetName = dept.department_name.length > 31
      ? dept.department_name.slice(0, 28) + "..."
      : dept.department_name;
    const ws = workbook.addWorksheet(sheetName, { views: [{ rightToLeft: true }] });
    ws.columns = columns;

    // Style header row
    const headerRow = ws.getRow(1);
    headerRow.eachCell((cell) => {
      cell.style = headerStyle as ExcelJS.Style;
    });
    headerRow.height = 24;

    // Data rows
    dept.records.forEach((v: any, i: number) => {
      const row = ws.addRow({
        index: i + 1,
        national_id: v.patients?.national_id || "—",
        full_name: v.patients?.full_name || "—",
        age: v.patients?.age ?? "—",
        gender: v.patients?.gender || "—",
        phone: v.patients?.phone || "—",
        governorate: v.patients?.governorate || "—",
        visit_date: formatDate(v.visit_date),
        visit_type: v.visit_type || "—",
        unit_name: v.health_units?.name || "—",
        sugar: v.sugar_level != null ? `${v.sugar_level} (${v.sugar_type || ""})` : "—",
        hba1c: v.hba1c ?? "—",
        bp: v.systolic != null ? `${v.systolic}/${v.diastolic}` : "—",
        cholesterol: v.cholesterol ?? "—",
        creatinine: v.creatinine ?? "—",
        diagnosis: getDiagnosis(v),
        referred: v.referred ? "نعم" : "لا",
        referral_dest: v.referral_dest || "—",
        created_at: formatDate(v.created_at),
      });

      // Alternate row shading
      if (i % 2 === 1) {
        row.eachCell((cell) => {
          cell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FFF1F5F9" } };
        });
      }
    });

    // Totals row
    ws.addRow([]);
    const totalsRow = ws.addRow([
      "", "", `إجمالي: ${dept.totals.total}`, "",
      `أول مرة: ${dept.totals.new_patients}`, "",
      `مترددون: ${dept.totals.returning}`, "",
      `إحالات: ${dept.totals.referred}`,
    ]);
    totalsRow.font = { bold: true, color: { argb: "FF059669" } };
  });

  // Download
  const buffer = await workbook.xlsx.writeBuffer();
  const filename = `Patient_Report_${new Date().toISOString().slice(0, 16).replace("T", "_").replace(":", "-")}.xlsx`;
  saveAs(new Blob([buffer]), filename);
}
