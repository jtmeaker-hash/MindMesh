/**
 * Self Care plugin — data model.
 *
 * Optional, opt-in gentle check-ins (eat, water, rest, stretch, outdoors,
 * wind down, or a user-defined care type). All scheduling is expressed in
 * local wall-clock time so timezone/DST shifts reconcile deterministically.
 * No streaks, no shame, no clinical advice, no external calls.
 */

export type SelfCareCategory =
  | 'eat'
  | 'water'
  | 'rest'
  | 'stretch'
  | 'outdoors'
  | 'wind-down'
  | 'custom';

export type SelfCareTone = 'gentle' | 'upbeat' | 'direct' | 'custom';

export interface SelfCareMessageVariant {
  id: string;
  /** Tone this variant was written in. */
  tone: SelfCareTone;
  /** The message body shown in the notification. */
  text: string;
}

export interface SelfCareSchedule {
  /** Weekdays this check-in may fire: 0 = Sunday … 6 = Saturday. */
  weekdays: number[];
  /** Local wall-clock times ("HH:MM", 24h) this check-in may fire. */
  times: string[];
  /** Repeat every N days (1 = every selected weekday). */
  everyNDays: number;
}

export interface SelfCareCheckIn {
  id: string;
  title: string;
  category: SelfCareCategory;
  /** Custom care-type label when category === 'custom'. */
  customLabel?: string;
  enabled: boolean;
  /** Master pause for this check-in (pause != delete). */
  paused: boolean;
  defaultTone: SelfCareTone;
  /** Custom tone guidance used when defaultTone === 'custom'. */
  customToneNote?: string;
  variants: SelfCareMessageVariant[];
  schedule: SelfCareSchedule;
  /** Minutes a snooze defers this check-in. */
  snoozeMinutes: number;
  createdAt: string;
  updatedAt: string;
}

export type SelfCareHistoryResult = 'done' | 'snoozed' | 'skipped' | 'missed' | 'opened';

export interface SelfCareHistoryEntry {
  id: string;
  checkInId: string;
  occurrenceKey: string;
  result: SelfCareHistoryResult;
  at: string;
}

export interface SelfCareQuietHours {
  enabled: boolean;
  /** Local "HH:MM" — notifications never fire inside [start, end). */
  start: string;
  end: string;
}

export interface SelfCareSettings {
  /** Global pause: stops all Self Care alarms, keeps everything stored. */
  pausedAll: boolean;
  quietHours: SelfCareQuietHours;
  /** Maximum Self Care notifications scheduled per calendar day. */
  maxPerDay: number;
  /** When true, notifications carry a generic body; full text stays in-app. */
  privateLockScreen: boolean;
  /** First-run onboarding has been shown. */
  onboarded: boolean;
}

export interface SelfCareState {
  schemaVersion: number;
  checkIns: SelfCareCheckIn[];
  history: SelfCareHistoryEntry[];
  settings: SelfCareSettings;
  /** Native notification ids currently registered for this plugin. */
  scheduledIds: string[];
  lastModified: string;
}

export const SELF_CARE_SCHEMA_VERSION = 1;
export const SELF_CARE_PLUGIN_ID = 'self-care';
/** Prefix for every native notification id owned by this plugin. */
export const SELF_CARE_NOTIFICATION_PREFIX = 'selfcare::';
export const SELF_CARE_SNOOZE_MINUTES_DEFAULT = 20;
export const SELF_CARE_MAX_PER_DAY_DEFAULT = 6;
/** Occurrences older than this without a response are recorded as missed. */
export const SELF_CARE_MISSED_GRACE_MINUTES = 45;

export const SELF_CARE_CATEGORY_LABELS: Record<SelfCareCategory, string> = {
  eat: 'Eat',
  water: 'Drink water',
  rest: 'Rest',
  stretch: 'Stretch',
  outdoors: 'Get outdoors',
  'wind-down': 'Wind down',
  custom: 'Personal care',
};

export const SELF_CARE_TONE_LABELS: Record<SelfCareTone, string> = {
  gentle: 'Gentle',
  upbeat: 'Upbeat',
  direct: 'Direct',
  custom: 'Custom',
};

