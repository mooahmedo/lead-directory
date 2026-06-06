const puppeteer = require('puppeteer');
const fs = require('fs');
const path = require('path');

async function run() {
  console.log("Launching browser...");
  const browser = await puppeteer.launch({
    headless: "new",
    args: ['--no-sandbox', '--disable-setuid-sandbox', '--window-size=1280,800'],
    defaultViewport: { width: 1280, height: 800 }
  });
  const page = await browser.newPage();
  
  // Set default timeout to 15 seconds
  page.setDefaultTimeout(15000);

  try {
    console.log("Navigating to local server...");
    await page.goto('http://localhost:3000', { waitUntil: 'networkidle0' });

    console.log("Logging in...");
    // Type email
    const emailInput = await page.waitForSelector('input[type="email"]');
    await emailInput.type('supervisor_test@test.com');
    
    // Type password
    const pwdInput = await page.waitForSelector('input[type="password"]');
    await pwdInput.type('Password123!');
    
    // Click login button
    const loginBtn = await page.waitForSelector('button.bg-emerald-600.hover\\:bg-emerald-700');
    await loginBtn.click();

    console.log("Waiting for dashboard to load...");
    // Wait for the "لوحة التحكم" header
    await page.waitForFunction(() => {
      return document.body.innerText.includes('تسجيل الخروج');
    }, { timeout: 15000 });
    
    // Add a small delay for things to stabilize
    await new Promise(r => setTimeout(r, 2000));

    const screenshots = [];

    async function takeScreenshot(name, selectorText) {
      console.log(`Taking screenshot: ${name}`);
      const clicked = await page.evaluate((text) => {
        const buttons = Array.from(document.querySelectorAll('button'));
        const target = buttons.find(b => b.innerText.includes(text));
        if (target) {
          target.click();
          return true;
        }
        return false;
      }, selectorText);

      if (clicked) {
        await new Promise(r => setTimeout(r, 2000)); // wait for network requests and rendering
        const filename = `${name}.png`;
        const filepath = path.join(__dirname, filename);
        await page.screenshot({ path: filepath, fullPage: true });
        screenshots.push({ name, filepath, label: selectorText });
      } else {
        console.log(`Could not find sidebar item for: ${selectorText}`);
      }
    }

    await takeScreenshot('dashboard', 'لوحة التحكم');
    await takeScreenshot('visits', 'تسجيل الزيارات');
    await takeScreenshot('patients', 'قائمة المرضى');
    await takeScreenshot('departments', 'الإدارات والوحدات');
    await takeScreenshot('users', 'المستخدمين');

    console.log("Generating HTML for PDF...");
    let htmlContent = `
      <html>
        <head>
          <meta charset="utf-8">
          <style>
            body { font-family: 'Segoe UI', Tahoma, Geneva, Verdana, sans-serif; direction: rtl; padding: 40px; color: #1f2937; }
            h1 { color: #059669; text-align: center; margin-bottom: 50px; font-size: 32px; }
            .section { margin-bottom: 60px; page-break-after: always; }
            h2 { color: #047857; border-bottom: 2px solid #34d399; padding-bottom: 10px; margin-bottom: 20px; font-size: 24px; }
            p { font-size: 16px; line-height: 1.6; margin-bottom: 20px; }
            img { max-width: 100%; border: 1px solid #e5e7eb; border-radius: 8px; box-shadow: 0 4px 6px -1px rgba(0, 0, 0, 0.1); }
          </style>
        </head>
        <body>
          <h1>دليل استخدام لوحة تحكم المشرف - مبادرة الأمراض المزمنة</h1>
          <p style="text-align: center; font-size: 18px;">نظرة عامة على صلاحيات مشرف المبادرة والميزات المتاحة بالنظام.</p>
    `;

    const descriptions = {
      'لوحة التحكم': 'تتيح لوحة التحكم للمشرف عرض إحصائيات عامة عن المبادرة، ومتابعة الأداء بشكل شامل وسريع.',
      'تسجيل الزيارات': 'يمكن للمشرف من خلال هذه الواجهة متابعة سجل الزيارات اليومي وتسجيل زيارات جديدة، بالإضافة إلى إمكانية البحث وتصفية البيانات بالإدارة والوحدة وتصديرها بصيغة إكسيل.',
      'قائمة المرضى': 'عرض قائمة شاملة لجميع المرضى المسجلين بالمبادرة والبحث بالرقم القومي أو الاسم وتفاصيلهم.',
      'الإدارات والوحدات': 'إدارة هيكل النظام الصحي من خلال إضافة وتعديل وحذف الإدارات الصحية والوحدات التابعة لها وتعيين الأهداف.',
      'المستخدمين': 'إنشاء وإدارة حسابات المستخدمين (تمريض، مشرفين)، وتعيين صلاحياتهم وربطهم بالوحدات الصحية وتفعيل/إيقاف الحسابات.'
    };

    for (const img of screenshots) {
      const imgBase64 = fs.readFileSync(img.filepath).toString('base64');
      const imgSrc = `data:image/png;base64,${imgBase64}`;
      htmlContent += `
        <div class="section">
          <h2>${img.label}</h2>
          <p>${descriptions[img.label]}</p>
          <img src="${imgSrc}" />
        </div>
      `;
    }

    htmlContent += `
        </body>
      </html>
    `;

    console.log("Printing to PDF...");
    const pdfPage = await browser.newPage();
    await pdfPage.setContent(htmlContent, { waitUntil: 'networkidle0' });
    const pdfPath = path.join(__dirname, 'Supervisor_Features_Guide.pdf');
    await pdfPage.pdf({ path: pdfPath, format: 'A4', printBackground: true });

    console.log(`PDF generated successfully at: ${pdfPath}`);
    
    // Cleanup images
    for (const img of screenshots) {
      try {
        fs.unlinkSync(img.filepath);
      } catch (e) {}
    }

  } catch (err) {
    console.error("Error generating PDF:", err);
  } finally {
    await browser.close();
  }
}

run();
