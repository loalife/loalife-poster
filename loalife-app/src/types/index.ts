export type MemberKind = 'pet' | 'person';
export type PetSpecies = 'dog' | 'cat' | 'other';
export type ItemType = 'dream' | 'work' | 'event' | 'social' | 'habit' | 'care';
export type CareKind =
  | 'vaccine' | 'rabies' | 'filaria' | 'trim'
  | 'hospital' | 'checkup' | 'groom' | 'lesson' | 'event' | 'other';
export type Repeat = 'none' | 'daily' | 'weekly' | 'monthly' | 'yearly';

export interface FamilyMember {
  id: string;
  name: string;
  emoji: string;
  kind: MemberKind;
  species?: PetSpecies;
  birthday?: string;
  createdAt: number;
}

export interface Item {
  id: string;
  memberId: string; // 'me' = self, or FamilyMember.id
  type: ItemType;
  careKind?: CareKind;
  title: string;
  emoji?: string;
  dueDate?: string; // YYYY-MM-DD
  time?: string;    // HH:MM
  repeat: Repeat;
  reminders?: number[]; // minutes before event
  done: boolean;
  completedAt?: number;
  photoUrl?: string;
  createdBy: string; // uid
  updatedAt: number;
  createdAt: number;
}

export interface Household {
  id: string;
  name: string;
  ownerUid: string;
  createdAt: number;
}

export interface HouseholdMemberRole {
  role: 'owner' | 'editor';
}
