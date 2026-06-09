const fs = require('fs');
const iconv = require('iconv-lite');

const content = fs.readFileSync('app/page.tsx', 'utf8');

try {
  // Convert the corrupted string back to bytes using win1256
  // This reverses the action of "editor read UTF-8 as Win1256"
  const originalBytes = iconv.encode(content, 'win1256');
  
  // Now decode those bytes properly as UTF-8
  const fixed = originalBytes.toString('utf8');
  
  if (fixed.includes('تحكم') || fixed.includes('الزيارات')) {
    console.log(`SUCCESS! Root cause identified: UTF-8 file was opened and saved as Windows-1256.`);
    console.log(fixed.substring(fixed.indexOf('الزيارات'), fixed.indexOf('الزيارات') + 50));
    fs.writeFileSync('app/page.tsx', fixed, 'utf8');
    console.log('File app/page.tsx has been successfully repaired and saved.');
  } else {
    console.log('Did not match expected words.');
  }
} catch(e) {
  console.error(e);
}
