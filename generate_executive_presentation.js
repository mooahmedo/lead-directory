const puppeteer = require('puppeteer');
const fs = require('fs');
const path = require('path');

const ACCOUNTS = [
  { role: 'supervisor', username: 'sup_final', password: 'Password123!' },
  { role: 'coordinator', username: 'coord_01', password: 'Temp@sbedjn' },
  { role: 'nurse', username: 'nurse_001', password: 'Temp@v13naw' }
];

async function run() {
  console.log("Launching browser...");
  const browser = await puppeteer.launch({
    headless: "new",
    args: ['--no-sandbox', '--disable-setuid-sandbox', '--window-size=1280,1024'],
    defaultViewport: { width: 1280, height: 1024 }
  });
  
  const screenshots = {};
  
  for (const account of ACCOUNTS) {
    console.log(`\n--- Starting session for role: ${account.role} ---`);
    const context = await browser.createBrowserContext();
    const page = await context.newPage();
    page.setDefaultTimeout(60000);
    
    try {
      console.log(`Navigating to local server...`);
      await page.goto('http://localhost:3000', { waitUntil: 'networkidle0' });

      console.log(`Logging in as ${account.username}...`);
      const emailInput = await page.waitForSelector('input[type="text"]');
      await emailInput.type(account.username);
      
      const pwdInput = await page.waitForSelector('input[type="password"]');
      await pwdInput.type(account.password);
      await pwdInput.press('Enter');

      // Smart wait for loading state to vanish
      const waitForDataLoad = async () => {
        try {
          await page.waitForFunction(() => {
            const spinners = document.querySelectorAll('.animate-spin, .loader');
            if (spinners.length > 0) return false;
            const text = document.body.innerText;
            if (text.includes('جاري') || text.includes('جارٍ') || text.includes('Loading')) return false;
            // Wait for tables to not have skeleton rows
            const skeletons = document.querySelectorAll('.animate-pulse');
            if (skeletons.length > 0) return false;
            return true;
          }, { timeout: 30000 });
          await new Promise(r => setTimeout(r, 2000)); // Buffer for rendering
        } catch (e) {
          console.log("Timeout waiting for loaders to vanish, proceeding anyway...");
        }
      };

      console.log("Waiting for dashboard/home to load...");
      await waitForDataLoad();

      // Inject custom CSS for highlighting
      await page.evaluate(() => {
        const style = document.createElement('style');
        style.innerHTML = `
          .highlight-callout {
            position: relative;
            z-index: 50;
            box-shadow: 0 0 0 4px #f59e0b, 0 0 15px rgba(245, 158, 11, 0.6) !important;
            border-radius: inherit;
          }
          .highlight-callout::before {
            content: "ميزة هامة";
            position: absolute;
            top: -24px;
            right: 0;
            background: #f59e0b;
            color: #fff;
            padding: 2px 8px;
            font-size: 12px;
            font-weight: bold;
            border-radius: 4px;
            z-index: 100;
            white-space: nowrap;
          }
        `;
        document.head.appendChild(style);
      });

      const takeScreenshot = async (name, selectorText, highlightSelector = null) => {
        console.log(`Taking screenshot: ${account.role}_${name}`);
        
        if (selectorText) {
          const clicked = await page.evaluate((text) => {
            const spans = Array.from(document.querySelectorAll('nav span'));
            const target = spans.find(s => s.textContent && s.textContent.trim() === text.trim());
            if (target) {
              const btn = target.closest('button, a');
              if (btn) {
                btn.click();
                return true;
              }
            }
            return false;
          }, selectorText);
          
          if (!clicked) {
            console.log(`Could not find sidebar item for: ${selectorText} (Role: ${account.role})`);
            return;
          }
        }
        
        await waitForDataLoad();

        if (highlightSelector) {
          await page.evaluate((sel) => {
            const el = document.querySelector(sel);
            if (el) el.classList.add('highlight-callout');
          }, highlightSelector);
          await new Promise(r => setTimeout(r, 500));
        }

        const filename = `${account.role}_${name}.png`;
        const filepath = path.join(__dirname, filename);
        await page.screenshot({ path: filepath, fullPage: true });
        screenshots[`${account.role}_${name}`] = filepath;

        // Remove highlight for next screens
        if (highlightSelector) {
          await page.evaluate((sel) => {
            const el = document.querySelector(sel);
            if (el) el.classList.remove('highlight-callout');
          }, highlightSelector);
        }
      };

      if (account.role === 'supervisor') {
        await takeScreenshot('dashboard', 'لوحة التحكم', '.grid'); 
        await takeScreenshot('visits', 'تسجيل الزيارات', 'table');
        await takeScreenshot('patients', 'قائمة المرضى', 'table');
        await takeScreenshot('departments', 'الإدارات والوحدات');
        await takeScreenshot('users', 'المستخدمين', 'table');
      } else if (account.role === 'coordinator') {
        await takeScreenshot('dashboard', 'لوحة التحكم');
        await takeScreenshot('visits', 'تسجيل الزيارات');
        await takeScreenshot('departments', 'الإدارات والوحدات');
      } else if (account.role === 'nurse') {
        // Nurse lands on visits by default, just take a screenshot
        await takeScreenshot('visits_form', null, 'form, .bg-white');
      }

      // Logout
      await page.evaluate(() => {
        const buttons = Array.from(document.querySelectorAll('button'));
        const target = buttons.find(b => b.innerText && b.innerText.includes('تسجيل الخروج'));
        if (target) target.click();
      });
      await new Promise(r => setTimeout(r, 2000));

    } catch (err) {
      console.error(`Error during ${account.role} session:`, err);
    } finally {
      await page.close();
      await context.close();
    }
  }

  console.log("\nGenerating Arabic HTML for PDF...");
  const dateStr = new Date().toLocaleDateString('ar-EG', { year: 'numeric', month: 'long', day: 'numeric' });
  
  const getBase64Image = (id) => {
    const filepath = screenshots[id];
    if (!filepath || !fs.existsSync(filepath)) return '';
    const base64 = fs.readFileSync(filepath).toString('base64');
    return `data:image/png;base64,${base64}`;
  };

  const imgHtml = (id, caption, description) => {
    const src = getBase64Image(id);
    if (!src) return `<div style="padding: 20px; background: #fee2e2; color: #991b1b; text-align: center;">الصورة غير متوفرة: ${id}</div>`;
    return `
      <div class="screenshot-container">
        <img src="${src}" alt="${caption}" />
        <div class="caption">${caption}</div>
        ${description ? `<div class="img-desc">${description}</div>` : ''}
      </div>
    `;
  };

  let htmlContent = `
    <!DOCTYPE html>
    <html lang="ar" dir="rtl">
    <head>
      <meta charset="utf-8">
      <style>
        @import url('https://fonts.googleapis.com/css2?family=Cairo:wght@300;400;600;700;800&display=swap');
        
        body { 
          font-family: 'Cairo', sans-serif; 
          margin: 0; 
          padding: 0; 
          color: #1f2937; 
          background: #ffffff;
        }
        .page {
          page-break-after: always;
          padding: 50px 60px;
          min-height: 100vh;
          box-sizing: border-box;
          position: relative;
        }
        .cover-page {
          display: flex;
          flex-direction: column;
          justify-content: center;
          align-items: center;
          text-align: center;
          background: linear-gradient(135deg, #f0fdf4 0%, #dcfce7 100%);
          border: 1px solid #e5e7eb;
        }
        .cover-title { font-size: 52px; font-weight: 800; color: #065f46; margin-bottom: 20px; }
        .cover-subtitle { font-size: 32px; font-weight: 600; color: #047857; margin-bottom: 40px; }
        .cover-date { font-size: 18px; color: #4b5563; margin-top: auto; padding-top: 60px; }
        
        h1.section-title {
          font-size: 38px;
          color: #064e3b;
          border-bottom: 4px solid #10b981;
          padding-bottom: 15px;
          margin-bottom: 30px;
          font-weight: 800;
        }
        h2 { font-size: 26px; color: #047857; margin-top: 30px; font-weight: 700; }
        h3 { font-size: 22px; color: #065f46; font-weight: 700; }
        p, li { font-size: 18px; line-height: 1.8; color: #374151; }
        
        .toc-list { list-style: none; padding: 0; }
        .toc-list li { margin-bottom: 15px; font-size: 22px; font-weight: 600; color: #059669; }
        .toc-list li a { text-decoration: none; color: inherit; }
        
        .highlight-box {
          background: #ecfdf5;
          border-right: 6px solid #10b981;
          padding: 25px;
          margin: 25px 0;
          border-radius: 8px;
          box-shadow: 0 4px 6px -1px rgba(0, 0, 0, 0.05);
        }
        
        .screenshot-container {
          margin: 40px 0;
          text-align: center;
          box-shadow: 0 10px 25px -5px rgba(0, 0, 0, 0.1), 0 8px 10px -6px rgba(0, 0, 0, 0.1);
          border-radius: 12px;
          overflow: hidden;
          border: 1px solid #e5e7eb;
          background: #f9fafb;
        }
        .screenshot-container img {
          width: 100%;
          height: auto;
          display: block;
        }
        .caption {
          background: #f3f4f6;
          padding: 15px;
          font-size: 16px;
          font-weight: 700;
          color: #1f2937;
          border-top: 1px solid #e5e7eb;
        }
        .img-desc {
          padding: 15px 25px 25px;
          font-size: 16px;
          color: #4b5563;
          text-align: right;
          line-height: 1.6;
        }
        
        table.matrix {
          width: 100%;
          border-collapse: collapse;
          margin: 30px 0;
          font-size: 16px;
        }
        table.matrix th, table.matrix td {
          border: 1px solid #e5e7eb;
          padding: 15px;
          text-align: center;
        }
        table.matrix th {
          background: #10b981;
          color: white;
          font-weight: 700;
        }
        table.matrix th:first-child { text-align: right; }
        table.matrix td:first-child { text-align: right; font-weight: 600; background: #f9fafb; }
        
        .check { color: #059669; font-weight: bold; font-size: 20px; }
        .cross { color: #dc2626; font-weight: bold; font-size: 20px; }
        .limited { color: #d97706; font-weight: bold; font-size: 16px; }

      </style>
    </head>
    <body>

      <!-- 1. Cover Page -->
      <div class="page cover-page">
        <div>
          <div class="cover-title">مبادرة الأمراض المزمنة</div>
          <div class="cover-subtitle">تقرير التقييم الشامل للإدارة العليا</div>
          <div style="width: 150px; height: 6px; background: #10b981; margin: 0 auto 30px; border-radius: 3px;"></div>
          <p style="font-size: 24px; color: #374151; max-width: 700px; margin: 0 auto;">
            استعراض شامل لميزات النظام، لوحات المعلومات، وهيكل الصلاحيات التنظيمية.
          </p>
        </div>
        <div class="cover-date">تاريخ التقرير: ${dateStr}</div>
      </div>

      <!-- Table of Contents -->
      <div class="page" id="toc">
        <h1 class="section-title">1. جدول المحتويات</h1>
        <ul class="toc-list">
          <li><a href="#summary">2. الملخص التنفيذي</a></li>
          <li><a href="#overview">3. نظرة عامة على النظام</a></li>
          <li><a href="#modules">4. نظرة عامة على الوحدات والميزات</a></li>
          <li><a href="#walkthrough">5. استعراض مفصل للميزات</a></li>
          <li><a href="#dashboards">6. لوحات المعلومات والتقارير</a></li>
          <li><a href="#roles">7. هيكل أدوار المستخدمين والصلاحيات</a></li>
          <li><a href="#directorate">8. استعراض واجهة مستوى المديرية (المشرف)</a></li>
          <li><a href="#administration">9. استعراض واجهة مستوى الإدارة (المنسق)</a></li>
          <li><a href="#unit">10. استعراض واجهة مستوى الوحدة (التمريض)</a></li>
          <li><a href="#matrix">11. مصفوفة مقارنة الصلاحيات</a></li>
          <li><a href="#value">12. القيمة التجارية والفوائد التشغيلية</a></li>
          <li><a href="#strengths">13. نقاط القوة الرئيسية في النظام</a></li>
          <li><a href="#challenges">14. الملاحظات الحالية وفرص التحسين</a></li>
          <li><a href="#conclusion">15. الخاتمة والتقييم العام</a></li>
        </ul>
      </div>

      <!-- 2. Executive Summary -->
      <div class="page" id="summary">
        <h1 class="section-title">2. الملخص التنفيذي</h1>
        <div class="highlight-box">
          <p>يهدف هذا التقرير إلى تقديم استعراض شامل لحالة منصة "مبادرة الأمراض المزمنة" الحالية، مع تسليط الضوء على الميزات المتاحة والمستوى المتقدم من الجاهزية التشغيلية.</p>
        </div>
        <p>تم تصميم النظام ليكون الحل المركزي لإدارة مبادرة الأمراض المزمنة بمديرية الصحة، حيث يوفر رقمنة كاملة لتدفق العمل بدءاً من تسجيل المريض في الوحدة الصحية وحتى استخراج التقارير والتحليلات البيانية للإدارة العليا.</p>
        <p>من أبرز النجاحات المحققة في المنصة هو تطبيق نظام الصلاحيات المبني على الأدوار (RBAC) بدقة، والذي يضمن حصول كل مستوى تنظيمي (المديرية، الإدارة، الوحدة) على الأدوات والبيانات المناسبة لمهامهم مع الحفاظ الكامل على خصوصية بيانات المرضى وسريتها.</p>
      </div>

      <!-- 3 & 4 System Overview -->
      <div class="page" id="overview">
        <h1 class="section-title">3. نظرة عامة على النظام</h1>
        <p>النظام عبارة عن تطبيق ويب تفاعلي وحديث، تم بناؤه باستخدام أحدث تقنيات الويب لضمان السرعة والتوافق مع جميع الأجهزة. يتميز التطبيق بالقدرة على العمل في حالة عدم استقرار شبكة الإنترنت (Offline Support)، مما يجعله مثالياً للعمل الميداني في الوحدات الصحية الطرفية.</p>
        
        <h1 class="section-title" id="modules" style="margin-top: 50px;">4. نظرة عامة على الوحدات والميزات</h1>
        <ul>
          <li><strong>لوحات تحكم تحليلية:</strong> لعرض المؤشرات الرئيسية (KPIs) بشكل فوري.</li>
          <li><strong>سجل الزيارات اليومي:</strong> لتتبع وتسجيل الفحوصات اليومية (الضغط، السكر، الوزن) بدقة.</li>
          <li><strong>سجل المرضى الشامل:</strong> قاعدة بيانات مركزية للمرضى مع إمكانية البحث المتقدم بالرقم القومي.</li>
          <li><strong>إدارة الهيكل الإداري:</strong> لإضافة وتعديل الإدارات الصحية والوحدات التابعة لها وضبط المستهدفات.</li>
          <li><strong>إدارة المستخدمين:</strong> التحكم الكامل في حسابات التمريض والمنسقين وإيقاف وتفعيل الحسابات مركزياً.</li>
        </ul>
      </div>

      <!-- 5 & 6 Dashboards -->
      <div class="page" id="walkthrough">
        <h1 class="section-title">5. استعراض مفصل للميزات</h1>
        <h2 id="dashboards">6. لوحات المعلومات والتقارير</h2>
        <p>تعتبر لوحة التحكم المركزية هي شاشة القيادة للإدارة العليا (المديرية). تتيح هذه الواجهة رؤية فورية لأداء المبادرة على مستوى المحافظة.</p>
        ${imgHtml('supervisor_dashboard', 'لوحة التحكم لمستوى المديرية (المشرف العام)', 'توضح الصورة لوحة المعلومات التفاعلية، تعرض المؤشرات الحيوية مثل إجمالي المرضى، والزيارات اليومية، وتفاعل الوحدات الصحية، مع رسوم بيانية توضح التقدم نحو المستهدفات.')}
        <div class="highlight-box">
          <strong>الفوائد التشغيلية:</strong> توفير رؤى فورية تساهم في اتخاذ قرارات سريعة وتوجيه الدعم للوحدات التي تواجه كثافة في العمل أو قصور في تحقيق المستهدفات.
        </div>
      </div>

      <!-- 7. User Roles -->
      <div class="page" id="roles">
        <h1 class="section-title">7. هيكل أدوار المستخدمين والصلاحيات</h1>
        <p>يعتمد النظام على هيكل تنظيم ثلاثي المستويات يضمن الحوكمة الإدارية وأمن البيانات:</p>
        <ul>
          <li><strong>مستوى المديرية (المشرف العام):</strong> له صلاحيات مطلقة لعرض بيانات المحافظة بالكامل، إدارة جميع الحسابات، وتعديل الهيكل التنظيمي (الإدارات والوحدات).</li>
          <li><strong>مستوى الإدارة (المنسق):</strong> صلاحيات مخصصة تقتصر على الإدارة الجغرافية التابع لها. يمكنه رؤية إحصائيات إدارة محددة فقط ومتابعة أداء وحداتها.</li>
          <li><strong>مستوى الوحدة (التمريض):</strong> صلاحيات إدخال البيانات فقط. يقتصر الوصول على تسجيل الزيارات للمرضى في الوحدة الصحية المخصصة دون القدرة على رؤية تقارير عامة.</li>
        </ul>
      </div>

      <!-- 8. Directorate -->
      <div class="page" id="directorate">
        <h1 class="section-title">8. استعراض واجهة مستوى المديرية (المشرف)</h1>
        <p>هذا المستوى مصمم للإدارة العليا. بالإضافة للوحة التحكم، يمتلك المشرف صلاحيات إدارة المستخدمين وسجل المرضى الشامل.</p>
        ${imgHtml('supervisor_users', 'واجهة إدارة المستخدمين والصلاحيات', 'شاشة تتيح للمشرف العام إنشاء حسابات جديدة وتعيين أدوارها (منسق، ممرض) وتخصيص الوحدات، مع القدرة على إيقاف الحسابات للحفاظ على أمن النظام.')}
        ${imgHtml('supervisor_patients', 'قاعدة بيانات المرضى الشاملة', 'سجل شامل يعرض كافة المرضى المسجلين بالمبادرة، ويتيح البحث بالرقم القومي مع إظهار تفاصيل الزيارات التاريخية لضمان استمرارية الرعاية.')}
      </div>

      <!-- 9. Administration -->
      <div class="page" id="administration">
        <h1 class="section-title">9. استعراض واجهة مستوى الإدارة (المنسق)</h1>
        <p>المنسق يرى نسخة مخصصة من النظام تقتصر على نطاقه الإداري. لا تظهر له شاشات (إدارة المستخدمين) أو (قاعدة بيانات المرضى الشاملة).</p>
        ${imgHtml('coordinator_visits', 'سجل الزيارات اليومية - مستوى الإدارة', 'شاشة تتبع الزيارات اليومية الخاصة بوحدات الإدارة فقط. تتيح للمنسق متابعة أداء التمريض وتصدير البيانات إلى جداول إكسيل للتحليل.')}
        ${imgHtml('coordinator_departments', 'إدارة الوحدات التابعة', 'تسمح للمنسق بالاطلاع على الوحدات التابعة لإدارته وإدارة مستهدفاتها دون إمكانية تعديل إدارات أخرى.')}
      </div>

      <!-- 10. Unit Level -->
      <div class="page" id="unit">
        <h1 class="section-title">10. استعراض واجهة مستوى الوحدة (التمريض)</h1>
        <p>تم تصميم واجهة التمريض لتكون سريعة وسهلة الاستخدام للعمل الميداني. الواجهة تركز حصرياً على استقبال البيانات وضمان دقتها.</p>
        ${imgHtml('nurse_visits_form', 'نموذج تسجيل الزيارات والفحوصات', 'نموذج ذكي لجمع بيانات المرضى والفحوصات الحيوية (الضغط، السكر، الوزن). يحتوي على آليات للتحقق من صحة الرقم القومي تلقائياً ويعمل حتى عند انقطاع الإنترنت.')}
      </div>

      <!-- 11. Matrix -->
      <div class="page" id="matrix">
        <h1 class="section-title">11. مصفوفة مقارنة الصلاحيات</h1>
        <p>يوضح الجدول التالي توزيع الصلاحيات والميزات بناءً على الدور التنظيمي في النظام، مما يثبت التزام النظام بأعلى معايير الحوكمة والفصل بين المهام:</p>
        
        <table class="matrix">
          <thead>
            <tr>
              <th>الميزة / الصلاحية</th>
              <th>المديرية (المشرف)</th>
              <th>الإدارة (المنسق)</th>
              <th>الوحدة (التمريض)</th>
            </tr>
          </thead>
          <tbody>
            <tr>
              <td>الوصول للوحة التحكم المركزية</td>
              <td><span class="check">✓</span> (كل المحافظة)</td>
              <td><span class="check">✓</span> (إدارته فقط)</td>
              <td><span class="cross">✗</span></td>
            </tr>
            <tr>
              <td>استعراض تقارير الزيارات</td>
              <td><span class="check">✓</span> (شامل)</td>
              <td><span class="check">✓</span> (محدود)</td>
              <td><span class="cross">✗</span></td>
            </tr>
            <tr>
              <td>قاعدة بيانات المرضى الكاملة</td>
              <td><span class="check">✓</span></td>
              <td><span class="cross">✗</span></td>
              <td><span class="cross">✗</span></td>
            </tr>
            <tr>
              <td>إضافة وتعديل المستخدمين</td>
              <td><span class="check">✓</span></td>
              <td><span class="cross">✗</span></td>
              <td><span class="cross">✗</span></td>
            </tr>
            <tr>
              <td>إدارة الهيكل (الإدارات والوحدات)</td>
              <td><span class="check">✓</span></td>
              <td><span class="limited">قراءة وتعديل محدود</span></td>
              <td><span class="cross">✗</span></td>
            </tr>
            <tr>
              <td>إدخال زيارات وبيانات مرضى جدد</td>
              <td><span class="check">✓</span> (لأي وحدة)</td>
              <td><span class="cross">✗</span> (للمتابعة فقط)</td>
              <td><span class="check">✓</span> (لوحدته فقط)</td>
            </tr>
          </tbody>
        </table>
      </div>

      <!-- 12 & 13 Value & Strengths -->
      <div class="page" id="value">
        <h1 class="section-title">12. القيمة التجارية والفوائد التشغيلية</h1>
        <p>يقدم النظام قيمة فورية ملموسة تتمثل في إلغاء الدورة الورقية البطيئة واستبدالها بنظام تدفق بيانات فوري. يسمح ذلك بتوفير مئات الساعات المهدرة في تجميع الإحصائيات اليدوية، ويقلل نسبة الخطأ البشري في إدخال الأرقام القومية والفحوصات.</p>

        <h1 class="section-title" id="strengths" style="margin-top: 50px;">13. نقاط القوة الرئيسية في النظام</h1>
        <div class="highlight-box">
          <ul>
            <li style="margin-bottom: 10px;"><strong>التصميم البديهي والموجه:</strong> واجهة مستخدم باللغة العربية البسيطة مما يقلل من منحنى التعلم المطلوب لفرق التمريض.</li>
            <li style="margin-bottom: 10px;"><strong>العمل بدون إنترنت (Offline Mode):</strong> الميزة الأقوى التي تسمح للوحدات الصحية النائية بمواصلة العمل وتخزين الزيارات ثم مزامنتها لاحقاً بشكل تلقائي.</li>
            <li style="margin-bottom: 10px;"><strong>أمن البيانات (RLS):</strong> تأمين البيانات على مستوى قاعدة البيانات بحيث يستحيل برمجياً لأي مستخدم الاطلاع على بيانات خارج نطاق صلاحياته.</li>
            <li><strong>التقارير الحية:</strong> القدرة على تصدير بيانات الزيارات بصيغة إكسيل بضغطة زر واحدة بمرونة فائقة حسب التصفية المحددة.</li>
          </ul>
        </div>
      </div>

      <!-- 14. Challenges -->
      <div class="page" id="challenges">
        <h1 class="section-title">14. الملاحظات الحالية وفرص التحسين</h1>
        <p>بناءً على الفحص الشامل للنظام في نسخته الحالية، تم رصد بعض الملاحظات التي تمثل فرصاً لتطوير النظام مستقبلاً:</p>
        <ul>
          <li><strong>إدارة المرضى للمنسقين:</strong> المنسق حالياً لا يمكنه البحث عن سجل تاريخي لمريض بعينه ضمن إدارته بسبب حجب شاشة "قائمة المرضى" عنه بالكامل. يفضل إتاحة نسخة مبسطة له.</li>
          <li><strong>سجل التدقيق (Audit Logs):</strong> الواجهة الرسومية لسجل التغييرات وتتبع نشاط المستخدمين غير مكتملة وظيفياً وتتطلب تطوير واجهة خاصة للمشرف لعرض من قام بتعديل أو مسح بيانات.</li>
          <li><strong>المؤشرات التحليلية المتقدمة:</strong> لوحة التحكم تعرض إحصائيات عامة ممتازة، ولكن يمكن إضافة رسوم بيانية تفصيلية لمقارنة الأداء بين الإدارات في شاشة واحدة (Leaderboard).</li>
        </ul>
      </div>

      <!-- 15. Conclusion -->
      <div class="page" id="conclusion">
        <h1 class="section-title">15. الخاتمة والتقييم العام</h1>
        <p>النظام في نسخته الحالية يتمتع بموثوقية عالية وتصميم معماري قوي، وهو جاهز بنسبة ممتازة لتلبية المتطلبات التشغيلية الفورية لمبادرة الأمراض المزمنة. إمكانيات عزل البيانات والصلاحيات تعمل بكفاءة مطلقة، وميزة العمل دون اتصال توفر حلاً جذرياً لمشكلات البنية التحتية في الوحدات الصحية الطرفية.</p>
        <p>المنصة تمثل نقلة نوعية في أسلوب الإدارة الصحية المركزية، ونوصي بالانتقال لمرحلة الإطلاق التجريبي (Pilot) في عدد محدود من الإدارات لجمع التغذية الراجعة من المستخدمين الفعليين بالتوازي مع معالجة فرص التحسين المذكورة.</p>
        
        <div style="text-align: center; margin-top: 100px; padding: 40px; background: #f8fafc; border: 1px solid #e2e8f0; border-radius: 12px;">
          <h2 style="margin: 0; color: #065f46;">نهاية التقرير</h2>
          <p style="margin-top: 10px; color: #64748b; font-size: 16px;">تم الإعداد آلياً — قسم التقييم التقني وتحليل النظم</p>
        </div>
      </div>

    </body>
    </html>
  `;

  console.log("Printing to PDF...");
  const pdfPage = await browser.newPage();
  await pdfPage.setContent(htmlContent, { waitUntil: 'networkidle0' });
  
  const pdfPath = path.join(__dirname, 'Executive_Report_AR.pdf');
  await pdfPage.pdf({ 
    path: pdfPath, 
    format: 'A4', 
    printBackground: true,
    margin: { top: '0', right: '0', bottom: '0', left: '0' }
  });

  console.log(`PDF generated successfully at: ${pdfPath}`);
  
  // Cleanup images
  for (const imgPath of Object.values(screenshots)) {
    try {
      if(fs.existsSync(imgPath)) fs.unlinkSync(imgPath);
    } catch (e) {
      console.warn('Could not delete image:', e);
    }
  }

}

run().catch(console.error);
