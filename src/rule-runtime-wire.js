import { z } from 'zod'

const Id = z.string().min(1)
const Rule = z.object({ id: Id, revision: z.number().int().positive(), title: z.string(), on: z.array(z.string()),
  select: z.json(), match: z.json(), actions: z.array(z.object({ id: Id, kind: Id, stage: Id, dependsOn: z.array(z.string()),
    template: z.string().optional(), executorRef: z.string().optional(), inputs: z.json().optional(), target: z.json().optional(), patch: z.json().optional() }).passthrough()) }).passthrough()
const Entry = z.object({ id: Id, title: z.string(), revision: z.number().int().positive(), template: z.string(), activation: z.json(), select: z.json(), target: z.json() }).passthrough()
export const RunWire = z.object({ id: Id, sourceId: z.string(), ruleId: z.string(), actionId: z.string(), kind: z.string(),
  status: z.enum(['queued', 'waiting-approval', 'running', 'succeeded', 'failed', 'skipped', 'cancelled', 'unknown']),
  reason: z.string().nullable(), delivery: z.string(), createdAt: z.number(), updatedAt: z.number(), sourceSeqs: z.array(z.number().int()),
  inputs: z.json(), result: z.json().optional(), cancellationRequested: z.boolean().optional() }).passthrough()
export const RuntimeWire = z.object({ sessionId: Id, snapshotId: Id, turnId: z.string(), storageError: z.string().nullable(), fileError: z.string().nullable(),
  documents: z.array(z.object({ id: Id, revision: z.number().int().positive(), title: z.string(), sourceId: Id, plugin: z.string(), registration: z.string(),
    rules: z.array(Rule), entries: z.array(Entry), variables: z.array(z.object({ name: Id, scope: z.string(), type: z.string(), description: z.string(), value: z.json() })),
    partials: z.array(z.object({ name: Id, revision: z.number().int().positive(), template: z.string() })) })),
  executors: z.array(z.object({ executorRef: Id, plugin: z.string(), toolName: Id }).passthrough()),
  dispatches: z.array(z.object({ key: Id, status: z.enum(['reserved', 'handoff', 'unknown', 'settled']), callId: Id, updatedAt: z.number(), reason: z.string().optional() })),
  runs: z.array(RunWire), total: z.number().int().nonnegative(), offset: z.number().int().nonnegative(), nextOffset: z.number().int().nonnegative().nullable(),
  counts: z.record(z.string(), z.number().int().nonnegative()) })
const InjectionBudget = z.object({ kind: z.enum(['estimate', 'unknown']), tokens: z.number().int().nonnegative().nullable(), limit: z.number().int().nonnegative().nullable() }).strict()
  .refine(value => (value.kind === 'unknown') === (value.tokens === null), 'invalid token estimate availability')
const RequestImpact = z.object({ basis: z.literal('public-request-json-estimate'), providerSerialization: z.literal('unknown'), cacheHitTokens: z.null(),
  beforeBytes: z.number().int().nonnegative(), afterBytes: z.number().int().nonnegative(), commonPrefixBytes: z.number().int().nonnegative(),
  firstChangedByte: z.number().int().nonnegative().nullable(), changedSuffixBytes: z.number().int().nonnegative() }).strict()
export const PreviewWire = z.object({ sessionId: Id, snapshotId: Id, injectedChars: z.number().nonnegative(), documents: z.array(z.object({ id: Id, revision: z.number().int() })),
  injectionBudget: InjectionBudget.optional(), impact: RequestImpact.optional(),
  records: z.array(z.object({ sourceId: Id, ruleId: Id, actionId: Id.optional(), status: z.enum(['planned', 'skipped']), reason: z.string().optional() }).passthrough()), scheduled: z.array(z.object({ ruleId: Id, actionId: Id, waitingForDependencies: z.boolean() }).passthrough()),
  diff: z.object({ before: z.object({ messages: z.array(z.json()), system: z.string().optional() }), after: z.object({ messages: z.array(z.json()), system: z.string().optional() }) }) })
