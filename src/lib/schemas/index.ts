import { z } from "zod";

export const HabitKindSchema = z.enum(["tick", "count", "duration", "number"]);

export const HabitSchema = z.object({
  id: z.string().uuid().optional(),
  user_id: z.string().uuid().optional(),
  name: z.string().min(1),
  icon: z.string().optional().nullable(),
  grp: z.string().optional().nullable(),
  kind: HabitKindSchema,
  unit: z.string().optional().nullable(),
  target: z.number().positive().optional().nullable(),
  schedule: z.array(z.number().min(0).max(6)).default([1, 2, 3, 4, 5, 6, 7]),
  sort: z.number().default(0),
  archived_at: z.date().optional().nullable(),
  updated_at: z.date().optional(),
  deleted: z.boolean().default(false),
});

export const EntrySchema = z.object({
  habit_id: z.string().uuid(),
  user_id: z.string().uuid().optional(),
  day: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  value: z.number().min(0).default(1),
  note: z.string().optional().nullable(),
  updated_at: z.date().optional(),
});

export const DaySchema = z.object({
  user_id: z.string().uuid(),
  day: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  mood: z.number().min(0).max(10).optional().nullable(),
  note: z.string().optional().nullable(),
  updated_at: z.date().optional(),
});

export const ProfileSchema = z.object({
  id: z.string().uuid(),
  tz: z.string().default("Asia/Kolkata"),
  theme: z.string().optional().nullable(),
});

export type Habit = z.infer<typeof HabitSchema>;
export type Entry = z.infer<typeof EntrySchema>;
export type Day = z.infer<typeof DaySchema>;
export type Profile = z.infer<typeof ProfileSchema>;
