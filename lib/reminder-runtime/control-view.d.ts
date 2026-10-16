import type { ReminderService } from './runtime.js';
/** Keep policy fields while presenting only reminders applicable to the current recipient. */
export declare function visibleReminderControls<Source extends {
    sourceId: string;
    registration: string;
    rules: {
        id: string;
    }[];
}>(sources: Source[], catalog: Awaited<ReturnType<ReminderService['catalog']>>): Source[];