/** Supportive, non-shaming template variants. Never clinical, never diet-framed. */
export const SELF_CARE_TEMPLATES: Record<Exclude<SelfCareCategory, 'custom'>, string[]> = {
  eat: [
    'Hey, just checking in 💛 Have you managed a bite to eat? Even a small snack counts.',
    'Gentle reminder 💛 your body could use some fuel when you get a moment.',
    'No pressure at all — just wondering if you have had something to eat yet 💛',
  ],
  water: [
    'Hey 💧 a glass of water could be a nice little reset, whenever you are ready.',
    'Checking in 💧 have you had some water in the last little while?',
    'Small thing, big difference 💧 a sip of water when you can.',
  ],
  rest: [
    'Hey 💛 you have been going a while — a short rest could do you good.',
    'Permission to pause 💛 even five quiet minutes count as rest.',
    'Checking in 💛 is there a way to give yourself a little break soon?',
  ],
  stretch: [
    'Hey 🙆 a gentle stretch could feel nice — shoulders back, deep breath.',
    'Checking in 🙆 want to stand up and stretch for a minute?',
    'Your body called — it asked for a little movement 💛 no rush.',
  ],
  outdoors: [
    'Hey 🌿 a few minutes outside could be lovely, if that is available to you.',
    'Checking in 🌿 some fresh air, even from a window, counts.',
    'Sunlight and a short stroll? Only if it sounds good 💛',
  ],
  'wind-down': [
    'Hey 🌙 winding down a little could help tonight go gently.',
    'Checking in 🌙 maybe dim the lights and do something calm?',
    'The day is done 💛 time to be soft with yourself.',
  ],
};

export function defaultSelfCareSettings(): SelfCareSettings {
  return {
    pausedAll: false,
    quietHours: { enabled: true, start: '22:00', end: '07:00' },
    maxPerDay: SELF_CARE_MAX_PER_DAY_DEFAULT,
    privateLockScreen: false,
    onboarded: false,
  };
}

