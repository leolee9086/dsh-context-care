/** Keep policy fields while presenting only reminders applicable to the current recipient. */
export function visibleReminderControls(sources, catalog) {
    const visible = new Map(catalog.map(source => [source.sourceId, new Set(source.rules.map(rule => rule.id))]));
    return sources.flatMap(source => {
        if (source.registration !== 'reminderRules')
            return [source];
        const rules = visible.get(source.sourceId);
        if (!rules)
            return [];
        return [{ ...source, rules: source.rules.filter(rule => rules.has(rule.id)) }];
    });
}
//# sourceMappingURL=control-view.js.map