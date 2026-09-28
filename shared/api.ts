import { z } from "zod";
import { isTimeZone } from "./dates";

export const API_PREFIX = "/api";

// Also the users.timezone column default in migrations/0001_init.sql.
export const DEFAULT_TIMEZONE = "America/Los_Angeles";

const Email = z.string().trim().toLowerCase().pipe(z.email());
const Password = z.string().min(8).max(200);

// Body types are the wire (input) shape, i.e. what a client sends.
export const RegisterBody = z.object({ email: Email, password: Password, inviteCode: z.string().min(1) });
export type RegisterBody = z.input<typeof RegisterBody>;

export const LoginBody = z.object({ email: Email, password: z.string().min(1).max(200) });
export type LoginBody = z.input<typeof LoginBody>;

// Lead times offered for timed-event reminders, in minutes before the start.
export const EVENT_REMINDER_MINUTES = [0, 5, 10, 15, 30, 60] as const;

export const SettingsBody = z
  .object({
    timezone: z.string().refine(isTimeZone, "Unknown timezone").optional(),
    event_reminder_minutes: z
      .number()
      .refine((n) => (EVENT_REMINDER_MINUTES as readonly number[]).includes(n), "Unsupported reminder time")
      .optional(),
  })
  .refine((b) => b.timezone !== undefined || b.event_reminder_minutes !== undefined, "Nothing to update");
export type SettingsBody = z.input<typeof SettingsBody>;

export interface User {
  id: string;
  email: string;
  timezone: string;
  event_reminder_minutes: number;
}

export const PushSubscriptionBody = z.object({
  endpoint: z.url({ protocol: /^https$/ }).max(2048),
  keys: z.object({ p256dh: z.string().min(1).max(200), auth: z.string().min(1).max(200) }),
});
export type PushSubscriptionBody = z.input<typeof PushSubscriptionBody>;

export const PushUnsubscribeBody = z.object({ endpoint: z.string().max(2048) });
export type PushUnsubscribeBody = z.input<typeof PushUnsubscribeBody>;
