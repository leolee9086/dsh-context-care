export const detectorFixture = {
  detectorVersion: 'fixture-1', locale: 'zh', maxTextChars: 20000, maxStatements: 200, maxEvidence: 10,
  maxPhrases: 10, maxPhraseChars: 30, phrases: [
    { id: 'claim', family: 'claim', literal: '不能宣称' }, { id: 'overlap', family: 'claim', literal: '宣称' },
    { id: 'action', family: 'action', literal: '不会做' }, { id: 'wording', family: 'wording', literal: '不写成' },
  ], metaPrefixes: ['规则匹配', '词表示例'],
  thresholds: [
    { minStatements: 5, minHits: 4, minHitStatements: 3, minDensity: 0.35, minFamilyStatements: 0 },
    { minStatements: 3, minHits: 3, minHitStatements: 3, minDensity: 0, minFamilyStatements: 3 },
  ], windowOutputs: 3, window: { minOutputs: 2, minHitsPerOutput: 2, minHits: 6, minFamilyOutputs: 2, minDensity: 0.25 },
  cooldownCompletedOutputs: 2, rearmHealthyOutputs: 2, maxDeliveries: 2,
}
