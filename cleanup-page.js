const fs = require('fs');

let pageContent = fs.readFileSync('app/page.tsx', 'utf8');

// Replace resilientFetch with import from lib/api
pageContent = pageContent.replace(/const resilientFetch = async[\s\S]*?throw new Error\("Failed after retries"\);\n};/, 
  'import { resilientFetch } from "@/lib/api";');

// Import the components at the top
const imports = `
import { SystemLogin } from "@/components/auth/SystemLogin";
import { ChangePasswordView } from "@/components/auth/ChangePasswordView";
import { VisitsView } from "@/components/views/VisitsView";
import { PatientsView } from "@/components/views/PatientsView";
import { DepartmentsUnitsView } from "@/components/views/DepartmentsUnitsView";
import { UsersView } from "@/components/views/UsersView";
`;

pageContent = pageContent.replace('import { SupervisorDashboard } from "@/components/dashboard/SupervisorDashboard";', 
  `import { SupervisorDashboard } from "@/components/dashboard/SupervisorDashboard";${imports}`);

// Now remove the function bodies
const functionsToRemove = [
  'SystemLogin', 'ChangePasswordView', 'VisitsView', 'VisitsLog', 
  'PatientsView', 'DepartmentsUnitsView', 'UsersView', 'NurseView'
];

functionsToRemove.forEach(funcName => {
  const regex = new RegExp(`(// ═+.*?\\n)?function ${funcName}[\\s\\S]*?\\n}\\n\\n?`, 'g');
  pageContent = pageContent.replace(regex, '');
});

// There is also a trailing NurseView which might not end with \n} but end of file
pageContent = pageContent.replace(/function NurseView[\s\S]*?^}$/m, '');

// Save the cleaned up page.tsx
fs.writeFileSync('app/page.tsx', pageContent, 'utf8');
console.log("Cleaned page.tsx! Size:", pageContent.length);
