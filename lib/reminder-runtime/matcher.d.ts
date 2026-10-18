import { type ReminderMatch } from './conditions.js';
/** Worker entry for reminder JSON. Native regex and plugin judges share the worker's cancellation budget. */
export declare function executeReminderMatch(raw: unknown): Promise<ReminderMatch>;
