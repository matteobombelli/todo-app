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

export const SettingsBody = z.object({ timezone: z.string().refine(isTimeZone, "Unknown timezone") });
export type SettingsBody = z.input<typeof SettingsBody>;

export interface User {
  id: string;
  email: string;
  timezone: string;
}
