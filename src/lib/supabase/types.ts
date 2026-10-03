export type Json =
  | string
  | number
  | boolean
  | null
  | { [key: string]: Json | undefined }
  | Json[];

export type HabitKind = "tick" | "count" | "duration" | "number";

export type HabitRow = {
  id: string;
  user_id: string;
  name: string;
  icon: string | null;
  grp: string | null;
  kind: HabitKind;
  unit: string | null;
  target: number | null;
  schedule: number[];
  sort: number;
  archived_at: string | null;
  updated_at: string;
  deleted: boolean;
}

export type EntryRow = {
  habit_id: string;
  user_id: string;
  day: string;
  value: number;
  note: string | null;
  updated_at: string;
}

export type DayRow = {
  user_id: string;
  day: string;
  mood: number | null;
  note: string | null;
  updated_at: string;
}

export type ProfileRow = {
  id: string;
  tz: string;
  theme: string | null;
  rollover_hour: number;
  streak_threshold: number;
  freeze_per_week: number;
  display_name: string | null;
  avatar_url: string | null;
  created_at: string;
  updated_at: string;
}

/** The tables the sync engine touches, keyed by table name. */
export type SyncTables = {
  habits: HabitRow;
  entries: EntryRow;
  days: DayRow;
  profiles: ProfileRow;
};

export type SyncTable = keyof SyncTables;
/** Tables the sync engine replicates (profiles are pushed via a server function). */
export type SyncTableName = Exclude<SyncTable, "profiles">;

type Relationships = [];

export type Database = {
  public: {
    Tables: {
      habits: {
        Row: HabitRow;
        Insert: Partial<HabitRow> & { user_id: string; id?: string };
        Update: Partial<HabitRow>;
        Relationships: Relationships;
      };
      entries: {
        Row: EntryRow;
        Insert: Partial<EntryRow> & {
          habit_id: string;
          user_id: string;
          day: string;
        };
        Update: Partial<EntryRow>;
        Relationships: Relationships;
      };
      days: {
        Row: DayRow;
        Insert: Partial<DayRow> & { user_id: string; day: string };
        Update: Partial<DayRow>;
        Relationships: Relationships;
      };
      profiles: {
        Row: ProfileRow;
        Insert: Partial<ProfileRow> & { id: string };
        Update: Partial<ProfileRow>;
        Relationships: Relationships;
      };
    };
    Views: Record<string, never>;
    Functions: {
      delete_account: { Args: Record<string, never>; Returns: undefined };
    };
    Enums: Record<string, never>;
    CompositeTypes: Record<string, never>;
  };
};