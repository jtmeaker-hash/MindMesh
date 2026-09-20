import {
  DirectDebitCategory,
  ExtraIncomeCategory,
  MoneyState,
} from '../types/finance';

export const INITIAL_BILL_CATEGORIES: DirectDebitCategory[] = [
  { id: 'bcat-rent', name: 'Rent & Housing', color: '#6366F1', isDefault: true },
  { id: 'bcat-util', name: 'Utilities', color: '#06B6D4', isDefault: true },
  { id: 'bcat-sub', name: 'Subscriptions', color: '#EC4899', isDefault: true },
  { id: 'bcat-car', name: 'Car & Transport', color: '#3B82F6', isDefault: true },
  { id: 'bcat-ins', name: 'Insurance', color: '#10B981', isDefault: true },
  { id: 'bcat-health', name: 'Health & Medical', color: '#14B8A6', isDefault: true },
  { id: 'bcat-food', name: 'Food & Groceries', color: '#F59E0B', isDefault: true },
  { id: 'bcat-debt', name: 'Debt & Loans', color: '#EF4444', isDefault: true },
  { id: 'bcat-ent', name: 'Entertainment', color: '#8B5CF6', isDefault: true },
  { id: 'bcat-phone', name: 'Phone & Internet', color: '#38BDF8', isDefault: true },
  { id: 'bcat-other', name: 'Other', color: '#94A3B8', isDefault: true },
];

export const INITIAL_EXTRA_INCOME_CATEGORIES: ExtraIncomeCategory[] = [
  { id: 'xcat-cash', name: 'Cash Job', color: '#10B981' },
  { id: 'xcat-shift', name: 'Extra Shift', color: '#3B82F6' },
  { id: 'xcat-market', name: 'Marketplace Sale', color: '#F59E0B' },
  { id: 'xcat-freelance', name: 'Freelance Work', color: '#8B5CF6' },
  { id: 'xcat-bonus', name: 'Bonus', color: '#EC4899' },
  { id: 'xcat-refund', name: 'Refund', color: '#06B6D4' },
  { id: 'xcat-side', name: 'Side Gig', color: '#14B8A6' },
  { id: 'xcat-other', name: 'Other Income', color: '#94A3B8' },
];

export function getDefaultMoneyState(): MoneyState {
  return {
    incomeConfig: null,
    directDebits: [],
    billCategories: INITIAL_BILL_CATEGORIES,
    extraIncomeList: [],
    extraIncomeCategories: INITIAL_EXTRA_INCOME_CATEGORIES,
    tipEntries: [],
    shifts: [],
    payCycleOverrides: {},
  };
}
