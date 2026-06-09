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
