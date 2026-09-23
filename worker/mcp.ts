import { McpServer } from "@modelcontextprotocol/server";
import { createMcpHandler } from "agents/mcp/server";
import { z } from "zod";
import { DateStr, TimeStr } from "../shared/entities";
import { PALETTE_KEYS } from "../shared/palette";
import * as todo from "./services/todo";

export interface McpProps {
  userId: string;
}

const Color = z.enum(PALETTE_KEYS).describe(`One of: ${PALETTE_KEYS.join(", ")}`);
const ListRef = z.string().describe("List id, or its name (case-insensitive)");
const DateArg = DateStr.describe("YYYY-MM-DD");
const TimeArg = TimeStr.describe("HH:MM, 24-hour");
const EventScope = z
  .enum(["occurrence", "series"])
  .describe('For recurring events: "occurrence" changes only the one on occurrence_date, "series" changes every occurrence');
const RRule = z
  .string()
  .describe(
    "Recurrence as an RRULE subset: FREQ=DAILY|WEEKLY|MONTHLY|YEARLY, optional INTERVAL=n, BYDAY=MO,TU,... (weekly only), and UNTIL=YYYYMMDD or COUNT=n. Example: FREQ=WEEKLY;BYDAY=MO,WE",
  );

const TIME_NOTE =
  "Dates and times are floating local wall-clock values in the user's timezone (get_agenda reports it and today's date).";
const STD_NOTE =
  'When the account is connected to save-the-date, entries with source "save-the-date" come from that separate app and are read-only: they cannot be edited or deleted here.';

type Result = { content: { type: "text"; text: string }[]; isError?: boolean };

async function run(fn: () => Promise<unknown>): Promise<Result> {
  try {
    return { content: [{ type: "text", text: JSON.stringify(await fn(), null, 2) }] };
  } catch (err) {
    if (err instanceof todo.ToolError) return { content: [{ type: "text", text: err.message }], isError: true };
    throw err;
  }
}

