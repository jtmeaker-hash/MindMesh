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

/**
 * Distinguishes money that is withdrawn automatically for the user from a bill
 * the user is personally responsible for paying by a deadline.
 * - `direct_debit`: automatically withdrawn (Netflix, phone plan, insurance,
 *   gym, loan repayments). Never requires manual completion and never becomes
 *   overdue — it simply rolls on to its next occurrence.
 * - `bill`: the user must make the payment (registration, electricity, manual
 *   rent, invoices). Only these can become overdue, based on their due-by date.
 *
 * Optional for backward compatibility: entries stored before this field existed
 * are treated as a `bill` when they carry a due-by deadline and otherwise as an
 * automatic `direct_debit`.
 */
export type DirectDebitKind = 'direct_debit' | 'bill';

export interface DirectDebit {
  id: string;
  title: string;
  amount: number;
  categoryId: string;
  frequency: BillFrequency;
  recurrenceConfig?: BillRecurrenceConfig;
  /** Automatic withdrawal vs. user-paid bill. See {@link DirectDebitKind}. */
  kind?: DirectDebitKind;
  nextPaymentDate: string; // YYYY-MM-DD - the date the payment is expected/planned
  /**
   * YYYY-MM-DD - the final deadline by which the payment must be completed.
   * Optional and always separate from `nextPaymentDate`. Older bills and backups
   * without this field remain valid and load with no deadline set.
   */
  dueByDate?: string;
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

/**
 * How a casual rate rule interprets its `rate` value.
 * - `fixed`: an absolute hourly rate.
 * - `multiplier`: a multiplier applied to the configuration base rate.
 */
export type RateRuleMode = 'fixed' | 'multiplier';

/**
 * A user-defined casual pay window. Rules are additive: an empty `rateRules`
 * list preserves the original per-`rateType` behaviour, while any rule takes
 * over day/time matching and falls back to the base rate when nothing matches.
 *
 * Days use `0 = Sunday .. 6 = Saturday`. Times are 24hr `HH:mm`. A window whose
 * end time is earlier than its start time spans midnight (e.g. 22:00-06:00).
 */
export interface CasualPayRateRule {
  id: string;
  label: string;
  enabled: boolean;
  /** Selected days of week (0 = Sun .. 6 = Sat). */
  days: number[];
  /** When true the rule applies for the whole selected day(s). */
  allDay: boolean;
  /** HH:mm, required unless `allDay` is true. */
  startTime?: string;
  /** HH:mm, required unless `allDay` is true. End is exclusive. */
  endTime?: string;
  mode: RateRuleMode;
  /** Hourly rate when `mode` is `fixed`, or a base-rate multiplier when `multiplier`. */
  rate: number;
  /** Higher priority wins when multiple enabled rules match the same minute. */
  priority: number;
}

export interface HourlyRateConfig {
  baseRate: number;
  saturdayRate?: number;
  sundayRate?: number;
  publicHolidayRate?: number;
  eveningRate?: number;
  nightRate?: number;
  overtimeRate?: number;
  customRates?: Record<string, number>;
  /**
   * Additive user-defined rate windows. Absent/empty on configs created before
   * this feature and on configs that rely solely on the legacy named rates.
   */
  rateRules?: CasualPayRateRule[];
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

/**
 * A single resolved rate window inside a shift. Produced by the casual pay rate
 * engine and persisted on the shift so the breakdown survives reloads.
 */
export interface ShiftRateSegment {
  ruleId?: string;
  ruleLabel?: string;
  /** Day of week the segment starts on (0 = Sun .. 6 = Sat). */
  dayOfWeek: number;
  /** Clock time at the start of the segment (HH:mm, may wrap past midnight). */
  startTime: string;
  /** Clock time at the end of the segment (HH:mm, exclusive). */
  endTime: string;
  hours: number;
  rate: number;
  pay: number;
  isBase: boolean;
}

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
  /** Optional rule-based breakdown; absent on legacy/manual shifts. */
  rateSegments?: ShiftRateSegment[];
  /** IDs of the enabled rate rules that contributed to this shift. */
  appliedRateRuleIds?: string[];
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

/**
 * How an expense was paid. Optional and informational only; general expenses
 * never generate scheduled payments or treatment as a bill.
 */
export type ExpensePaymentMethod = 'cash' | 'card' | 'transfer' | 'other';

/**
 * How a general expense is expected to repeat.
 * - `none`: a single logged / expected purchase.
 * - `per_pay_cycle`: an expected amount allocated to every pay cycle without a
 *   specific calendar date (e.g. "Fuel $70 per pay cycle"). It resets into the
 *   next budget automatically and can never be overdue.
 * - `weekly` / `fortnightly` / `monthly` / `custom`: an expected amount that
 *   recurs on a schedule.
 *
 * Absent on records created before this field existed and treated as `none`.
 */
export type ExpenseRepeat = 'none' | 'per_pay_cycle' | 'weekly' | 'fortnightly' | 'monthly' | 'custom';

/**
 * A general expense (fuel, groceries, takeaway, transport, miscellaneous).
 * Unlike a {@link DirectDebit}, an expense never becomes overdue and never
 * requires manual completion. Its date is optional so an expected amount can be
 * attached to a pay cycle without pretending it happens on an exact day.
 */
export interface Expense {
  id: string;
  title: string;
  amount: number;
  /**
   * YYYY-MM-DD - the date the money was spent, or the anchor date for a
   * repeating expectation. Omitted for `per_pay_cycle` and for one-off
   * expectations with no calendar date.
   */
  date?: string;
  categoryId: string;
  /** Repeat behaviour. Absent on older records and treated as `none`. */
  repeat?: ExpenseRepeat;
  /** Extra interval configuration for `custom` repeats. */
  recurrenceConfig?: BillRecurrenceConfig;
  /**
   * True when the amount is an expectation/estimate rather than a logged
   * purchase. Undated and repeating expenses are estimates by default.
   */
  estimated?: boolean;
  /** Optional merchant / payee / store name. */
  merchant?: string;
  /** Optional payment method, purely informational. */
  paymentMethod?: ExpensePaymentMethod;
  /** Optional reference such as a receipt or invoice number. */
  reference?: string;
  notes?: string;
  createdAt: string;
  updatedAt: string;
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
  /** One-off / variable general expenses. Absent on older state and backups. */
  expenses: Expense[];
  payCycleOverrides: Record<string, number>; // cycleEndDate -> overridden pay
}

/**
 * Primary navigation tab id. Core owns the first set; plugins may contribute
 * additional tab ids, so the union stays open (`string & {}`) rather than
 * forcing a Core edit for every new plugin.
 */
export type AppNavTab =
  | 'reminders'
  | 'routines'
  | 'contacts'
  | 'money'
  | 'dashboard'
  | 'vehicles'
  | (string & Record<never, never>);
export type MoneySubTab = 'overview' | 'bills' | 'income' | 'extra' | 'tips' | 'expenses' | 'settings' | 'categories';

export type DashboardTimeFilter = 'today' | '7days' | '30days' | '3months' | 'all';
