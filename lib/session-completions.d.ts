import type { Context } from '@deepseek-ai/cordis';
import type { Session } from '@deepseek-ai/dsh-session';
import { type CompletionFeedbackOptions } from '@leolee9086/dsh-rule-engine';
import type { SessionLog } from './session-log.js';
interface Options extends Omit<CompletionFeedbackOptions<Session>, 'cache' | 'facts' | 'render' | 'sessions'> {
    logs: SessionLog;
    sessions: Pick<Context['sessions'], 'get' | 'list' | 'flush'>;
}
/** Host 持有 Session 身份、只读切面和共享缓存；库持有候选、冷却、预约与回执。 */
export declare function createSessionCompletions(options: Options): {
    flush(sessionId?: string): Promise<void>;
    reconcile(session: Session): Promise<void>;
    collect(session: Session, request: import("@leolee9086/dsh-rule-engine").CompletionRequest): import("@leolee9086/dsh-rule-engine").CompletionSegment[];
    reserve(session: Session, segments: readonly {
        ruleId?: string;
        completionKey?: string;
    }[], callId: string): Promise<void>;
    rollback(_session: Session, callId: string): Promise<void>;
    dispatched(session: Session, _segments: readonly {
        ruleId?: string;
        completionKey?: string;
    }[], callId: string, _request: import("@leolee9086/dsh-rule-engine").CompletionRequest): Promise<void>;
    list(sessionId?: string): import("@leolee9086/dsh-rule-engine").CompletionNotice[];
    clear(): void;
    close(): void;
};
export {};
