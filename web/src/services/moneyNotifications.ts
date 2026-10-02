import { DirectDebit } from '../types/finance';
import { formatCurrency, getDirectDebitStatus, toDateString } from '../utils/finance';

/**
 * Local-only direct debit notifications.
 *
 * Automatic direct debits are withdrawn for the user, so on the scheduled day
 * MindMesh simply tells them the withdrawal is happening. There is nothing to
 * mark as paid and nothing that can become overdue: tomorrow the entry rolls on
 * to its next occurrence automatically (see `reconcileDirectDebits`).
 */

export interface DirectDebitNotification {
  id: string;
  directDebitId: string;
  title: string;
  amount: number;
  /** YYYY-MM-DD the withdrawal is scheduled for. */
  date: string;
  message: string;
}

/** Automatic direct debits whose scheduled withdrawal day is the reference day. */
export function getDirectDebitsDueToday(
  debits: readonly DirectDebit[],
  referenceDateStr: string = toDateString(new Date())
): DirectDebit[] {
  return debits.filter((debit) => {
    if (!debit.active) return false;
    const status = getDirectDebitStatus(debit, referenceDateStr);
    return status.kind === 'direct_debit' && status.isDueToday;
  });
}

/** Builds the "is scheduled to be withdrawn today" notification for one debit. */
export function buildDirectDebitNotification(
  debit: DirectDebit,
  referenceDateStr: string = toDateString(new Date())
): DirectDebitNotification {
  return {
    id: `money-notif-${debit.id}-${referenceDateStr}`,
    directDebitId: debit.id,
    title: debit.title,
    amount: Number(debit.amount) || 0,
    date: referenceDateStr,
    message: `${debit.title} ${formatCurrency(Number(debit.amount) || 0)} is scheduled to be withdrawn today.`,
  };
}

/** All direct debit notifications for the reference day. */
export function collectDirectDebitNotifications(
  debits: readonly DirectDebit[],
  referenceDateStr: string = toDateString(new Date())
): DirectDebitNotification[] {
  return getDirectDebitsDueToday(debits, referenceDateStr).map((debit) =>
    buildDirectDebitNotification(debit, referenceDateStr)
  );
}
