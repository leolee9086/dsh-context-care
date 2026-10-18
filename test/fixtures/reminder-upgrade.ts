/** Released persisted candidate fields; no legacy rule parser is involved. */
export function preV4State(format = 'reminder/v3') {
  return {
    seen: ['old-event'],
    candidates: ['pending', 'reserved', 'delivered', 'discarded'].map(status => ({
      id: `old-${status}`, sessionId: 'upgrade-session', sourceId: 'upgrade-source',
      sourceToken: 'old-registration', ruleId: 'notice', key: 'old-key',
      revision: 1, policy: 0, text: 'OBSOLETE_NOTICE', title: 'Old notice',
      eventId: 'old-event', rootCallId: 'old-event', status,
      ...(status === 'reserved' || status === 'delivered' ? { messageId: `sent-${status}` } : {}),
      evidence: {}, rule: { format, id: 'notice', title: 'Old notice', priority: 0,
        text: 'OBSOLETE_NOTICE', on: 'tool.succeeded', when: { tool: 'probe', arguments: {} },
        deliver: { model: { once: 'surface' } } },
    })),
    diagnostics: [{ status: 'delivered', eventId: 'older-event' }],
    windows: [{ key: 'window-receipt', until: 4102444800000, messageId: 'sent-reserved' }],
  }
}
