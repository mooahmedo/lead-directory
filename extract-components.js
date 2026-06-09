const fs = require('fs');

const pageContent = fs.readFileSync('app/page.tsx', 'utf8');

// The goal is to completely separate components into distinct files to reduce page.tsx size.
// I will create individual files for each major component to ensure they are clean.

// 1. SystemLogin
let match = pageContent.match(/(function SystemLogin[\s\S]*?\n})\n\n/);
if(match) fs.writeFileSync('components/auth/SystemLogin.tsx', `"use client";
import { useState } from "react";
import { createClient } from "@/lib/supabase/client";
import { toast, Toaster } from "sonner";
import { Loader2, Eye, EyeOff, Heart, LogIn } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

export ` + match[1]);

// 2. ChangePasswordView
match = pageContent.match(/(function ChangePasswordView[\s\S]*?\n})\n\n/);
if(match) fs.writeFileSync('components/auth/ChangePasswordView.tsx', `"use client";
import { useState } from "react";
import { createClient } from "@/lib/supabase/client";
import { toast, Toaster } from "sonner";
import { Loader2, Eye, EyeOff, Lock, Heart } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import type { UserProfile } from "@/lib/types";

export ` + match[1]);

// 3. DepartmentsUnitsView
match = pageContent.match(/(function DepartmentsUnitsView[\s\S]*?\n})\n\n/);
if(match) fs.writeFileSync('components/views/DepartmentsUnitsView.tsx', `"use client";
import { useState, useEffect, useCallback } from "react";
import { toast } from "sonner";
import { Search, Loader2, Building2, Eye, Edit2, CheckCircle2, XCircle } from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import type { UserProfile, Department, HealthUnit } from "@/lib/types";
import { resilientFetch } from "@/lib/api";

export ` + match[1].replace(/resilientFetch/g, 'resilientFetch')); // I need to move resilientFetch to a common lib!

// 4. UsersView
match = pageContent.match(/(function UsersView[\s\S]*?\n})\n\n/);
if(match) fs.writeFileSync('components/views/UsersView.tsx', `"use client";
import { useState, useEffect, useCallback } from "react";
import { createClient } from "@/lib/supabase/client";
import { toast } from "sonner";
import { Search, Loader2, Shield, Eye, Edit2, CheckCircle2, XCircle, Plus, EyeOff } from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { resilientFetch } from "@/lib/api";
import type { Department, HealthUnit } from "@/lib/types";

export ` + match[1]);

console.log("Extracted parts.");
