export * from './index';

// ==================== MONEY & FINANCE MODELS ====================

export type BillFrequency =
  | 'weekly'
  | 'fortnightly'
  | 'monthly'
  | 'quarterly'
  | 'every_x_days'
  | 'every_x_weeks'
  | 'every_x_months'
  | 'annually'
  | 'custom';

export interface BillRecurrenceConfig {
  interval?: number; // e.g. every 2 weeks/days
  customDays?: number;
  dayOfMonth?: number;
  dayOfWeek?: number; // 0 = Sun .. 6 = Sat
}

export type NotificationOffsetType =
  | 'on_day'
  | '1_day_before'
  | '2_days_before'
  | '3_days_before'
  | '1_week_before'
  | 'custom_days_before'
  | 'custom_hours_before';

export interface NotificationSetting {
  id: string;
  type: NotificationOffsetType;
  customValue?: number; // e.g. 5 days or 12 hours
  timeOfDay?: string; // "09:00"
  enabled: boolean;
}

export interface DirectDebitCategory {
  id: string;
  name: string;
  color: string;
  icon?: string;
  isDefault?: boolean;
}

export interface DirectDebit {
  id: string;
  title: string;
  amount: number;
  categoryId: string;
  frequency: BillFrequency;
  recurrenceConfig?: BillRecurrenceConfig;
  nextPaymentDate: string; // YYYY-MM-DD
  startDate?: string;
  endDate?: string;
  notes?: string;
  active: boolean;
  notificationSettings?: NotificationSetting[];
  linkedReminderId?: string;
  createdAt: string;
  updatedAt: string;
}

// Income Configuration
export type EmploymentType = 'full_time' | 'part_time' | 'casual_hourly' | 'freelance' | 'other';
export type PayFrequency = 'weekly' | 'fortnightly' | 'monthly' | 'custom';

export interface HourlyRateConfig {
  baseRate: number;
  saturdayRate?: number;
  sundayRate?: number;
  publicHolidayRate?: number;
  eveningRate?: number;
  nightRate?: number;
  overtimeRate?: number;
  customRates?: Record<string, number>;
}

export interface IncomeConfig {
  id: string;
  title: string;
  employmentType: EmploymentType;
  frequency: PayFrequency;
  customFrequencyDays?: number;
  averagePay: number;
  nextPayDate: string; // YYYY-MM-DD
  employerName?: string;
  notes?: string;
  hourlyPayModeEnabled?: boolean;
  hourlyRates?: HourlyRateConfig;
  createdAt: string;
  updatedAt: string;
}

export interface PayCycleOverride {
  cycleEndDate: string; // YYYY-MM-DD of the next pay date
  expectedPayOverride: number;
}

export type ShiftRateType =
  | 'base'
  | 'saturday'
  | 'sunday'
  | 'public_holiday'
  | 'evening'
  | 'night'
  | 'overtime'
  | 'custom';

export interface Shift {
  id: string;
  date: string; // YYYY-MM-DD
  startTime: string; // HH:mm (24hr)
  endTime: string; // HH:mm (24hr)
  breakMinutes: number;
  rateType: ShiftRateType;
  customRate?: number;
  hourlyRate: number;
  paidHours: number;
  estimatedPay: number;
  actualPay?: number;
  notes?: string;
  createdAt: string;
}

export type ExtraIncomeSourceType =
  | 'cash_job'
  | 'extra_shift'
  | 'marketplace_sale'
  | 'freelance'
  | 'bonus'
  | 'refund'
  | 'side_gig'
  | 'other';

export type ExtraIncomeCategoryType =
  | 'cash_job'
  | 'extra_shift'
  | 'marketplace_sale'
  | 'freelance'
  | 'bonus'
  | 'refund'
  | 'side_gig'
  | 'other';

export interface ExtraIncomeCategory {
  id: string;
  name: string;
  color: string;
}

export interface ExtraIncome {
  id: string;
  title: string;
  amount: number;
  date: string; // YYYY-MM-DD
  categoryId: string;
  sourceType?: ExtraIncomeSourceType;
  linkedReminderId?: string;
  includeInCurrentPayCycle?: boolean;
  received?: boolean;
  shiftDetails?: Partial<Shift>;
  notes?: string;
  createdAt: string;
}

export type TipShiftType = 'day' | 'evening' | 'night' | 'weekend' | 'other';

export interface TipEntry {
  id: string;
  amount: number;
  date: string; // YYYY-MM-DD
  shiftId?: string;
  shiftType?: TipShiftType;
  venue?: string;
  locationOrRole?: string;
  categoryId?: string;
  notes?: string;
  createdAt: string;
}

// Full Finance State container
export interface MoneyState {
  incomeConfig: IncomeConfig | null;
  directDebits: DirectDebit[];
  billCategories: DirectDebitCategory[];
  extraIncomeList: ExtraIncome[];
  extraIncomeCategories: ExtraIncomeCategory[];
  tipEntries: TipEntry[];
  shifts: Shift[];
  payCycleOverrides: Record<string, number>; // cycleEndDate -> overridden pay
}

export type AppNavTab = 'reminders' | 'contacts' | 'money' | 'dashboard';
export type MoneySubTab = 'overview' | 'bills' | 'income' | 'extra' | 'tips' | 'settings' | 'categories';

export type DashboardTimeFilter = 'today' | '7days' | '30days' | '3months' | 'all';
