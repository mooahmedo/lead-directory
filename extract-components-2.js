const fs = require('fs');

const pageContent = fs.readFileSync('app/page.tsx', 'utf8');

let match = pageContent.match(/(function PatientsView[\s\S]*?\n})\n\n/);
if(match) fs.writeFileSync('components/views/PatientsView.tsx', `"use client";
import { useState, useEffect, useCallback } from "react";
import { toast } from "sonner";
import { Search, Loader2, Users } from "lucide-react";
import { Input } from "@/components/ui/input";
import { resilientFetch } from "@/lib/api";

export ` + match[1]);

// For VisitsView, we need VisitsView, VisitsLog, and NurseView.
// Because NurseView is very large, maybe we just bundle them into components/views/VisitsView.tsx.
match = pageContent.match(/(function VisitsView[\s\S]*?\n})\n\n/);
let matchLog = pageContent.match(/(function VisitsLog[\s\S]*?\n})\n\n/);
let matchNurse = pageContent.match(/(function NurseView[\s\S]*?\n})\n\n(?=\/\/ ═|$)/);

if(match && matchLog && matchNurse) {
  fs.writeFileSync('components/views/VisitsView.tsx', `"use client";
import { useState, useEffect, useCallback, useRef } from "react";
import { toast } from "sonner";
import { 
  ClipboardList, Search, Loader2, FileText, CheckCircle, Info, Download, Heart, ArrowUpRight, ArrowDownRight, Activity, X
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { parseNationalId, formatBirthDate } from "@/lib/national-id";
import { resilientFetch } from "@/lib/api";
import type { UserProfile, Department, HealthUnit, VisitSubmission } from "@/lib/types";
import * as XLSX from "xlsx";

// Shared queue functions
const QUEUE_KEY = "offline_visits_queue";
const loadQueue = (): any[] => {
  if (typeof window === "undefined") return [];
  try { return JSON.parse(localStorage.getItem(QUEUE_KEY) || "[]"); } catch { return []; }
};
const saveQueue = (queue: any[]) => {
  if (typeof window === "undefined") return;
  localStorage.setItem(QUEUE_KEY, JSON.stringify(queue));
};
const addToQueue = (visit: any) => {
  const q = loadQueue();
  q.push({ ...visit, _id: crypto.randomUUID(), queuedAt: new Date().toISOString() });
  saveQueue(q);
};
const removeFromQueue = (id: string) => {
  saveQueue(loadQueue().filter(item => item._id !== id));
};

export ` + match[1] + "\n\nexport " + matchLog[1] + "\n\nexport " + matchNurse[1]);
}

console.log("Extracted PatientsView and VisitsView");
