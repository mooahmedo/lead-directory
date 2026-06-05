// Egyptian Governorate codes from national ID
const GOVERNORATES: Record<string, string> = {
  '01': 'القاهرة',
  '02': 'الإسكندرية',
  '03': 'بورسعيد',
  '04': 'السويس',
  '11': 'دمياط',
  '12': 'الدقهلية',
  '13': 'الشرقية',
  '14': 'القليوبية',
  '15': 'كفر الشيخ',
  '16': 'الغربية',
  '17': 'المنوفية',
  '18': 'البحيرة',
  '19': 'الإسماعيلية',
  '21': 'الجيزة',
  '22': 'بني سويف',
  '23': 'الفيوم',
  '24': 'المنيا',
  '25': 'أسيوط',
  '26': 'سوهاج',
  '27': 'قنا',
  '28': 'أسوان',
  '29': 'الأقصر',
  '31': 'البحر الأحمر',
  '32': 'الوادي الجديد',
  '33': 'مطروح',
  '34': 'شمال سيناء',
  '35': 'جنوب سيناء',
  '88': 'خارج الجمهورية',
};

export interface NationalIdInfo {
  valid: boolean;
  birthDate?: string;
  age?: number;
  gender?: 'ذكر' | 'أنثى';
  governorate?: string;
  error?: string;
}

export function parseNationalId(id: string): NationalIdInfo {
  const cleaned = id.trim();

  if (!/^\d{14}$/.test(cleaned)) {
    return { valid: false, error: 'الرقم القومي يجب أن يكون 14 رقمًا' };
  }

  const centuryCode = cleaned[0];
  const yearStr = cleaned.slice(1, 3);
  const monthStr = cleaned.slice(3, 5);
  const dayStr = cleaned.slice(5, 7);
  const govCode = cleaned.slice(7, 9);
  const seqStr = cleaned.slice(9, 13);

  // Determine birth century
  let century: number;
  if (centuryCode === '2') century = 1900;
  else if (centuryCode === '3') century = 2000;
  else return { valid: false, error: 'الرقم القومي غير صحيح — رمز القرن غير معروف' };

  const year = century + parseInt(yearStr, 10);
  const month = parseInt(monthStr, 10);
  const day = parseInt(dayStr, 10);

  if (month < 1 || month > 12) {
    return { valid: false, error: 'الرقم القومي غير صحيح — الشهر غير صالح' };
  }
  if (day < 1 || day > 31) {
    return { valid: false, error: 'الرقم القومي غير صحيح — اليوم غير صالح' };
  }

  const birthDate = `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;

  // Calculate age
  const today = new Date();
  const birth = new Date(year, month - 1, day);
  let age = today.getFullYear() - birth.getFullYear();
  const m = today.getMonth() - birth.getMonth();
  if (m < 0 || (m === 0 && today.getDate() < birth.getDate())) {
    age--;
  }

  if (age < 0 || age > 120) {
    return { valid: false, error: 'الرقم القومي غير صحيح — تاريخ الميلاد غير منطقي' };
  }

  // Gender from sequence number (odd = male, even = female)
  const seq = parseInt(seqStr[2], 10); // 4th digit of 4-digit seq (index 12)
  const gender: 'ذكر' | 'أنثى' = parseInt(cleaned[12], 10) % 2 !== 0 ? 'ذكر' : 'أنثى';

  const governorate = GOVERNORATES[govCode] || `كود: ${govCode}`;

  return {
    valid: true,
    birthDate,
    age,
    gender,
    governorate,
  };
}

export function formatBirthDate(dateStr: string): string {
  const [year, month, day] = dateStr.split('-');
  const months = [
    'يناير', 'فبراير', 'مارس', 'أبريل', 'مايو', 'يونيو',
    'يوليو', 'أغسطس', 'سبتمبر', 'أكتوبر', 'نوفمبر', 'ديسمبر'
  ];
  return `${parseInt(day)} ${months[parseInt(month) - 1]} ${year}`;
}