export function buildServer(env: Env, userId: string): McpServer {
  const s: todo.Scope = { env, userId };
  const server = new McpServer({ name: "todo", version: "1.0.0" });
  const readOnly = { readOnlyHint: true };

  server.registerTool(
    "get_agenda",
    {
      description: `The day's rundown: overdue items (on today only), all-day and multi-day entries, timed events and timed items in order, then items due without a time. Covers \`days\` days from \`date\` (default today). ${TIME_NOTE} ${STD_NOTE}`,
      inputSchema: z.object({ date: DateArg.optional(), days: z.number().int().min(1).max(14).optional() }),
      annotations: readOnly,
    },
    ({ date, days }) => run(() => todo.getAgenda(s, date, days ?? 1)),
  );

  server.registerTool(
    "list_lists",
    { description: "All todo lists with their open and completed item counts.", inputSchema: z.object({}), annotations: readOnly },
    () => run(() => todo.listLists(s)),
  );

  server.registerTool(
    "create_list",
    { description: "Create a todo list.", inputSchema: z.object({ name: z.string(), color: Color.optional() }) },
    ({ name, color }) => run(() => todo.createList(s, name, color)),
  );

  server.registerTool(
    "update_list",
    { description: "Rename or recolour a list.", inputSchema: z.object({ list: ListRef, name: z.string().optional(), color: Color.optional() }) },
    ({ list, ...patch }) => run(() => todo.updateList(s, list, patch)),
  );

  server.registerTool(
    "delete_list",
    { description: "Delete a list and every item in it.", inputSchema: z.object({ list: ListRef }), annotations: { destructiveHint: true } },
    ({ list }) => run(() => todo.deleteList(s, list)),
  );

  server.registerTool(
    "list_items",
    {
      description: `Todo items, in display order (overdue and soonest due first, undated last). ${TIME_NOTE}`,
      inputSchema: z.object({
        list: ListRef.optional(),
        status: z.enum(["open", "completed", "all"]).optional().describe("Default open"),
        due_from: DateArg.optional(),
        due_to: DateArg.optional(),
      }),
      annotations: readOnly,
    },
    (filter) => run(() => todo.listItems(s, filter)),
  );

  server.registerTool(
    "create_item",
    {
      description: `Add a todo item to a list. due_time needs due_date. ${TIME_NOTE}`,
      inputSchema: z.object({
        list: ListRef,
        title: z.string(),
        notes: z.string().optional(),
        due_date: DateArg.optional(),
        due_time: TimeArg.optional(),
      }),
    },
    (input) => run(() => todo.createItem(s, input)),
  );

  server.registerTool(
    "update_item",
    {
      description: `Edit a todo item: title, notes, due date/time (null clears), completed (true marks it done, false reopens it), or move it to another list. ${TIME_NOTE}`,
      inputSchema: z.object({
        id: z.string(),
        title: z.string().optional(),
        notes: z.string().optional(),
        due_date: DateArg.nullable().optional(),
        due_time: TimeArg.nullable().optional(),
        completed: z.boolean().optional(),
        list: ListRef.optional(),
      }),
    },
    ({ id, ...patch }) => run(() => todo.updateItem(s, id, patch)),
  );

  server.registerTool(
    "delete_item",
    { description: "Delete a todo item.", inputSchema: z.object({ id: z.string() }), annotations: { destructiveHint: true } },
    ({ id }) => run(() => todo.deleteItem(s, id)),
  );

  server.registerTool(
    "list_events",
    {
      description: `Calendar events between two dates (inclusive, at most 366 days), with recurring events expanded into occurrences. Each occurrence has event_id and occurrence_date, which update_event and delete_event take. ${TIME_NOTE} ${STD_NOTE}`,
      inputSchema: z.object({ from: DateArg, to: DateArg }),
      annotations: readOnly,
    },
    ({ from, to }) => run(() => todo.listEvents(s, from, to)),
  );

  server.registerTool(
    "create_event",
    {
      description: `Create a calendar event. Give start_time for a timed event (end_time defaults to an hour later; an end_time before start_time ends the next day), or omit it for an all-day event (end_date for several days). ${TIME_NOTE}`,
      inputSchema: z.object({
        title: z.string(),
        start_date: DateArg,
        start_time: TimeArg.optional(),
        end_date: DateArg.optional(),
        end_time: TimeArg.optional(),
        all_day: z.boolean().optional(),
        notes: z.string().optional(),
        color: Color.optional(),
        rrule: RRule.optional(),
      }),
    },
    (input) => run(() => todo.createEvent(s, input)),
  );

  server.registerTool(
    "update_event",
    {
      description: `Edit a calendar event. For a recurring event pass scope, and occurrence_date (from list_events) when scope is "occurrence". Omitted fields stay as they are; moving a timed event keeps its duration unless end_time is given. rrule changes need scope "series" (null stops repeating). ${TIME_NOTE} ${STD_NOTE}`,
      inputSchema: z.object({
        id: z.string().describe("event_id"),
        scope: EventScope.optional().describe('Default "occurrence" when occurrence_date is given, else "series"; ignored for non-recurring events'),
        occurrence_date: DateArg.optional(),
        title: z.string().optional(),
        notes: z.string().optional(),
        color: Color.optional(),
        all_day: z.boolean().optional(),
        start_date: DateArg.optional(),
        start_time: TimeArg.nullable().optional(),
        end_date: DateArg.optional(),
        end_time: TimeArg.nullable().optional(),
        rrule: RRule.nullable().optional(),
      }),
    },
    ({ id, scope, occurrence_date, ...patch }) =>
      run(() => todo.updateEvent(s, id, scope ?? (occurrence_date ? "occurrence" : "series"), occurrence_date, patch)),
  );

  server.registerTool(
    "delete_event",
    {
      description: `Delete a calendar event. For a recurring event, scope "occurrence" with occurrence_date removes one occurrence; "series" removes them all. ${STD_NOTE}`,
      inputSchema: z.object({
        id: z.string().describe("event_id"),
        scope: EventScope.optional().describe('Default "occurrence" when occurrence_date is given, else "series"'),
        occurrence_date: DateArg.optional(),
      }),
      annotations: { destructiveHint: true },
    },
    ({ id, scope, occurrence_date }) =>
      run(() => todo.deleteEvent(s, id, scope ?? (occurrence_date ? "occurrence" : "series"), occurrence_date)),
  );

  server.registerTool(
    "search",
    {
      description: "Find todo items and events whose title or notes contain the query (case-insensitive).",
      inputSchema: z.object({ query: z.string() }),
      annotations: readOnly,
    },
    ({ query }) => run(() => todo.search(s, query)),
  );

  return server;
}

/** The OAuth provider's API handler: ctx.props carries the user the token was granted for. */
export const mcpApiHandler = {
  fetch(request: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
    const { userId } = ctx.props as McpProps;
    return createMcpHandler(() => buildServer(env, userId), { route: "/mcp" })(request, env, ctx);
  },
};
