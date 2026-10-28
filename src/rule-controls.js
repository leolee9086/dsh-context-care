import { StoredControls, createRuleControls } from '@leolee9086/dsh-rule-engine'

import { recordSecondaryFailure } from './secondary-failure.js'

/** 打开原生偏好存储，策略校验和 ACK 发布由共享引擎处理。 */
export async function openRuleControls(storageDomain, options = {}) {
  const handle = await storageDomain.open({ name: 'context_care_controls', version: 1, layout: 'per-record', tables: { sessions: { valueSchema: StoredControls } } })
  try {
    const table = handle.table('sessions')
    const controls = createRuleControls({ ...options, entries: [...table.entries()], save: (id, value) => table.put(id, value) })
    return { ...controls, async close() {
      try { await controls.close() }
      catch (error) { try { await handle.close() } catch (secondary) { recordSecondaryFailure(error, secondary, 'controls shutdown') }; throw error }
      await handle.close()
    } }
  } catch (error) { try { await handle.close() } catch (secondary) { recordSecondaryFailure(error, secondary, 'controls rollback') }; throw error }
}
