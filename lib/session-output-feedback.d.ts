import type { Context } from '@deepseek-ai/cordis';
import type { Session } from '@deepseek-ai/dsh-session';
import { type OutputFeedbackBounds, type OutputFeedbackMetrics, type OutputFeedbackOptions } from '@leolee9086/dsh-rule-engine';
import type { SessionLog } from './session-log.js';
interface Options<D, M> extends Omit<OutputFeedbackOptions<Session, D, M>, 'sessions' | 'cache' | 'facts'> {
    sessions: Pick<Context['sessions'], 'get' | 'list' | 'flush'>;
    logs: SessionLog;
}
/** Host 只提供带释放边界的原生增量读取；反馈触发、时钟、预约和回执由库实现。 */
export declare function createSessionOutputFeedback<D extends OutputFeedbackBounds, M extends OutputFeedbackMetrics>(options: Options<D, M>): {
    observe(session: Session, _event: unknown, _route: unknown, rules: readonly import("@leolee9086/dsh-rule-engine").OutputFeedbackRule<D>[]): Promise<void>;
    collect(session: Session, request: import("@leolee9086/dsh-rule-engine").FeedbackRoute & {
        purpose?: string;
    }, rules: readonly import("@leolee9086/dsh-rule-engine").OutputFeedbackRule<D>[]): import("@leolee9086/dsh-rule-engine").OutputFeedbackSegment<M>[];
    reserve(session: Session, segments: readonly {
        ruleId?: string;
        feedbackKey?: string;
    }[], callId: string): Promise<void>;
    rollback(_session: Session, callId: string): Promise<void>;
    dispatched(session: Session, _segments: readonly {
        ruleId?: string;
        feedbackKey?: string;
    }[], callId: string, _request?: import("@leolee9086/dsh-rule-engine").FeedbackRoute): Promise<void>;
    flush(sessionId?: string): Promise<void>;
    list(sessionId?: string): import("@leolee9086/dsh-rule-engine").OutputFeedbackEpisode<M>[];
    clear(): void;
    close(): Promise<void>;
};
export {};
