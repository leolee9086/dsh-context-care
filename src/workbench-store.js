import { StoredRules, createRuleStore } from '@leolee9086/dsh-rule-engine'
import { recordSecondaryFailure } from './secondary-failure.js'


/** 连接 DSH storageDomain；文档、变量、修订和事务发布策略由共享引擎持有。 */
export async function openWorkbenchStore(storageDomain, options) {
  const handle = await storageDomain.open({ name: 'context_care_workbench', version: 1, layout: 'per-record', tables: { sessions: { valueSchema: StoredRules } } })
  try {
    const table = handle.table('sessions')
    const store = createRuleStore({ ...options, entries: [...table.entries()], save: (id, value) => table.put(id, value) })
    return { ...store, async close() {
      try { await store.close() } catch (error) { try { await handle.close() } catch (secondary) { recordSecondaryFailure(error, secondary, 'workbench-close') }; throw error }
      await handle.close()
    } }
  } catch (error) { try { await handle.close() } catch (secondary) { recordSecondaryFailure(error, secondary, 'workbench-open') }; throw error }
}