export function defaultSelfCareState(): SelfCareState {
  return {
    schemaVersion: SELF_CARE_SCHEMA_VERSION,
    checkIns: [],
    history: [],
    settings: defaultSelfCareSettings(),
    scheduledIds: [],
    lastModified: new Date().toISOString(),
  };
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

function cleanTime(value: unknown, fallback: string): string {
  if (typeof value !== 'string') return fallback;
  const match = value.trim().match(/^(\d{1,2}):(\d{2})$/);
  if (!match) return fallback;
  const h = Math.min(23, Math.max(0, Number(match[1])));
  const m = Math.min(59, Math.max(0, Number(match[2])));
  return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`;
}

function cleanWeekdays(value: unknown): number[] {
  if (!Array.isArray(value)) return [1, 2, 3, 4, 5];
  const days = value.filter(
    (d): d is number => typeof d === 'number' && Number.isInteger(d) && d >= 0 && d <= 6
  );
  return [...new Set(days)].sort();
}

function cleanTimes(value: unknown): string[] {
  if (!Array.isArray(value)) return ['09:00'];
  const times = value
    .filter((t): t is string => typeof t === 'string')
    .map((t) => cleanTime(t, ''))
    .filter((t) => t.length > 0);
  return [...new Set(times)].sort().slice(0, 8);
}

const VALID_CATEGORIES: SelfCareCategory[] = ['eat', 'water', 'rest', 'stretch', 'outdoors', 'wind-down', 'custom'];
const VALID_TONES: SelfCareTone[] = ['gentle', 'upbeat', 'direct', 'custom'];

export function normalizeSelfCareSchedule(input: unknown): SelfCareSchedule {
  const raw = asRecord(input) ?? {};
  const everyNDays =
    typeof raw.everyNDays === 'number' && Number.isInteger(raw.everyNDays) && raw.everyNDays >= 1
      ? Math.min(30, raw.everyNDays)
      : 1;
  return { weekdays: cleanWeekdays(raw.weekdays), times: cleanTimes(raw.times), everyNDays };
}

export function normalizeSelfCareVariant(input: unknown, index: number): SelfCareMessageVariant | null {
  const raw = asRecord(input);
  if (!raw || typeof raw.text !== 'string' || raw.text.trim().length === 0) return null;
  const tone: SelfCareTone = VALID_TONES.includes(raw.tone as SelfCareTone)
    ? (raw.tone as SelfCareTone)
    : 'gentle';
  return {
    id: typeof raw.id === 'string' && raw.id.length > 0 ? raw.id : `variant-${index}`,
    tone,
    text: raw.text.slice(0, 280),
  };
}

export function normalizeSelfCareCheckIn(input: unknown): SelfCareCheckIn | null {
  const raw = asRecord(input);
  if (!raw || typeof raw.id !== 'string' || raw.id.length === 0) return null;
  const category: SelfCareCategory = VALID_CATEGORIES.includes(raw.category as SelfCareCategory)
    ? (raw.category as SelfCareCategory)
    : 'custom';
  const tone: SelfCareTone = VALID_TONES.includes(raw.defaultTone as SelfCareTone)
    ? (raw.defaultTone as SelfCareTone)
    : 'gentle';
  const variants = Array.isArray(raw.variants)
    ? raw.variants
        .map((v, i) => normalizeSelfCareVariant(v, i))
        .filter((v): v is SelfCareMessageVariant => v !== null)
        .slice(0, 12)
    : [];
  const snoozeMinutes =
    typeof raw.snoozeMinutes === 'number' && Number.isFinite(raw.snoozeMinutes)
      ? Math.min(180, Math.max(5, Math.round(raw.snoozeMinutes)))
      : SELF_CARE_SNOOZE_MINUTES_DEFAULT;
  return {
    id: raw.id,
    title: typeof raw.title === 'string' && raw.title.trim().length > 0 ? raw.title.slice(0, 80) : 'Self care check-in',
    category,
    customLabel: typeof raw.customLabel === 'string' ? raw.customLabel.slice(0, 80) : undefined,
    enabled: raw.enabled !== false,
    paused: raw.paused === true,
    defaultTone: tone,
    customToneNote: typeof raw.customToneNote === 'string' ? raw.customToneNote.slice(0, 200) : undefined,
    variants,
    schedule: normalizeSelfCareSchedule(raw.schedule),
    snoozeMinutes,
    createdAt: typeof raw.createdAt === 'string' ? raw.createdAt : new Date().toISOString(),
    updatedAt: typeof raw.updatedAt === 'string' ? raw.updatedAt : new Date().toISOString(),
  };
}

const VALID_RESULTS: SelfCareHistoryResult[] = ['done', 'snoozed', 'skipped', 'missed', 'opened'];

export function normalizeSelfCareHistoryEntry(input: unknown): SelfCareHistoryEntry | null {
  const raw = asRecord(input);
  if (!raw || typeof raw.id !== 'string' || typeof raw.checkInId !== 'string') return null;
  if (!VALID_RESULTS.includes(raw.result as SelfCareHistoryResult)) return null;
  return {
    id: raw.id,
    checkInId: raw.checkInId,
    occurrenceKey: typeof raw.occurrenceKey === 'string' ? raw.occurrenceKey : '',
    result: raw.result as SelfCareHistoryResult,
    at: typeof raw.at === 'string' ? raw.at : new Date().toISOString(),
  };
}

export function normalizeSelfCareSettings(input: unknown): SelfCareSettings {
  const raw = asRecord(input) ?? {};
  const quiet = asRecord(raw.quietHours) ?? {};
  const maxPerDay =
    typeof raw.maxPerDay === 'number' && Number.isFinite(raw.maxPerDay)
      ? Math.min(24, Math.max(1, Math.round(raw.maxPerDay)))
      : SELF_CARE_MAX_PER_DAY_DEFAULT;
  return {
    pausedAll: raw.pausedAll === true,
    quietHours: {
      enabled: quiet.enabled !== false,
      start: cleanTime(quiet.start, '22:00'),
      end: cleanTime(quiet.end, '07:00'),
    },
    maxPerDay,
    privateLockScreen: raw.privateLockScreen === true,
    onboarded: raw.onboarded === true,
  };
}

/**
 * Non-destructive normalizer for the whole Self Care state. Unknown fields are
 * dropped, missing fields are defaulted, and no record is ever removed except
 * structurally invalid entries. Idempotent: normalizing twice is a no-op.
 */
export function normalizeSelfCareState(input: unknown): SelfCareState {
  const raw = asRecord(input);
  if (!raw) return defaultSelfCareState();
  const checkIns = Array.isArray(raw.checkIns)
    ? raw.checkIns
        .map((c) => normalizeSelfCareCheckIn(c))
        .filter((c): c is SelfCareCheckIn => c !== null)
    : [];
  const history = Array.isArray(raw.history)
    ? raw.history
        .map((h) => normalizeSelfCareHistoryEntry(h))
        .filter((h): h is SelfCareHistoryEntry => h !== null)
        .slice(-500)
    : [];
  const scheduledIds = Array.isArray(raw.scheduledIds)
    ? raw.scheduledIds.filter((id): id is string => typeof id === 'string' && id.startsWith(SELF_CARE_NOTIFICATION_PREFIX))
    : [];
  return {
    schemaVersion: SELF_CARE_SCHEMA_VERSION,
    checkIns,
    history,
    settings: normalizeSelfCareSettings(raw.settings),
    scheduledIds,
    lastModified: typeof raw.lastModified === 'string' ? raw.lastModified : new Date().toISOString(),
  };
}

/** Deterministic variant pick: rotates by occurrence index — no randomness, no AI. */
export function pickVariant(checkIn: SelfCareCheckIn, occurrenceIndex: number): string {
  if (checkIn.variants.length > 0) {
    return checkIn.variants[occurrenceIndex % checkIn.variants.length].text;
  }
  if (checkIn.category !== 'custom') {
    const templates = SELF_CARE_TEMPLATES[checkIn.category];
    return templates[occurrenceIndex % templates.length];
  }
  return 'Hey 💛 just checking in — a little care for yourself when you are ready.';
}

export function checkInDisplayLabel(checkIn: SelfCareCheckIn): string {
  if (checkIn.category === 'custom' && checkIn.customLabel?.trim()) return checkIn.customLabel.trim();
  return SELF_CARE_CATEGORY_LABELS[checkIn.category];
}
