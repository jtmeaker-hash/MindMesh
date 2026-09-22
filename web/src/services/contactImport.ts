import { Contact } from '../types/contact';

export interface DeviceContactRecord {
  id?: string;
  name?: string[];
  tel?: string[];
  email?: string[];
  address?: Array<{ addressLine?: string; city?: string; region?: string; postalCode?: string; country?: string }>;
  icon?: Blob[];
}

export interface ContactImportCapability {
  supported: boolean;
  reason?: string;
}

export function getContactImportCapability(): ContactImportCapability {
  if (typeof navigator !== 'undefined' && 'contacts' in navigator) return { supported: true };
  return { supported: false, reason: 'Device contact access is not available in this browser or WebView. You can still add contacts manually.' };
}

function normalize(value: string | undefined): string {
  return (value || '').trim().toLowerCase().replace(/[^a-z0-9+@]/g, '');
}

export function contactDuplicateScore(existing: Contact, incoming: DeviceContactRecord): number {
  const phones = (incoming.tel || []).map(normalize).filter(Boolean);
  const emails = (incoming.email || []).map(normalize).filter(Boolean);
  const incomingName = normalize((incoming.name || []).join(' '));
  let score = 0;
  if (phones.includes(normalize(existing.phoneNumber)) || phones.includes(normalize(existing.secondaryPhoneNumber))) score += 5;
  if (emails.includes(normalize(existing.email))) score += 5;
  if (incomingName && normalize(existing.fullName) === incomingName) score += 2;
  return score;
}

export function findLikelyDuplicate(existing: Contact[], incoming: DeviceContactRecord): Contact | undefined {
  return existing.find((contact) => contactDuplicateScore(contact, incoming) >= 5);
}

export type DuplicateDecision = 'skip' | 'merge' | 'separate';

/** Resolves an import review decision without mutating the existing contact book. */
export function resolveImportedContact(
  existing: Contact[],
  imported: Contact,
  decision: DuplicateDecision = 'separate',
): { contacts: Contact[]; action: DuplicateDecision } {
  const duplicate = existing.find((contact) =>
    (imported.sourceContactId && contact.sourceContactId === imported.sourceContactId) ||
    contactDuplicateScore(contact, {
      name: [imported.fullName],
      tel: [imported.phoneNumber, imported.secondaryPhoneNumber].filter((value): value is string => Boolean(value)),
      email: imported.email ? [imported.email] : [],
    }) >= 5
  );
  if (!duplicate || decision === 'separate') return { contacts: [imported], action: 'separate' };
  if (decision === 'skip') return { contacts: [], action: 'skip' };
  return { contacts: [mergeImportedContact(duplicate, imported)], action: 'merge' };
}

function addressText(record: DeviceContactRecord): string | undefined {
  const address = record.address?.[0];
  if (!address) return undefined;
  return [address.addressLine, address.city, address.region, address.postalCode, address.country].filter(Boolean).join(', ') || undefined;
}

export async function deviceRecordToContact(record: DeviceContactRecord): Promise<Contact> {
  const names = record.name || [];
  const fullName = names.join(' ').trim() || 'Imported contact';
  const photo = record.icon?.[0] ? await blobToDataUrl(record.icon[0]) : undefined;
  const now = new Date().toISOString();
  return {
    id: `contact-device-${record.id || Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
    fullName,
    firstName: names[0],
    lastName: names.slice(1).join(' ') || undefined,
    phoneNumber: record.tel?.[0] || '',
    secondaryPhoneNumber: record.tel?.[1],
    email: record.email?.[0],
    address: addressText(record),
    relationship: 'Other',
    photo,
    importedFromDevice: true,
    sourceContactId: record.id,
    createdAt: now,
    updatedAt: now,
  };
}

async function blobToDataUrl(blob: Blob): Promise<string | undefined> {
  if (typeof FileReader === 'undefined') return undefined;
  return new Promise((resolve) => {
    const reader = new FileReader();
    reader.onload = () => resolve(typeof reader.result === 'string' ? reader.result : undefined);
    reader.onerror = () => resolve(undefined);
    reader.readAsDataURL(blob);
  });
}

/** Merge only device fields that are absent; preserve MindMesh-owned metadata. */
export function mergeImportedContact(existing: Contact, imported: Contact): Contact {
  return {
    ...existing,
    fullName: existing.fullName || imported.fullName,
    firstName: existing.firstName || imported.firstName,
    lastName: existing.lastName || imported.lastName,
    phoneNumber: existing.phoneNumber || imported.phoneNumber,
    secondaryPhoneNumber: existing.secondaryPhoneNumber || imported.secondaryPhoneNumber,
    email: existing.email || imported.email,
    address: existing.address || imported.address,
    photo: existing.photo || imported.photo,
    sourceContactId: imported.sourceContactId || existing.sourceContactId,
    importedFromDevice: true,
    updatedAt: new Date().toISOString(),
  };
}

export async function selectDeviceContacts(): Promise<DeviceContactRecord[]> {
  const contactsApi = (navigator as Navigator & { contacts?: { select: (properties: string[], options: { multiple: boolean }) => Promise<DeviceContactRecord[]> } }).contacts;
  if (!contactsApi?.select) throw new Error('Device contact access is unavailable.');
  return contactsApi.select(['name', 'tel', 'email', 'address', 'icon'], { multiple: true });
}
