import { z } from 'zod';
import { DISASTER_TYPES, ROLES } from './types';

/* API-level validation. The database repeats the important rules
   (CHECK constraints, triggers, Mongo $jsonSchema) so nothing slips past. */

const trimmed = (min: number, max: number) => z.string().trim().min(min).max(max);

export const loginSchema = z.object({
  email: z.string().trim().email().max(120),
  password: z.string().min(1).max(200),
});

export const householdMemberSchema = z.object({
  name: z.string().trim().max(80).optional(),
  age: z.number().int().min(0).max(120).nullable().optional(),
  gender: z.enum(['female', 'male', 'other', 'unspecified']).default('unspecified'),
  injuries: z.array(trimmed(1, 60)).max(10).default([]),
  medical_needs: z.array(trimmed(1, 60)).max(10).default([]),
  is_pregnant: z.boolean().default(false),
  mobility: z.enum(['ok', 'limited', 'immobile']).default('ok'),
});

export const registerSosSchema = z.object({
  urgency: z.enum(['low', 'medium', 'high', 'critical']),
  description: trimmed(10, 1000),
  people_count: z.number().int().min(1).max(500),
  lat: z.number().min(-90).max(90),
  lon: z.number().min(-180).max(180),
  address_text: z.string().trim().max(200).optional(),
  disaster_type: z.enum(DISASTER_TYPES),
  needs: z.array(trimmed(1, 40)).max(15).default([]),
  household: z.array(householdMemberSchema).min(1).max(200),
  details: z.record(z.string(), z.union([z.string().max(200), z.number(), z.boolean()])).optional(),
  auto_match: z.boolean().optional(),
});

export const duplicateCheckSchema = z.object({
  description: trimmed(5, 1000),
  needs: z.array(z.string()).optional(),
  disaster_type: z.string().optional(),
  lat: z.number().min(-90).max(90),
  lon: z.number().min(-180).max(180),
});

export const noteSchema = z.object({ note: trimmed(2, 500) });

export const reserveSchema = z.object({
  sos_id: z.number().int().positive(),
  item_id: z.number().int().positive(),
  shelter_id: z.number().int().positive(),
  quantity: z.number().int().positive().max(100000),
});

export const dispatchSchema = z.object({
  reservation_id: z.number().int().positive(),
  vehicle_id: z.number().int().positive().nullable(),
  quantity: z.number().int().positive(),
});

export const restockSchema = z.object({
  item_id: z.number().int().positive(),
  shelter_id: z.number().int().positive(),
  quantity: z.number().int().positive().max(100000),
});

export const transferSchema = z.object({
  item_id: z.number().int().positive(),
  from_shelter: z.number().int().positive(),
  to_shelter: z.number().int().positive(),
  quantity: z.number().int().positive(),
}).refine((v) => v.from_shelter !== v.to_shelter, { message: 'Source and destination must differ', path: ['to_shelter'] });

export const thresholdSchema = z.object({ stock_id: z.number().int().positive(), reorder_threshold: z.number().int().min(0).max(100000) });

export const itemSchema = z.object({
  item_name: trimmed(2, 120),
  category: trimmed(2, 50),
  unit: trimmed(1, 20),
  usage_notes: trimmed(10, 500),
});

export const vehicleSchema = z.object({
  registration_no: z.string().trim().regex(/^[A-Za-z]{2}-\d{2}-[A-Za-z]{1,3}-\d{1,4}$/, 'Format like KA-01-AB-1234'),
  type: trimmed(2, 30),
  capacity_kg: z.number().positive().max(100000),
});

export const vehicleStatusSchema = z.object({ status: z.enum(['available', 'maintenance']) });

export const userSchema = z.object({
  name: trimmed(2, 120),
  email: z.string().trim().email().max(120),
  phone: z.string().trim().regex(/^\d{10}$/, '10 digits').optional().or(z.literal('')),
  role: z.enum(ROLES as [string, ...string[]]),
  shelter_id: z.number().int().positive().nullable().optional(),
  password: z
    .string()
    .min(8, 'at least 8 characters')
    .max(72)
    .regex(/[A-Z]/, 'needs an uppercase letter')
    .regex(/[0-9]/, 'needs a digit'),
});
