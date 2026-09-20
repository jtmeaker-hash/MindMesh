export type RelationshipType =
  | 'Family'
  | 'Friend'
  | 'Partner'
  | 'Coworker'
  | 'Manager'
  | 'Medical'
  | 'Professional'
  | 'Emergency Contact'
  | 'Other'
  | (string & {});

export const DEFAULT_RELATIONSHIPS = [
  'Family',
  'Friend',
  'Partner',
  'Coworker',
  'Manager',
  'Medical',
  'Professional',
  'Emergency Contact',
  'Other',
] as const;

export interface Contact {
  id: string;
  fullName: string;
  displayName?: string; // Preferred name
  phoneNumber: string;
  secondaryPhoneNumber?: string;
  email?: string;
  address?: string;
  relationship: string;
  photo?: string; // Base64 data URL or local image string
  notes?: string;
  birthday?: string; // YYYY-MM-DD
  category?: string; // Tag/category
  createdAt: string;
  updatedAt: string;
}

export type ContactSortOption = 'name_asc' | 'name_desc' | 'relationship' | 'recent';
