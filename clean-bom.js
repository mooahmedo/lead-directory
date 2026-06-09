const fs = require('fs');

const filesToClean = [
  'app/page.tsx',
  'components/views/MainViews.tsx',
  'components/dashboard/SupervisorDashboard.tsx',
  'components/auth/AuthViews.tsx'
];

filesToClean.forEach(file => {
  if (fs.existsSync(file)) {
    let content = fs.readFileSync(file, 'utf8');
    
    // Check if the file contains "use client"
    const useClientIndex = content.indexOf('"use client"');
    if (useClientIndex !== -1) {
      // Remove everything before "use client" (including BOM, whitespaces, ?, etc)
      content = content.substring(useClientIndex);
      
      // Save it strictly as utf8 (without BOM by default in Node fs.writeFileSync)
      fs.writeFileSync(file, content, 'utf8');
      console.log(`Cleaned up: ${file}`);
    } else {
      console.log(`No "use client" found in ${file}. Cleaning BOM if exists...`);
      // Strip any leading non-ascii or non-printable before the first valid character
      let startIdx = 0;
      for (let i = 0; i < content.length; i++) {
        const code = content.charCodeAt(i);
        // If it's a visible ascii char or a standard whitespace
        if ((code >= 32 && code <= 126) || code === 10 || code === 13 || code === 9) {
          startIdx = i;
          break;
        }
      }
      content = content.substring(startIdx);
      fs.writeFileSync(file, content, 'utf8');
      console.log(`Cleaned up BOM for: ${file}`);
    }
  }
});
