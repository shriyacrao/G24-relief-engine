import type { ObjectId } from 'mongodb';

export type Role = 'Relief Coordinator' | 'Field Volunteer';
export const ROLES: Role[] = ['Relief Coordinator', 'Field Volunteer'];

export type Urgency = 'low' | 'medium' | 'high' | 'critical';
export const URGENCIES: Urgency[] = ['critical', 'high', 'medium', 'low'];

export type SosStatus = 'unmatched' | 'matched' | 'resolved';

export interface SessionUser {
  uid: number;
  name: string;
  email: string;
  role: Role;
  shelterId: number | null;
}

export const DISASTER_TYPES = ['flood', 'landslide', 'building_collapse', 'fire', 'cyclone', 'other'] as const;
export type DisasterType = (typeof DISASTER_TYPES)[number];

export const NEED_OPTIONS = [
  'drinking water', 'food', 'baby food', 'medicines', 'first aid', 'blankets',
  'tarpaulin / roof cover', 'hygiene kit', 'evacuation', 'ambulance', 'shelter bed',
] as const;

export interface HouseholdMember {
  name?: string;
  age?: number | null;
  gender?: 'female' | 'male' | 'other' | 'unspecified';
  injuries?: string[];
  medical_needs?: string[];
  is_pregnant?: boolean;
  mobility?: 'ok' | 'limited' | 'immobile';
}

export interface IntakeForm {
  _id?: ObjectId;
  sos_id: number | null;
  status: 'draft' | 'linked';
  disaster_type: DisasterType;
  location: { type: 'Point'; coordinates: [number, number] };
  address_text?: string;
  reporter: { user_id: number; name: string };
  household: HouseholdMember[];
  needs: string[];
  details?: Record<string, unknown>;
  timeline: { at: Date; by: { user_id: number; name: string }; note: string }[];
  created_at: Date;
  updated_at: Date;
}
