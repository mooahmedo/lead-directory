const fs = require('fs');

const page = fs.readFileSync('app/page.tsx', 'utf8');
const lines = page.split('\n');

// Find the end of `export default function Page()`
let openBraces = 0;
let started = false;
let endLine = -1;
for (let i = 0; i < lines.length; i++) {
  if (lines[i].includes('export default function Page()')) {
    started = true;
  }
  if (started) {
    openBraces += (lines[i].match(/\{/g) || []).length;
    openBraces -= (lines[i].match(/\}/g) || []).length;
    if (openBraces === 0 && lines[i].includes('}')) {
      endLine = i;
      break;
    }
  }
}

console.log('Page ends at line index: ' + endLine);

if (endLine !== -1) {
  // Grab imports (top of file until `export default function Page()`)
  let importsEnd = 0;
  for (let i = 0; i < lines.length; i++) {
    if (lines[i].includes('export default function Page()')) {
      importsEnd = i;
      break;
    }
  }
  
  const imports = lines.slice(0, importsEnd).join('\n');
  
  // Grab the rest of the functions
  let restOfFile = lines.slice(endLine + 1).join('\n');
  
  // Add 'export ' to all 'function ' declarations
  restOfFile = restOfFile.replace(/^function /gm, 'export function ');
  
  // Create MainViews.tsx
  const mainViewsContent = imports + '\n' + restOfFile;
  fs.writeFileSync('components/views/MainViews.tsx', mainViewsContent, 'utf8');
  console.log('MainViews.tsx created!');
  
  // Now modify page.tsx
  // We need to import the functions that page.tsx uses:
  // SystemLogin, ChangePasswordView, VisitsView, PatientsView, DepartmentsUnitsView, UsersView, NurseView (if used directly)
  const pageImports = `
import { SystemLogin, ChangePasswordView, VisitsView, PatientsView, DepartmentsUnitsView, UsersView, NurseView, InfoChip, MeasureInput } from "@/components/views/MainViews";
`;
  
  let newPage = lines.slice(0, endLine + 1).join('\n');
  
  // Insert the pageImports right after the existing imports
  newPage = newPage.replace(/import { SupervisorDashboard }.*?;/, match => match + pageImports);
  
  fs.writeFileSync('app/page.tsx', newPage, 'utf8');
  console.log('page.tsx cleaned up!');
}
