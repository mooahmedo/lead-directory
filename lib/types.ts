export interface Department {
  id: string;
  name: string;
  created_at: string;
  updated_at: string;
}

export interface HealthUnit {
  id: string;
  code: string;
  name: string;
  department_id: string;
  daily_target: number;
  monthly_target: number;
  active: boolean;
  created_at: string;
  updated_at: string;
  department?: Department;
}

export interface Patient {
  id: string;
  national_id: string;
  full_name: string;
  phone?: string;
  birth_date?: string;
  age?: number;
  gender?: 'ذكر' | 'أنثى';
  governorate?: string;
  first_visit_date: string;
  active: boolean;
  created_at: string;
  updated_at: string;
}

export interface Visit {
  id: string;
  patient_id: string;
  unit_id: string;
  visit_type: 'أول مرة' | 'متردد';
  visit_date: string;
  weight?: number;
  height?: number;
  sugar_type?: 'صائم' | 'عشوائي';
  sugar_level?: number;
  hba1c?: number;
  systolic?: number;
  diastolic?: number;
  cholesterol?: number;
  triglycerides?: number;
  ldl?: number;
  hdl?: number;
  creatinine?: number;
  egfr?: number;
  referred: boolean;
  referral_dest?: string;
  created_at: string;
  updated_at: string;
}

export interface UserProfile {
  id: string;
  full_name: string;
  username?: string;
  phone?: string;
  email: string;
  role: 'nurse' | 'supervisor' | 'coordinator';
  department_id?: string;
  unit_id?: string;
  active: boolean;
  must_change_password?: boolean;
  created_at: string;
  updated_at: string;
}

export interface AuditLog {
  id: string;
  action_type: string;
  entity_type: string;
  entity_id: string;
  performed_by: string;
  details: any;
  created_at: string;
}

export interface VisitSubmission {
  nationalId: string;
  fullName: string;
  phone?: string;
  departmentId: string;
  unitId: string;
  weight?: number;
  height?: number;
  sugarType?: 'صائم' | 'عشوائي';
  sugarLevel?: number;
  hba1c?: number;
  systolic?: number;
  diastolic?: number;
  cholesterol?: number;
  triglycerides?: number;
  ldl?: number;
  hdl?: number;
  creatinine?: number;
  egfr?: number;
  referred?: boolean;
  referralDest?: string;
}

export interface DashboardStats {
  totalPatients: number;
  totalVisits: number;
  todayVisits: number;
  activeUnits: number;
  newPatients: number;
  returningPatients: number;
  referrals: number;
  inactiveUnits: number;
}

export interface UnitStats {
  id: string;
  code: string;
  name: string;
  department_id: string;
  department_name: string;
  daily_target: number;
  monthly_target: number;
  today_visits: number;
  month_visits: number;
  active: boolean;
}
