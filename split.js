const fs = require('fs');
const path = require('path');

const pageContent = fs.readFileSync('app/page.tsx', 'utf8');

// Ensure directories exist
['components/auth', 'components/views'].forEach(dir => {
  const fullPath = path.join(__dirname, dir);
  if (!fs.existsSync(fullPath)) {
    fs.mkdirSync(fullPath, { recursive: true });
  }
});

// We'll extract SystemLogin and ChangePasswordView to AuthViews.tsx
const authRegex = /(function SystemLogin[\s\S]*?)(?=\n\/\/ ═|\nfunction VisitsView)/;
const authMatch = pageContent.match(authRegex);

if (authMatch) {
  const authCode = authMatch[1];
  const authFileContent = `"use client";
import { useState } from "react";
import { createClient } from "@/lib/supabase/client";
import { toast } from "sonner";
import { Loader2, Eye, EyeOff } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import type { UserProfile } from "@/lib/types";

${authCode}
`;
  fs.writeFileSync('components/auth/AuthViews.tsx', authFileContent, 'utf8');
  console.log('Extracted AuthViews');
} else {
  console.log('Failed to match Auth views');
}

// Similarly we can extract VisitsView, PatientsView, DepartmentsUnitsView, UsersView, VisitsLog, NurseView into MainViews.tsx
const mainViewsRegex = /(function VisitsView[\s\S]*)/;
const mainMatch = pageContent.match(mainViewsRegex);

if (mainMatch) {
  const mainCode = mainMatch[1];
  const mainFileContent = `"use client";
import { useState, useEffect, useCallback, useRef } from "react";
import { createClient } from "@/lib/supabase/client";
import { parseNationalId, formatBirthDate } from "@/lib/national-id";
import type { Department, HealthUnit, VisitSubmission, UserProfile } from "@/lib/types";
import { toast } from "sonner";
import {
  Heart, Wifi, WifiOff, LogIn, LogOut, ChevronDown, ChevronUp,
  RefreshCw, Search, Users, Activity, Calendar, Building2,
  TrendingUp, AlertCircle, CheckCircle2, XCircle, Loader2,
  ArrowUpRight, Shield, Eye, EyeOff, ClipboardList, Stethoscope,
  FlaskConical, Droplets, Weight, Ruler, Menu, X, Plus, Edit2,
  UserCheck, UserX, FileText, CheckCircle, Info, Download
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Progress } from "@/components/ui/progress";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue
} from "@/components/ui/select";
import {
  Collapsible, CollapsibleContent, CollapsibleTrigger
} from "@/components/ui/collapsible";
import { Switch } from "@/components/ui/switch";
import * as XLSX from "xlsx";

// Shared function needed by views
const resilientFetch = async <T,>(url: string, options?: RequestInit): Promise<T> => {
  let retries = 3;
  while (retries > 0) {
    try {
      const res = await fetch(url, { ...options, cache: "no-store" });
      if (!res.ok) {
        const errData = await res.json().catch(() => ({}));
        throw new Error(errData.error || \`HTTP error \${res.status}\`);
      }
      return await res.json();
    } catch (error) {
      retries--;
      if (retries === 0) throw error;
      await new Promise(r => setTimeout(r, 1000));
    }
  }
  throw new Error("Failed after retries");
};

// Replace queue functions with props or context if needed, but for now we'll mock them or import them if we export them from page.tsx.
// Since NurseView uses them heavily, let's keep them in NurseView or pass as props. 
// Actually, it's better to just leave them in page.tsx for now and only extract AuthViews to reduce complexity, then we'll do the rest safely.
`;
  
  // Let's just write MainViews.tsx with the code
  fs.writeFileSync('components/views/MainViews.tsx', mainFileContent + mainCode, 'utf8');
  console.log('Extracted MainViews');
} else {
  console.log('Failed to match Main views');
}
