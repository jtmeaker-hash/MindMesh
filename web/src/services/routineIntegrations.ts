import { Contact, Reminder } from '../types';
import { DirectDebit } from '../types/finance';
import { Routine, RoutineStep, RoutineStepLinks } from '../types/routine';

export interface RoutineLinkTargets {
  reminders: Reminder[];
  contacts: Contact[];
  directDebits: DirectDebit[];
  routines?: Routine[];
}

export interface BrokenRoutineLink { routineId: string; stepId: string; kind: keyof RoutineStepLinks; targetId: string; reason: string; }

export function validateRoutineLinks(routines: Routine[], targets: RoutineLinkTargets): BrokenRoutineLink[] {
  const reminderIds = new Set(targets.reminders.map((item) => item.id));
  const contactIds = new Set(targets.contacts.map((item) => item.id));
  const debitIds = new Set(targets.directDebits.map((item) => item.id));
  const routineIds = new Set((targets.routines || routines).map((item) => item.id));
  const broken: BrokenRoutineLink[] = [];
  for (const routine of routines) for (const step of routine.steps) {
    const links = step.links;
    if (!links) continue;
    const checks: [keyof RoutineStepLinks, string | undefined, Set<string>][] = [
      ['reminderId', links.reminderId, reminderIds], ['contactId', links.contactId, contactIds],
      ['directDebitId', links.directDebitId, debitIds], ['routineId', links.routineId, routineIds],
    ];
    for (const [kind, targetId, ids] of checks) if (targetId && !ids.has(targetId)) broken.push({ routineId: routine.id, stepId: step.id, kind, targetId, reason: `${kind} no longer exists` });
  }
  return broken;
}

export function repairRoutineLinks(routine: Routine, targets: RoutineLinkTargets): Routine {
  const broken = new Set(validateRoutineLinks([routine], targets).map((item) => `${item.stepId}:${item.kind}`));
  let changed = false;
  const steps = routine.steps.map((step) => {
    if (!step.links) return step;
    const links = { ...step.links };
    (['reminderId', 'contactId', 'directDebitId', 'routineId'] as const).forEach((kind) => {
      if (links[kind] && broken.has(`${step.id}:${kind}`)) { delete links[kind]; changed = true; }
    });
    const stillBroken = Object.keys(links).some((key) => key.endsWith('Id') && Boolean(links[key as keyof RoutineStepLinks]));
    return changed ? { ...step, links: { ...links, broken: stillBroken, brokenReason: stillBroken ? 'One or more linked MindMesh records are missing' : undefined } } : step;
  });
  return changed ? { ...routine, steps, brokenLink: steps.some((step) => step.links?.broken), updatedAt: new Date().toISOString() } : routine;
}

export function linkedTargetActions(step: RoutineStep, targets: RoutineLinkTargets): { label: string; href: string }[] {
  const actions: { label: string; href: string }[] = [];
  if (step.links?.contactId) {
    const contact = targets.contacts.find((item) => item.id === step.links?.contactId);
    if (contact?.phoneNumber) { actions.push({ label: `Call ${contact.displayName || contact.fullName}`, href: `tel:${contact.phoneNumber}` }); actions.push({ label: 'Message', href: `sms:${contact.phoneNumber}` }); }
  }
  return actions;
}
