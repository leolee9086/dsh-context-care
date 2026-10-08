window.__ModuleLoader__.load({
	id: "dsh-context-care",
	factory: (require) => {
		var module = { exports: {} };
		var exports = module.exports;
		Object.defineProperty(exports, Symbol.toStringTag, { value: "Module" });
		//#region \0rolldown/runtime.js
		var __create = Object.create;
		var __defProp = Object.defineProperty;
		var __getOwnPropDesc = Object.getOwnPropertyDescriptor;
		var __getOwnPropNames = Object.getOwnPropertyNames;
		var __getProtoOf = Object.getPrototypeOf;
		var __hasOwnProp = Object.prototype.hasOwnProperty;
		var __copyProps = (to, from, except, desc) => {
			if (from && typeof from === "object" || typeof from === "function") for (var keys = __getOwnPropNames(from), i = 0, n = keys.length, key; i < n; i++) {
				key = keys[i];
				if (!__hasOwnProp.call(to, key) && key !== except) __defProp(to, key, {
					get: ((k) => from[k]).bind(null, key),
					enumerable: !(desc = __getOwnPropDesc(from, key)) || desc.enumerable
				});
			}
			return to;
		};
		var __toESM = (mod, isNodeMode, target) => (target = mod != null ? __create(__getProtoOf(mod)) : {}, __copyProps(isNodeMode || !mod || !mod.__esModule || !__hasOwnProp.call(mod, "default") ? __defProp(target, "default", {
			value: mod,
			enumerable: true
		}) : target, mod));
		//#endregion
		let react = require("react");
		react = __toESM(react, 1);
		//#region src/care-styles.js
		const css = `
:is([data-care-panel], [data-care-entry], [data-care-card], [data-context-care]) {
  font-family: inherit; font-size: var(--dsh-content-font-size-secondary, 13px);
  line-height: calc(20px + var(--dsh-content-font-delta-secondary, 0px));
  font-variant-numeric: tabular-nums; color: var(--dsw-alias-label-secondary);
}
[data-care-panel] { display: flex; flex-direction: column; height: 100%; min-height: 0; min-width: 0; box-sizing: border-box; container-type: inline-size; }
[data-care-panel] :is(h3,h4,p,pre) { margin: 0; }
[data-care-panel] :is(h3,h4) { color: var(--dsw-alias-label-primary); font-size: inherit; font-weight: 600; }
[data-care-panel] > header { display: flex; align-items: center; justify-content: space-between; gap: 12px; padding: 16px 20px; border-bottom: 1px solid var(--dsw-alias-border-l2); }
[data-care-panel] > main { flex: 1; min-height: 0; overflow: auto; padding: 20px; scrollbar-width: thin; scrollbar-color: var(--dsw-alias-scrollbar-bg-l2) transparent; }
[data-care-panel] > footer { display: flex; flex-wrap: wrap; align-items: center; justify-content: space-between; gap: 8px; padding: 12px 16px; border-top: 1px solid var(--dsw-alias-border-l2); }
:is([data-care-panel], [data-care-entry], [data-care-card]) button {
  display: inline-flex; align-items: center; justify-content: center; gap: 6px; box-sizing: border-box;
  min-height: 32px; padding: 5px 10px; appearance: none; border: 1px solid transparent;
  border-radius: var(--dsw-radius-sm, 6px); background: transparent; color: var(--dsw-alias-label-secondary); font: inherit; cursor: pointer;
}
:is([data-care-panel], [data-care-entry], [data-care-card]) button:hover:not(:disabled) { background: var(--dsw-alias-interactive-bg-hover); color: var(--dsw-alias-label-primary); }
:is([data-care-panel], [data-care-entry], [data-care-card]) button:active:not(:disabled) { background: var(--dsw-alias-interactive-bg-active); }
[data-care-panel] button:disabled { opacity: .45; cursor: not-allowed; }
:is([data-care-panel], [data-care-entry], [data-care-card]) :is(button,summary,input):focus-visible { outline: var(--dsw-focus-ring-width, 2px) solid var(--dsw-focus-ring-color, var(--dsw-alias-state-business-primary)); outline-offset: 2px; }
[data-care-entry] { display: inline-flex; align-items: center; position: relative; flex: none; gap: 2px; }
[data-care-entry] button { width: 32px; height: 32px; padding: 5px; }
[data-care-panel] .care-intro { color: var(--dsw-alias-label-tertiary); margin-bottom: 24px; }
[data-care-panel] .care-section-heading, [data-care-panel] .care-budget-heading { display: flex; align-items: center; justify-content: space-between; gap: 12px; margin-bottom: 12px; }
[data-care-panel] .care-record-list { list-style: none; padding: 0; margin: 0; display: grid; gap: 10px; }
[data-care-panel] button.care-record { display: flex; width: 100%; flex-direction: column; align-items: stretch; text-align: start; gap: 8px; padding: 16px; border: 1px solid var(--dsw-alias-border-l2); border-radius: var(--dsw-radius-md, 10px); background: var(--dsw-alias-bg-layer-2); }
[data-care-panel] .care-record-top { display: flex; align-items: baseline; justify-content: space-between; gap: 12px; }
[data-care-panel] .care-record-top strong { color: var(--dsw-alias-label-primary); font-weight: 600; }
[data-care-panel] .care-record-top time { color: var(--dsw-alias-label-tertiary); font-size: .92em; flex-shrink: 0; }
[data-care-panel] .care-record-change { font-size: 1.15em; color: var(--dsw-alias-label-primary); }
[data-care-panel] .care-record-preview { overflow: hidden; display: -webkit-box; -webkit-line-clamp: 2; -webkit-box-orient: vertical; overflow-wrap: anywhere; }
[data-care-panel] .care-record-bottom { display: flex; flex-wrap: wrap; align-items: center; justify-content: space-between; gap: 6px; font-size: .92em; color: var(--dsw-alias-label-tertiary); }
[data-care-panel] .care-back { margin: -6px 0 16px -8px; }
[data-care-panel] .care-detail-heading { margin-bottom: 24px; }
[data-care-panel] .care-detail-heading h3 { font-size: 1.45em; line-height: 1.5; margin: 6px 0 10px; }
[data-care-panel] .care-eyebrow { color: var(--dsw-alias-label-tertiary); font-size: .92em; }
[data-care-panel] .care-section { padding-top: 20px; margin-top: 20px; border-top: 1px solid var(--dsw-alias-border-l2); }
[data-care-panel] .care-section p { margin: 8px 0; }
[data-care-panel] .care-muted { color: var(--dsw-alias-label-tertiary); }
[data-care-panel] .care-fields { display: grid; grid-template-columns: minmax(80px, .85fr) minmax(0, 1.4fr); gap: 8px 16px; margin: 12px 0; }
[data-care-panel] .care-fields .care-fields { margin: 0; display: block; }
[data-care-panel] dt { color: var(--dsw-alias-label-tertiary); overflow-wrap: anywhere; }
[data-care-panel] dd { margin: 0; min-width: 0; overflow-wrap: anywhere; }
[data-care-panel] .care-evidence { border-left: 2px solid var(--dsw-alias-border-l3); padding-left: 12px; margin: 16px 0; }
[data-care-panel] .care-evidence h4 { font-weight: 500; }
[data-care-panel] .care-reader { border: 1px solid var(--dsw-alias-border-l2); border-radius: var(--dsw-radius-md, 10px); overflow: hidden; background: var(--dsw-alias-bg-layer-2); }
[data-care-panel] .care-prompt-text { padding: 14px; white-space: pre-wrap; overflow-wrap: anywhere; font: inherit; line-height: 1.7; color: var(--dsw-alias-label-primary); max-height: 280px; overflow: auto; scrollbar-width: thin; }
[data-care-panel] .care-prompt-text[data-full] { max-height: none; }
[data-care-panel] .care-reader-tools { display: flex; align-items: center; flex-wrap: wrap; gap: 6px; padding: 4px 8px; border-top: 1px solid var(--dsw-alias-border-l2); }
[data-care-panel] .care-request { padding: 12px 0; border-bottom: 1px solid var(--dsw-alias-border-l2); }
[data-care-panel] .care-request:first-child { padding-top: 0; }
[data-care-panel] .care-request:last-child { border-bottom: 0; padding-bottom: 0; }
[data-care-panel] .care-route { overflow-wrap: anywhere; color: var(--dsw-alias-label-primary); }
[data-care-panel] .care-request-state { display: flex; flex-wrap: wrap; align-items: center; gap: 12px; margin-top: 6px; }
[data-care-panel] .care-badge { display: inline-flex; align-items: center; gap: 5px; color: var(--dsw-alias-label-tertiary); }
[data-care-panel] .care-badge::before { content: ''; width: 6px; height: 6px; flex-shrink: 0; border-radius: 50%; background: currentColor; }
[data-care-panel] .care-badge[data-tone='success'] { color: var(--dsw-alias-state-success-primary); }
[data-care-panel] .care-badge[data-tone='error'] { color: var(--dsw-alias-state-error-primary); }
[data-care-panel] .care-badge[data-tone='working'] { color: var(--dsw-alias-state-business-primary); }
[data-care-panel] .care-badge[data-tone='warning'] { color: var(--dsw-alias-state-warn-label); }
[data-care-panel] .care-source-heading { display: flex; align-items: center; justify-content: space-between; flex-wrap: wrap; gap: 8px; }
[data-care-panel] .care-source-heading button, [data-care-panel] .care-jump button { border-color: var(--dsw-alias-border-l2); }
[data-care-panel] .care-sources input { box-sizing: border-box; width: 100%; margin: 12px 0 4px; border: 1px solid var(--dsw-alias-border-l2); border-radius: var(--dsw-radius-sm, 6px); padding: 8px 10px; background: var(--dsw-alias-bg-layer-2); font: inherit; color: var(--dsw-alias-label-primary); }
[data-care-panel] .care-source-rows { list-style: none; padding: 0; margin: 0; }
[data-care-panel] .care-source-rows > li { padding: 10px 0; border-bottom: 1px solid var(--dsw-alias-border-l2); }
[data-care-panel] .care-source-row { display: flex; align-items: flex-start; justify-content: space-between; gap: 8px; }
[data-care-panel] .care-source-name { flex-direction: column; align-items: flex-start; text-align: start; padding-left: 0; }
[data-care-panel] .care-source-preview { margin: 4px 0 0; color: var(--dsw-alias-label-tertiary); overflow-wrap: anywhere; }
[data-care-panel] .care-source-excerpt { margin-top: 8px; background: var(--dsw-alias-bg-layer-2); border-radius: var(--dsw-radius-sm, 6px); }
[data-care-panel] .care-source-pager { display: flex; align-items: center; justify-content: space-between; flex-wrap: wrap; gap: 6px; margin-top: 12px; }
[data-care-panel] .care-jump { display: flex; align-items: center; flex-wrap: wrap; gap: 8px; }
[data-care-panel] .care-jump [role='status'] { font-size: .92em; color: var(--dsw-alias-state-success-primary); }
[data-care-panel] .care-jump [role='alert'] { flex-basis: 100%; }
[data-care-panel] .care-result, [data-care-panel] .care-budget { padding: 18px; border: 1px solid var(--dsw-alias-border-l2); border-radius: var(--dsw-radius-md, 10px); background: var(--dsw-alias-bg-layer-2); }
[data-care-panel] .care-budget { margin-bottom: 24px; }
[data-care-panel] .care-change { display: grid; grid-template-columns: minmax(0, 1fr) 24px minmax(0, 1fr); align-items: center; gap: 8px; margin: 14px 0; }
[data-care-panel] .care-change > div { display: flex; flex-direction: column; gap: 4px; }
[data-care-panel] .care-change strong { font-size: 1.9em; font-weight: 500; line-height: 1.3; color: var(--dsw-alias-label-primary); }
[data-care-panel] .care-change > div > span, [data-care-panel] .care-change-arrow { color: var(--dsw-alias-label-tertiary); }
[data-care-panel] .care-saving { border-top: 1px solid var(--dsw-alias-border-l2); padding-top: 12px; }
[data-care-panel] .care-figures { display: flex; align-items: baseline; flex-wrap: wrap; gap: 6px; margin: 10px 0 6px; }
[data-care-panel] .care-figures strong { font-size: 2em; line-height: 1.4; font-weight: 500; color: var(--dsw-alias-label-primary); }
[data-care-panel] .care-meter { position: relative; height: 6px; margin: 14px 0; border-radius: 4px; background: var(--dsw-alias-interactive-bg-hover); }
[data-care-panel] .care-meter > span { display: block; height: 100%; width: var(--care-fill); border-radius: 4px; background: var(--dsw-alias-state-business-primary); }
[data-care-panel] .care-meter > i { position: absolute; top: -3px; width: 2px; height: 12px; background: var(--dsw-alias-label-secondary); }
[data-care-panel] .care-meter[data-over-limit] > span { background: var(--dsw-alias-state-error-primary); }
[data-care-panel] .care-coverage-summary { display: flex; flex-wrap: wrap; gap: 8px 20px; margin-bottom: 12px; }
[data-care-panel] .care-coverage-summary strong { color: var(--dsw-alias-label-primary); }
[data-care-panel] .care-timeline { list-style: none; border-left: 1px solid var(--dsw-alias-border-l3); margin: 0 0 0 5px; padding: 0 0 0 16px; }
[data-care-panel] .care-timeline li { position: relative; padding: 0 0 16px; }
[data-care-panel] .care-timeline li::before { content: ''; position: absolute; width: 7px; height: 7px; background: var(--dsw-alias-state-business-primary); border-radius: 50%; left: -20px; top: 7px; }
[data-care-panel] .care-timeline .care-jump { margin-top: 8px; }
[data-care-panel] .care-technical { margin-top: 14px; padding-top: 10px; border-top: 1px solid var(--dsw-alias-border-l2); }
[data-care-panel] .care-technical summary { cursor: pointer; color: var(--dsw-alias-label-tertiary); }
[data-care-panel] .care-raw { border-top: 1px solid var(--dsw-alias-border-l2); padding-top: 12px; margin-top: 24px; }
[data-care-panel] .care-raw > button { color: var(--dsw-alias-label-tertiary); }
[data-care-panel] .care-code { white-space: pre-wrap; overflow-wrap: anywhere; font: .92em/1.6 monospace; background: var(--dsw-alias-bg-layer-2); padding: 12px; margin-top: 8px; }
[data-care-panel] .care-empty { padding: 24px 0; color: var(--dsw-alias-label-tertiary); }
[data-care-panel] [role='alert'] { padding: 12px; margin: 12px 0; border-radius: var(--dsw-radius-sm, 6px); background: var(--dsw-alias-interactive-bg-hover-danger); color: var(--dsw-alias-state-error-primary); overflow-wrap: anywhere; }
[data-care-entry] [role='alert'] { position: absolute; bottom: calc(100% + 8px); right: 0; width: 240px; padding: 12px; background: var(--dsw-alias-bg-layer-2); color: var(--dsw-alias-state-error-primary); box-shadow: var(--dsw-elevation-panel); z-index: 1; }
[data-context-care] { display: flex; flex-wrap: wrap; align-items: center; gap: 12px; padding: 2px 4px; font-size: calc(var(--dsh-content-font-size-secondary, 13px) - 1px); }
[data-context-care] > span { font-weight: 500; }
[data-care-card] { border: 1px solid var(--dsw-alias-border-l2); border-radius: var(--dsw-radius-md, 10px); padding: 14px 16px; margin: 10px 0; background: var(--dsw-alias-bg-layer-2); }
[data-care-card] .care-card-heading { display: flex; align-items: baseline; flex-wrap: wrap; gap: 8px 16px; margin-bottom: 8px; }
[data-care-card] .care-card-body { white-space: pre-wrap; overflow-wrap: anywhere; font-size: var(--dsh-content-font-size, 14px); line-height: 1.7; color: var(--dsw-alias-label-primary); }
[data-care-card] .care-card-meta { color: var(--dsw-alias-label-tertiary); margin-top: 8px; }
[data-care-card] .care-diff { font-family: inherit; white-space: pre-wrap; overflow-wrap: anywhere; padding: 6px 10px; margin-top: 6px; background: var(--dsw-alias-interactive-bg-hover); border-radius: var(--dsw-radius-sm, 6px); }
[data-care-card] .care-diff[data-change='removed'] { color: var(--dsw-alias-state-error-primary); }
[data-care-card] .care-diff[data-change='added'] { color: var(--dsw-alias-state-success-primary); }
@container (max-width: 370px) {
  [data-care-panel] > main { padding: 16px; }
  [data-care-panel] .care-record-top { flex-wrap: wrap; gap: 4px; }
  [data-care-panel] .care-change strong { font-size: 1.55em; }
  [data-care-panel] .care-change { gap: 4px; }
  [data-care-panel] .care-fields { grid-template-columns: minmax(70px, .8fr) minmax(0, 1.4fr); gap: 8px 10px; }
}
`.trim();
		function CareStyles() {
			return react.default.createElement("style", null, css);
		}
		//#endregion
		//#region src/care-copy.js
		const careCopy = {
			zh: {
				phase_dispatched: "已交给请求流",
				triggerStatic: "路由固定提醒",
				triggerModelSwitch: "模型路由切换",
				purposeConversation: "对话",
				fieldStatus: "测量状态",
				fieldMeasured: "已测量",
				fieldUnavailable: "无法测量",
				fieldDetectorVersion: "检测器版本",
				fieldLocale: "统计语言",
				metricN: "有效语句数 N",
				metricK: "命中语句数 K",
				metricH: "合并命中数 H",
				metricF: "命中类别数 F",
				metricJ: "同类最大语句数 J",
				metricD: "语句命中比例 D",
				metricR: "每百词命中数 R",
				fieldWords: "词数",
				fieldFamilyStatements: "各类命中语句",
				fieldExclusions: "排除范围",
				fieldPhrase: "词条",
				fieldFamily: "类别",
				fieldStart: "起始位置",
				fieldEnd: "结束位置",
				fieldText: "证据文本",
				fieldCount: "次数",
				fieldRatio: "比例",
				fieldSeverity: "程度",
				"pattern_line-repeat": "重复行清理",
				"pattern_filler-lines": "填充行清理",
				"pattern_line-cycle": "短句循环",
				"pattern_prefix-monotony": "行首重复",
				fieldYes: "是",
				fieldNo: "否",
				triggerBudget: "负荷与留存状态变化",
				triggerCompletion: "完成表述检测",
				decisionMatched: "命中规则",
				decisionSuppressed: "本次抑制",
				fieldCompletions: "完成表述次数",
				fieldObservations: "观察次数",
				fieldWindow: "观察窗口",
				fieldThreshold: "阈值",
				fieldScore: "评分",
				fieldTotal: "总量",
				fieldPassed: "是否通过",
				fieldDispatched: "是否已派发",
				fieldObservation: "观察结果",
				fieldRequest: "请求记录",
				fieldPurpose: "请求用途",
				fieldProvider: "提供方",
				fieldModel: "模型",
				fieldPhase: "执行阶段",
				fieldDecision: "判定",
				fieldRepeats: "重复次数",
				fieldMatched: "是否命中",
				fieldCooldown: "冷却状态",
				back: "返回列表",
				rawRecord: "原始记录",
				copy: "复制正文",
				copied: "已复制",
				copyFailed: "复制失败",
				fullText: "展开全文",
				collapseText: "收起全文",
				exactText: "当时的完整提示",
				sourceList: "查看来源",
				sourceSearch: "查找来源序号或正文",
				sourcePage: "来源页",
				sourcePrev: "上一页来源",
				sourceNext: "下一页来源",
				sourceEmpty: "没有匹配的来源",
				jump: "定位消息",
				jumping: "正在定位…",
				jumped: "已定位到聊天中的来源",
				jumpUnavailable: "此记录没有可定位的消息序号",
				jumpCancelled: "定位已取消：会话已切换或有新的定位请求",
				jumpOpenChat: "请先打开此会话的聊天视图",
				jumpMissing: "历史已加载，但此事件没有可定位的聊天节点；可能已被检查点替换或仅存在于日志中",
				jumpHidden: "宿主未提供此节点的原生展开入口",
				jumpUnsettled: "目标尚未完成展开或滚动，请重试",
				evidence: "当时的判定依据",
				requestRoute: "请求路由与派发",
				noRoute: "路由未记录",
				deliveryUnknown: "派发未记录",
				phaseUnknown: "阶段未记录",
				ruleName: "规则",
				ruleVersion: "版本",
				trigger: "触发",
				metrics: "当时指标",
				sourceRoute: "来源路由",
				producer: "发布来源",
				promptCompletion: "完成表述提醒",
				promptPattern: "输出模式反馈",
				promptState: "负荷与留存状态",
				promptLoop: "循环提醒",
				saved: "输入估算减少",
				increased: "输入估算增加",
				before: "维护前",
				after: "维护后",
				tokens: "tok",
				coverageCount: "条原始来源",
				range: "序号范围",
				selectedSources: "选区来源",
				coverageSources: "原始覆盖",
				summaryWork: "摘要调用",
				replacementFlow: "选区 → 检查点",
				audit: "记录完整性",
				inputUnits: "完整输入估算",
				routeSaving: "路由输入降幅",
				fixedSaving: "固定估算降幅",
				fieldMore: "更多字段见原始记录",
				sourceUser: "输入消息",
				sourceAssistant: "回复消息",
				sourceTool: "工具结果",
				sourceRequest: "请求记录",
				sourceSystem: "系统提示",
				sourceUnknown: "来源记录",
				requestOnly: "请求记录可能没有独立聊天节点；来源消息仍可逐条定位。",
				excerptLimit: "节选最多 2,000 字符；定位后查看原消息。",
				pageScope: "本页记录",
				recordCount: "条记录",
				promptPreview: "查看提示与依据",
				actionPreview: "查看结果与来源",
				rewriteEvidence: "改写依据"
			},
			en: {
				phase_dispatched: "Handed to request stream",
				triggerStatic: "Fixed route reminder",
				triggerModelSwitch: "Model route changed",
				purposeConversation: "Conversation",
				fieldStatus: "Measurement status",
				fieldMeasured: "Measured",
				fieldUnavailable: "Unavailable",
				fieldDetectorVersion: "Detector version",
				fieldLocale: "Measurement language",
				metricN: "Effective statements N",
				metricK: "Hit statements K",
				metricH: "Merged hits H",
				metricF: "Hit families F",
				metricJ: "Largest family statement count J",
				metricD: "Statement hit ratio D",
				metricR: "Hits per hundred words R",
				fieldWords: "Word count",
				fieldFamilyStatements: "Statements by family",
				fieldExclusions: "Excluded ranges",
				fieldPhrase: "Phrase",
				fieldFamily: "Family",
				fieldStart: "Start position",
				fieldEnd: "End position",
				fieldText: "Evidence text",
				fieldCount: "Count",
				fieldRatio: "Ratio",
				fieldSeverity: "Severity",
				"pattern_line-repeat": "Repeated-line cleanup",
				"pattern_filler-lines": "Filler-line cleanup",
				"pattern_line-cycle": "Short-line cycle",
				"pattern_prefix-monotony": "Repeated line prefix",
				fieldYes: "Yes",
				fieldNo: "No",
				triggerBudget: "Load and retention state changed",
				triggerCompletion: "Completion wording detected",
				decisionMatched: "Rule matched",
				decisionSuppressed: "Suppressed this time",
				fieldCompletions: "Completion count",
				fieldObservations: "Observation count",
				fieldWindow: "Observation window",
				fieldThreshold: "Threshold",
				fieldScore: "Score",
				fieldTotal: "Total",
				fieldPassed: "Passed",
				fieldDispatched: "Dispatched",
				fieldObservation: "Observation",
				fieldRequest: "Request record",
				fieldPurpose: "Request purpose",
				fieldProvider: "Provider",
				fieldModel: "Model",
				fieldPhase: "Phase",
				fieldDecision: "Decision",
				fieldRepeats: "Repeat count",
				fieldMatched: "Matched",
				fieldCooldown: "Cooldown",
				back: "Back to list",
				rawRecord: "Raw record",
				copy: "Copy text",
				copied: "Copied",
				copyFailed: "Copy failed",
				fullText: "Read full text",
				collapseText: "Collapse text",
				exactText: "Exact saved prompt",
				sourceList: "Browse sources",
				sourceSearch: "Find source sequence or text",
				sourcePage: "Source page",
				sourcePrev: "Previous sources",
				sourceNext: "Next sources",
				sourceEmpty: "No matching sources",
				jump: "Locate message",
				jumping: "Locating…",
				jumped: "Located the source in chat",
				jumpUnavailable: "This record has no message sequence to locate",
				jumpCancelled: "Navigation cancelled: session changed or a new navigation started",
				jumpOpenChat: "Open this session’s chat view first",
				jumpMissing: "History loaded, but this event has no chat node to locate; it may have been replaced by a checkpoint or exist only in the log",
				jumpHidden: "The host has no native reveal action for this node",
				jumpUnsettled: "The target has not finished expanding or scrolling; retry",
				evidence: "Evidence at the time",
				requestRoute: "Request route and dispatch",
				noRoute: "Route not recorded",
				deliveryUnknown: "Dispatch not recorded",
				phaseUnknown: "Phase not recorded",
				ruleName: "Rule",
				ruleVersion: "Version",
				trigger: "Trigger",
				metrics: "Recorded metrics",
				sourceRoute: "Source route",
				producer: "Producer",
				promptCompletion: "Completion wording reminder",
				promptPattern: "Output pattern feedback",
				promptState: "Load and retention state",
				promptLoop: "Loop reminder",
				saved: "Input estimate reduced",
				increased: "Input estimate increased",
				before: "Before",
				after: "After",
				tokens: "tok",
				coverageCount: "original sources",
				range: "Sequence range",
				selectedSources: "Selected sources",
				coverageSources: "Original coverage",
				summaryWork: "Summary call",
				replacementFlow: "Selection → checkpoint",
				audit: "Record completeness",
				inputUnits: "Complete input estimate",
				routeSaving: "Route input saving",
				fixedSaving: "Fixed estimate saving",
				fieldMore: "More fields in the raw record",
				sourceUser: "Input message",
				sourceAssistant: "Response message",
				sourceTool: "Tool result",
				sourceRequest: "Request record",
				sourceSystem: "System prompt",
				sourceUnknown: "Source record",
				requestOnly: "A request may have no separate chat node; its source messages can still be located individually.",
				excerptLimit: "Excerpt limited to 2,000 characters; locate the original message to read more.",
				pageScope: "Records on this page",
				recordCount: "records",
				promptPreview: "Read prompt and evidence",
				actionPreview: "Read result and sources",
				rewriteEvidence: "Rewrite evidence"
			}
		};
		//#endregion
		//#region src/client-view.js
		const dictionaries = {
			zh: {
				...careCopy.zh,
				fatigue: "疲劳度",
				wakefulness: "唤醒值",
				unknown: "未校准",
				low: "低",
				normal: "正常",
				elevated: "较高",
				high: "高",
				"very-high": "很高",
				waiting: "等待首次状态",
				description: "最近一次请求准备时的负荷与保留信息量估算；不是记忆可靠性判断，也不是任务时限。",
				rewriteTitle: "请求改写",
				rewriteRemoved: "去掉",
				rewriteLines: "行重复内容",
				rewriteUnknown: "未记录",
				rewriteChars: "字符",
				noticeTitle: "上下文照料",
				noticeUnknown: "未知来源",
				noticeSubState: "状态",
				noticeSubRequest: "请求改写",
				noticeSubLoop: "循环清理",
				noticeSubWatch: "流式提醒",
				noticeSubRules: "规则",
				actionsTitle: "预算与维护记录",
				actionsLoading: "正在读取记录",
				actionsUnavailable: "记录暂不可用",
				actionsEmpty: "还没有维护动作",
				actionsAdmission: "最近主请求路由",
				actionsInput: "完整输入估算",
				actionsCapacity: "物理容量 / 政策容量",
				actionsLimits: "软阈值 / 硬限额 / 释放目标",
				actionsRetention: "近况留存 / 输出预留",
				actionsDispatch: "派发状态",
				actionsSent: "已派发",
				actionsNotSent: "尚未派发",
				actionsNoAdmission: "尚无请求预算记录",
				actionsBasis: "输入估算来源",
				actionsTextScale: "文本校准比例",
				actionsSample: "样本序号",
				actionsRawPrices: "原始文本含 schema / 独立视觉价格",
				actionsIdentity: "动作编号",
				actionsRule: "选择规则",
				actionsSources: "选区来源序号",
				actionsPrice: "维护前后输入估算",
				actionsSavings: "路由计价降幅 / 固定估算降幅",
				actionsReplacement: "替换范围",
				actionsCheckpoint: "检查点序号",
				actionsCoverage: "原始覆盖序号",
				actionsDepth: "加工深度",
				actionsCandidates: "候选范围与预测降幅",
				actionsError: "失败原因",
				actionsJournal: "记录状态",
				actionsPersisted: "动作记录已持久化",
				actionsRecovered: "已从会话恢复提交事实，动作记录不完整",
				actionsReason: "触发原因",
				reason_automatic: "输入压力达到维护条件",
				reason_requested: "主动调用 context_rest",
				reason_overflow: "请求预算拒绝或上下文溢出",
				actionsReasonUnknown: "当时的触发原因未记录",
				actionsSessionOnly: "来自会话压缩记录；未找到本插件动作审计，无法判断当时是否采集",
				actionsPartial: "已有部分动作审计；提交事实由会话核对",
				actionsMissingPrice: "当时的完整输入前后估算未记录",
				actionsShadowPrice: "被替换内容固定估算",
				actionsSummaryUsage: "摘要调用输入 / 输出用量",
				actionsSummaryRoute: "摘要路由",
				actionsAuditKeys: "审计记录键",
				actionsSourceCount: "个来源记录",
				action_checkpoint: "历史检查点",
				promptsTitle: "提示详情与溯源",
				promptsOpen: "在右侧栏查看所有上下文照料提示",
				promptsDetails: "详情与溯源",
				promptsExplanation: "正文来自当时保存的消息或请求决策。来源事件与请求派发分开列出；没有旧审计时不推测触发原因。",
				promptsEmpty: "尚无可读取的提示记录",
				promptsNotFound: "未找到所选来源事件",
				promptsSource: "发布来源",
				promptsTime: "记录时间",
				promptsIdentity: "记录编号",
				promptsTrigger: "触发依据",
				promptsSegment: "提示段落",
				promptsCalls: "关联请求",
				promptsSources: "来源事件",
				promptsExcerpt: "正文节选",
				promptsNotRecorded: "未记录或无法读取",
				promptsNoCalls: "没有关联请求审计；不据此判断是否已送达模型",
				promptsNoSources: "没有来源事件引用",
				promptsEvaluations: "持久规则评估记录",
				promptsSegmentsOnly: "旧记录只保存了提示段落；下面是段落文本，缺少原始包装正文。",
				promptsLegacyTrace: "此历史提示没有保存结构化触发依据；正文与发布来源仍可核对。",
				prompt_checkpoint: "插件检查点与续接提示",
				prompt_message: "会话提示",
				prompt_request: "请求专属提示",
				prompt_guidance: "系统照料说明",
				"prompt_summary-instruction": "摘要生成指令",
				actionsPrevious: "较新记录",
				actionsNext: "更早记录",
				actionsBudget: "当前请求预算",
				actionsUsage: "输入占硬限额 ",
				actionsSoftLimit: "软阈值",
				actionsReleaseTarget: "释放目标",
				actionsTechnical: "计价与保留策略",
				actionsHistory: "维护记录",
				actionsRefresh: "刷新",
				actionsPage: "页",
				actionsOpen: "在右侧栏打开预算与维护记录",
				actionsOpenFailed: "无法打开记录",
				action_prune: "裁剪",
				action_summary: "摘要",
				"action_deep-rest": "深度休息",
				action_selection: "选区规划",
				phase_started: "执行中",
				phase_planning: "规划",
				phase_prepared: "提交准备",
				phase_repaired: "输入已修复",
				phase_committed: "已提交",
				phase_completed: "已结算",
				phase_failed: "失败",
				"phase_no-useful-range": "同一选区无收益",
				"phase_commit-record-failed": "已提交，审计写入失败",
				outcome_partial: "已有部分持久进展",
				outcome_failed: "未完成",
				outcome_committed: "已缩小输入",
				outcome_noop: "输入未缩小",
				"rule_fresh-summary": "新内容摘要",
				"rule_checkpoint-merge": "检查点合并",
				"rule_basic-prefix": "压力前缀兜底"
			},
			en: {
				...careCopy.en,
				fatigue: "Fatigue",
				wakefulness: "Wakefulness",
				unknown: "Uncalibrated",
				low: "Low",
				normal: "Normal",
				elevated: "Elevated",
				high: "High",
				"very-high": "Very high",
				waiting: "Awaiting first sample",
				description: "Load and retained-information estimates at the latest request preparation; not a memory-quality diagnosis or a task deadline.",
				rewriteTitle: "Request rewrite",
				rewriteRemoved: "removed",
				rewriteLines: "repeated lines",
				rewriteUnknown: "not recorded",
				rewriteChars: "characters",
				noticeTitle: "Context care",
				noticeUnknown: "unknown producer",
				noticeSubState: "state",
				noticeSubRequest: "request rewrite",
				noticeSubLoop: "loop cleanup",
				noticeSubWatch: "stream watch",
				noticeSubRules: "rule",
				actionsTitle: "Budget and maintenance",
				actionsLoading: "Loading records",
				actionsUnavailable: "Records unavailable",
				actionsEmpty: "No maintenance actions yet",
				actionsAdmission: "Latest conversation route",
				actionsInput: "Complete input estimate",
				actionsCapacity: "Physical / policy capacity",
				actionsLimits: "Soft / hard / release target",
				actionsRetention: "Retained tail / output reservation",
				actionsDispatch: "Dispatch",
				actionsSent: "Dispatched",
				actionsNotSent: "Not dispatched",
				actionsNoAdmission: "No admission record yet",
				actionsBasis: "Input estimate basis",
				actionsTextScale: "Text calibration scale",
				actionsSample: "Sample sequence",
				actionsRawPrices: "Raw text including schema / independent visual price",
				actionsIdentity: "Action ID",
				actionsRule: "Selection rule",
				actionsSources: "Selected source sequences",
				actionsPrice: "Input estimate before / after",
				actionsSavings: "Route saving / fixed estimate saving",
				actionsReplacement: "Replacement",
				actionsCheckpoint: "Checkpoint sequence",
				actionsCoverage: "Original leaf sequences",
				actionsDepth: "Processing depth",
				actionsCandidates: "Candidates and predicted saving",
				actionsError: "Failure",
				actionsJournal: "Record status",
				actionsPersisted: "Action record persisted",
				actionsRecovered: "Commit recovered from session; action audit incomplete",
				actionsReason: "Trigger",
				reason_automatic: "Input pressure meets maintenance conditions",
				reason_requested: "Explicit context_rest call",
				reason_overflow: "Request budget rejection or context overflow",
				actionsReasonUnknown: "Trigger was not recorded",
				actionsSessionOnly: "Session compaction record; no plugin action audit found, collection at that time is unknown",
				actionsPartial: "Partial action audit; commit verified against session history",
				actionsMissingPrice: "Complete input estimates before and after were not recorded",
				actionsShadowPrice: "Fixed estimate of replaced material",
				actionsSummaryUsage: "Summary call input / output usage",
				actionsSummaryRoute: "Summary route",
				actionsAuditKeys: "Audit record keys",
				actionsSourceCount: "source records",
				action_checkpoint: "History checkpoint",
				promptsTitle: "Prompt details and sources",
				promptsOpen: "View all context care prompts in the right sidebar",
				promptsDetails: "Details and sources",
				promptsExplanation: "Text comes from the saved message or request decision. Source events and request handoff are separate; missing historical triggers are not inferred.",
				promptsEmpty: "No readable prompt records yet",
				promptsNotFound: "Selected source event was not found",
				promptsSource: "Producer",
				promptsTime: "Recorded at",
				promptsIdentity: "Record ID",
				promptsTrigger: "Trigger evidence",
				promptsSegment: "Prompt segment",
				promptsCalls: "Related requests",
				promptsSources: "Source events",
				promptsExcerpt: "Text excerpt",
				promptsNotRecorded: "Not recorded or unavailable",
				promptsNoCalls: "No related request audit; this does not establish model delivery",
				promptsNoSources: "No source event references",
				promptsEvaluations: "Durable rule evaluations",
				promptsSegmentsOnly: "This older record retains segments only; the text below lacks the original wrapper.",
				promptsLegacyTrace: "This historical prompt has no structured trigger evidence; its text and producer remain available.",
				prompt_checkpoint: "Plugin checkpoint and continuation prompt",
				prompt_message: "Session prompt",
				prompt_request: "Request-only prompt",
				prompt_guidance: "System care guidance",
				"prompt_summary-instruction": "Summary generation instruction",
				actionsPrevious: "Newer records",
				actionsNext: "Older records",
				actionsBudget: "Current request budget",
				actionsUsage: "Input / hard limit ",
				actionsSoftLimit: "Soft limit",
				actionsReleaseTarget: "Release target",
				actionsTechnical: "Pricing and retention",
				actionsHistory: "Maintenance history",
				actionsRefresh: "Refresh",
				actionsPage: "Page",
				actionsOpen: "Open budget and maintenance in the right sidebar",
				actionsOpenFailed: "Unable to open records",
				action_prune: "Prune",
				action_summary: "Summary",
				"action_deep-rest": "Deep rest",
				action_selection: "Selection",
				phase_started: "Running",
				phase_planning: "Planning",
				phase_prepared: "Prepared",
				phase_repaired: "Input repaired",
				phase_committed: "Committed",
				phase_completed: "Settled",
				phase_failed: "Failed",
				"phase_no-useful-range": "Unchanged range has no gain",
				"phase_commit-record-failed": "Committed; audit failed",
				outcome_partial: "Partial durable progress",
				outcome_failed: "Incomplete",
				outcome_committed: "Input reduced",
				outcome_noop: "Input unchanged",
				"rule_fresh-summary": "Fresh material",
				"rule_checkpoint-merge": "Checkpoint merge",
				"rule_basic-prefix": "Pressure prefix fallback"
			}
		};
		function tone(value, kind) {
			if (!Number.isFinite(value)) return "var(--dsw-alias-label-secondary)";
			return (kind === "wakefulness" ? [
				"var(--dsw-alias-state-warn-primary)",
				"var(--dsw-alias-state-business-primary)",
				"var(--dsw-alias-state-success-secondary)",
				"var(--dsw-alias-state-success-primary)"
			] : [
				"var(--dsw-alias-state-success-primary)",
				"var(--dsw-alias-state-business-primary)",
				"var(--dsw-alias-state-warn-primary)",
				"var(--dsw-alias-state-error-primary)"
			])[value < 30 ? 0 : value < 60 ? 1 : value < 85 ? 2 : 3];
		}
		function indicator(label, value, level, kind, t) {
			const text = value === null || value === void 0 ? `${label}: ${t("unknown")}` : `${label}: ${value}% (${t(level)})`;
			return react.default.createElement("span", { style: { color: tone(value, kind) } }, text);
		}
		/** Pure display receives the framework-owned projection hook. */
		function ContextCareStatus({ useProjection, useCareActions, useRewriteHealth, watchActions, sessionId, t }) {
			const state = useProjection("contextCareNumeric");
			const actions = useCareActions((table) => table.get(`${sessionId}:0`));
			const health = useRewriteHealth((value) => value);
			(0, react.useEffect)(() => watchActions(sessionId, 0), [sessionId, watchActions]);
			const error = actions?.status === "error" ? actions.error : health?.status === "error" ? health.error : void 0;
			return react.default.createElement("div", {
				"data-context-care": "",
				role: "status",
				title: t("description")
			}, react.default.createElement(CareStyles), indicator(t("fatigue"), state?.fatigueValue, state?.fatigue ?? "unknown", "fatigue", t), indicator(t("wakefulness"), state?.wakefulnessValue, state?.wakefulness ?? "unknown", "wakefulness", t), error ? react.default.createElement("span", {
				role: "alert",
				style: { color: "var(--dsw-alias-state-error-primary)" }
			}, `${t("actionsUnavailable")}: ${error}`) : !state ? react.default.createElement("span", null, t("waiting")) : null);
		}
		//#endregion
		//#region src/care-ui.js
		const h = react.default.createElement;
		const number = (value) => Number.isFinite(value) ? Math.round(value).toLocaleString() : "—";
		const date = (at) => Number.isFinite(at) ? new Date(at).toLocaleString(void 0, {
			month: "2-digit",
			day: "2-digit",
			hour: "2-digit",
			minute: "2-digit"
		}) : "—";
		const label = (t, prefix, value) => {
			if (value == null) return "—";
			const key = `${prefix}_${value}`;
			const translated = t(key);
			return translated && translated !== key ? translated : String(value);
		};
		const badge = (text, tone) => h("span", {
			className: "care-badge",
			"data-tone": tone
		}, text);
		const row = (name, value) => h(react.default.Fragment, { key: name }, h("dt", null, name), h("dd", null, value));
		/** Detail focus and return focus follow record navigation without touching host UI. */
		function useRecordSelection(initial = null) {
			const [selected, setSelected] = (0, react.useState)(initial);
			const previous = (0, react.useRef)(initial);
			const buttons = (0, react.useRef)(/* @__PURE__ */ new Map());
			(0, react.useEffect)(() => {
				if (selected === null && previous.current != null) buttons.current.get(previous.current)?.focus();
			}, [selected]);
			return {
				selected,
				select(id) {
					if (id !== null) previous.current = id;
					setSelected(id);
				},
				recordRef: (id) => (element) => {
					if (element) buttons.current.set(id, element);
					else buttons.current.delete(id);
				}
			};
		}
		function useDetailHeading() {
			const ref = (0, react.useRef)(null);
			(0, react.useEffect)(() => {
				ref.current?.focus({ preventScroll: true });
			}, []);
			return ref;
		}
		function Section({ title, children, extra }) {
			return h("section", { className: "care-section" }, h("div", { className: "care-section-heading" }, h("h4", null, title), extra), children);
		}
		/** Original JSON is opt-in and mounted only while reading it. */
		function RawRecord({ value, t }) {
			const [open, setOpen] = (0, react.useState)(false);
			return h("div", { className: "care-raw" }, h("button", {
				type: "button",
				"aria-expanded": open,
				onClick: () => setOpen(!open)
			}, t("rawRecord"), open ? " −" : " +"), open ? h("pre", { className: "care-code" }, JSON.stringify(value, null, 2)) : null);
		}
		/** The saved body remains exact; the reading viewport, not the string, is bounded. */
		function TextReader({ text = "", t }) {
			const [full, setFull] = (0, react.useState)(false);
			const [copy, setCopy] = (0, react.useState)("");
			return h("div", { className: "care-reader" }, h("pre", {
				className: "care-prompt-text",
				"data-full": full || void 0
			}, text), h("div", { className: "care-reader-tools" }, text.length > 600 ? h("button", {
				type: "button",
				"aria-expanded": full,
				onClick: () => setFull(!full)
			}, t(full ? "collapseText" : "fullText")) : null, h("button", {
				type: "button",
				onClick: async () => {
					try {
						await navigator.clipboard.writeText(text);
						setCopy("copied");
					} catch (error) {
						setCopy("copyFailed");
					}
				}
			}, t("copy")), copy ? h("span", { role: "status" }, t(copy)) : null));
		}
		/** Translate only known recorded values; unknown/custom facts keep their exact text. */
		function evidenceValue(value, t) {
			if (typeof value === "boolean") return t(value ? "fieldYes" : "fieldNo");
			const key = {
				"completion-observation": "promptCompletion",
				"output-pattern": "promptPattern",
				"budget-state": "triggerBudget",
				"completion": "triggerCompletion",
				"prepared": "phase_prepared",
				"dispatched": "phase_dispatched",
				"failed": "phase_failed",
				"completed": "phase_completed",
				"static": "triggerStatic",
				"model-switch": "triggerModelSwitch",
				"conversation": "purposeConversation",
				"summary": "summaryWork",
				"measured": "fieldMeasured",
				"unavailable": "fieldUnavailable",
				"matched": "decisionMatched",
				"suppressed": "decisionSuppressed"
			}[value];
			return key ? t(key) : String(value);
		}
		/** Fields retain custom evidence with bounded depth and item count; raw data stays available. */
		function Fields({ value, t, depth = 0 }) {
			if (value == null) return h("span", { className: "care-muted" }, "—");
			if (typeof value !== "object") return h("span", null, evidenceValue(value, t));
			if (depth >= 3) return h("span", { className: "care-muted" }, t("fieldMore"));
			const entries = Object.entries(value).filter(([, item]) => item !== void 0);
			const names = {
				ruleId: "ruleName",
				version: "ruleVersion",
				trigger: "trigger",
				metrics: "metrics",
				sourceRoute: "sourceRoute",
				producer: "producer",
				fatigueValue: "fatigue",
				wakefulnessValue: "wakefulness",
				facts: "evidence",
				purpose: "fieldPurpose",
				provider: "fieldProvider",
				model: "fieldModel",
				phase: "fieldPhase",
				decision: "fieldDecision",
				repeats: "fieldRepeats",
				matched: "fieldMatched",
				reason: "actionsReason",
				cooldown: "fieldCooldown",
				completionCount: "fieldCompletions",
				observationCount: "fieldObservations",
				windowSize: "fieldWindow",
				sourceCount: "actionsSourceCount",
				threshold: "fieldThreshold",
				score: "fieldScore",
				total: "fieldTotal",
				passed: "fieldPassed",
				dispatched: "fieldDispatched",
				observation: "fieldObservation",
				request: "fieldRequest",
				status: "fieldStatus",
				detectorVersion: "fieldDetectorVersion",
				locale: "fieldLocale",
				N: "metricN",
				K: "metricK",
				H: "metricH",
				F: "metricF",
				J: "metricJ",
				D: "metricD",
				R: "metricR",
				words: "fieldWords",
				familyStatements: "fieldFamilyStatements",
				evidence: "evidence",
				exclusions: "fieldExclusions",
				phraseId: "fieldPhrase",
				family: "fieldFamily",
				start: "fieldStart",
				end: "fieldEnd",
				text: "fieldText",
				count: "fieldCount",
				ratio: "fieldRatio",
				severity: "fieldSeverity"
			};
			return h(react.default.Fragment, null, h("dl", { className: "care-fields" }, ...entries.slice(0, 12).map(([key, item]) => row(names[key] ? t(names[key]) : key, typeof item === "string" && item.length > 300 ? h("span", null, item.slice(0, 300), "… ", t("fieldMore")) : h(Fields, {
				value: item,
				t,
				depth: depth + 1
			})))), entries.length > 12 ? h("p", { className: "care-muted" }, t("fieldMore")) : null);
		}
		/** Result callbacks cannot update an unmounted detail or an earlier click. */
		function JumpButton({ seq, revealSource, t }) {
			const [state, setState] = (0, react.useState)({
				status: "",
				error: ""
			});
			const ticket = (0, react.useRef)(0);
			(0, react.useEffect)(() => () => {
				ticket.current++;
			}, []);
			if (!Number.isSafeInteger(seq) || !revealSource) return null;
			return h("div", { className: "care-jump" }, h("button", {
				type: "button",
				disabled: state.status === "jumping",
				onClick: async () => {
					const id = ++ticket.current;
					setState({
						status: "jumping",
						error: ""
					});
					try {
						await revealSource(seq);
						if (ticket.current === id) setState({
							status: "jumped",
							error: ""
						});
					} catch (error) {
						if (ticket.current === id) setState({
							status: "",
							error: t(error.code) || String(error.message ?? error)
						});
					}
				}
			}, t(state.status === "jumping" ? "jumping" : "jump")), state.status === "jumped" ? h("span", { role: "status" }, t("jumped")) : null, state.error ? h("p", { role: "alert" }, state.error) : null);
		}
		const sourceKind = (type) => ({
			"user/message": "sourceUser",
			"assistant/message": "sourceAssistant",
			"tool/result": "sourceTool",
			"request/header": "sourceRequest",
			"system/message": "sourceSystem"
		})[type] ?? "sourceUnknown";
		/** Source arrays of any length render twenty rows at a time, with an explicit text search. */
		function Sources({ sources = [], t, revealSource }) {
			const [open, setOpen] = (0, react.useState)(false);
			const [query, setQuery] = (0, react.useState)("");
			const [page, setPage] = (0, react.useState)(0);
			const [selected, select] = (0, react.useState)(null);
			const records = sources.map((source) => typeof source === "number" ? { seq: source } : source);
			const filtered = query.trim() ? records.filter((source) => `${source.seq} ${source.excerpt ?? ""}`.toLowerCase().includes(query.trim().toLowerCase())) : records;
			const offset = Math.min(page * 20, Math.max(0, Math.floor((filtered.length - 1) / 20) * 20));
			return h("div", { className: "care-sources" }, h("div", { className: "care-source-heading" }, h("span", null, number(records.length), " ", t("actionsSourceCount")), h("button", {
				type: "button",
				"aria-expanded": open,
				onClick: () => setOpen(!open)
			}, t("sourceList"), open ? " −" : " +")), open ? h("div", null, h("input", {
				type: "search",
				value: query,
				placeholder: t("sourceSearch"),
				"aria-label": t("sourceSearch"),
				onChange: (event) => {
					setQuery(event.target.value);
					setPage(0);
					select(null);
				}
			}), h("ol", { className: "care-source-rows" }, ...filtered.slice(offset, offset + 20).map((source) => h("li", { key: source.seq }, h("div", { className: "care-source-row" }, h("button", {
				type: "button",
				className: "care-source-name",
				"aria-expanded": selected === source.seq,
				onClick: () => select(selected === source.seq ? null : source.seq)
			}, h("strong", null, t(sourceKind(source.type))), h("span", { className: "care-muted" }, `#${source.seq}`)), h(JumpButton, {
				seq: source.seq,
				revealSource,
				t
			})), source.excerpt ? h("p", { className: "care-source-preview" }, source.excerpt.slice(0, 120)) : null, selected === source.seq ? h("div", { className: "care-source-excerpt" }, h("pre", {
				className: "care-prompt-text",
				"data-full": true
			}, source.excerpt || t("promptsNotRecorded")), source.truncated ? h("p", { className: "care-muted" }, t("excerptLimit")) : null) : null))), filtered.length ? h("nav", {
				className: "care-source-pager",
				"aria-label": t("sourcePage")
			}, h("button", {
				type: "button",
				disabled: offset === 0,
				onClick: () => {
					setPage(page - 1);
					select(null);
				}
			}, t("sourcePrev")), h("span", null, `${Math.floor(offset / 20) + 1} / ${Math.ceil(filtered.length / 20)}`), h("button", {
				type: "button",
				disabled: offset + 20 >= filtered.length,
				onClick: () => {
					setPage(page + 1);
					select(null);
				}
			}, t("sourceNext"))) : h("p", { className: "care-empty" }, t("sourceEmpty"))) : null);
		}
		//#endregion
		//#region src/rewrite-view.js
		/** 会话流中请求改写卡片的节点类型。 */
		const REWRITE_NODE = "request-rewrite";
		/** 与 Host 的内容指纹算法一致；指纹用于匹配，不代表无碰撞。 */
		function contentHash(text) {
			let hash = 2166136261;
			for (let index = 0; index < text.length; index += 1) {
				hash ^= text.charCodeAt(index);
				hash = hash + ((hash << 1) + (hash << 4) + (hash << 7) + (hash << 8) + (hash << 24)) >>> 0;
			}
			return hash.toString(16).padStart(8, "0");
		}
		/**
		* 节点只保存原始消息的指纹，记录到达前也保留渲染位置。
		* journal 是异步数据，不能在确定性节点组装阶段用它决定返回 null。
		*/
		function textBlocksOfView(message) {
			const blocks = [];
			if (typeof message?.reasoning_content === "string") blocks.push({
				type: "reasoning",
				text: message.reasoning_content
			});
			const content = message?.content;
			if (typeof content === "string") blocks.push({
				type: "text",
				text: content
			});
			else if (Array.isArray(content)) for (const block of content) {
				if (![
					"text",
					"reasoning",
					"thinking",
					"input_text",
					"output_text"
				].includes(block?.type)) continue;
				const text = block.type === "thinking" ? block.thinking : block.text;
				if (typeof text === "string") blocks.push({
					type: block.type === "thinking" ? "reasoning" : block.type,
					text
				});
			}
			if (message?.type === "reasoning" && Array.isArray(message.summary)) {
				for (const block of message.summary) if (block?.type === "summary_text" && typeof block.text === "string") blocks.push({
					type: "reasoning",
					text: block.text
				});
			}
			return blocks;
		}
		function createRewriteDefinition() {
			return {
				kind: REWRITE_NODE,
				target: "chat",
				match: (event) => event.type === "assistant/message" ? {
					id: "rewrite:" + event.seq,
					role: "start"
				} : null,
				start: (_context, match) => ({ seq: match.event.seq }),
				update: (context) => context.state,
				buildViewNode(context) {
					const start = context.start;
					if (start === void 0) return null;
					const message = start.event.data?.message;
					const blocks = textBlocksOfView(message);
					if (blocks.length === 0) return null;
					const hashes = blocks.map((block) => contentHash(block.text));
					for (const type of ["text", "reasoning"]) {
						const same = blocks.filter((block) => block.type === type);
						if (same.length > 1) hashes.push(contentHash(same.map((block) => block.text).join("")));
					}
					return {
						key: context.key,
						kind: REWRITE_NODE,
						id: context.id,
						target: "chat",
						anchorSeq: start.event.seq,
						location: start.location,
						visibility: "visible",
						data: {
							seq: start.event.seq,
							hashes: [...new Set(hashes)]
						}
					};
				}
			};
		}
		/** 片段里的换行在卡片上会撑开行高，换成可见记号保持单行。 */
		function oneLine(text) {
			return text.replace(/\n/g, "↵");
		}
		/**
		* 改动片段：去掉的用 −，换成的用 +。
		*
		* 只报字符数等于只说「有事发生」——这里回答的是「改了什么」。
		* 纯插入或纯删除时其中一端为空，就只画有内容的那一行。
		*/
		function snippetRows(hit) {
			const rows = [];
			const removed = typeof hit.removed === "string" ? hit.removed : "";
			const added = typeof hit.added === "string" ? hit.added : "";
			if (removed.length > 0) rows.push(react.default.createElement("div", {
				key: "removed",
				className: "care-diff",
				"data-change": "removed"
			}, "− " + oneLine(removed)));
			if (added.length > 0) rows.push(react.default.createElement("div", {
				key: "added",
				className: "care-diff",
				"data-change": "added"
			}, "+ " + oneLine(added)));
			return rows;
		}
		/** 记录通过框架生成的 hook 到达，不要求重新折叠会话历史。 */
		function RewriteNodeView({ node, sessionId, useRewriteRecords, t }) {
			const table = useRewriteRecords((value) => value);
			const hits = (node?.data?.hashes ?? []).map((hash) => table.get(sessionId + ":" + hash)).filter((record) => record !== void 0);
			if (hits.length === 0) return null;
			return react.default.createElement("div", {
				className: "dsh-context-care-rewrite",
				"data-care-card": ""
			}, react.default.createElement(CareStyles), react.default.createElement("div", { className: "care-card-heading" }, react.default.createElement("strong", null, t("rewriteTitle"))), ...hits.map((hit, index) => react.default.createElement("div", { key: index }, react.default.createElement("div", { className: "care-card-meta" }, (hit.pattern ? label(t, "pattern", hit.pattern) : t("rewriteUnknown")) + " · " + hit.charsBefore + " → " + hit.charsAfter + " " + t("rewriteChars"), Number.isSafeInteger(hit.removedLines) ? " · " + t("rewriteRemoved") + " " + hit.removedLines + " " + t("rewriteLines") : ""), ...snippetRows(hit))));
		}
		//#endregion
		//#region src/notice-view.js
		/**
		* 会话流里的注入通知节点。
		*
		* 宿主把通知类消息归到 `context` 节点,而 `isVisibleChatNode` 有意排除普通 Context 行
		* (只保留含工具增删的那种),所以这类消息在 Chat 里从来不显示。它们却是直接发给模型的
		* 旁路内容(状态、规则命中、循环提醒,以及别的插件在通知通道注册的源),人需要逐条看到。
		* 这里用自己的节点类型承接下来,渲染成人能读的样子。
		*/
		const NOTICE_NODE = "context-care-notice";
		/** 本插件发布者名;别的插件注册的通知源不带这个前缀。 */
		const OWN = "dsh-context-care";
		/** 子来源到字典键;没登记的按原样显示。 */
		const SUB_KEYS = {
			state: "noticeSubState",
			request: "noticeSubRequest",
			loop: "noticeSubLoop",
			watch: "noticeSubWatch",
			rules: "noticeSubRules"
		};
		/**
		* 一次注入的发布者名。
		* V4 写 `kind: 'plugin:<名>'`,V3 写 `plugin` 字段,两种都要认。
		* @param source - 消息的 source。
		* @returns 发布者名,读不出时为空串。
		*/
		function noticeProducer(source) {
			if (source === null || typeof source !== "object") return "";
			if (typeof source.plugin === "string" && source.plugin !== "") return source.plugin;
			const kind = source.kind;
			if (typeof kind !== "string") return "";
			return kind.startsWith("plugin:") ? kind.slice(7) : kind;
		}
		/**
		* 发布者名投影成给人看的一行。
		* 本插件的来源写成「上下文照料 · 状态」;别的插件保留自己的名字。
		* @param producer - noticeProducer 的结果。
		* @param t - 字典座位。
		* @returns 展示用的来源标签。
		*/
		function noticeLabel(producer, t) {
			if (producer === "") return t("noticeUnknown");
			if (producer === OWN) return t("noticeTitle");
			if (!producer.startsWith(OWN + ":")) return producer;
			const [head, ...rest] = producer.slice(17).split(":");
			const key = SUB_KEYS[head];
			const label = key === void 0 ? head : t(key);
			return rest.length === 0 ? t("noticeTitle") + " · " + label : t("noticeTitle") + " · " + label + " · " + rest.join(":");
		}
		/** 正文里的包装标签(整行只有一个标签)对人不表达任何东西,去掉。 */
		function noticeBody(text) {
			return text.split("\n").filter((line) => !/^\s*<\/?[a-zA-Z][\w-]*>\s*$/.test(line)).join("\n").replace(/\n{3,}/g, "\n\n").trim();
		}
		/** 注入随带的数值样本;没有或不是有限数就不报,绝不编一个。 */
		function noticeValues(source) {
			const care = source?.contextCare;
			if (care === null || typeof care !== "object") return [];
			const out = [];
			if (Number.isFinite(care.fatigueValue)) out.push({
				kind: "fatigue",
				value: care.fatigueValue
			});
			if (Number.isFinite(care.wakefulnessValue)) out.push({
				kind: "wakefulness",
				value: care.wakefulnessValue
			});
			return out;
		}
		/** 文本块的正文;其它块类型(图片等)不在这里展示。 */
		function noticeText(content) {
			return (Array.isArray(content) ? content : []).filter((block) => block?.type === "text" && typeof block.text === "string").map((block) => block.text).join("\n");
		}
		/**
		* 一次注入的展示数据;形状说不清时返回 undefined,由调用方决定退让。
		* @param event - 会话事件。
		* @returns `{seq, time, producer, summary, values, body}`,或 undefined。
		*/
		function noticeData(event) {
			if (event?.type !== "user/message") return void 0;
			const source = event.data?.source;
			if (source === null || typeof source !== "object" || source.form !== "notice") return void 0;
			const body = noticeBody(noticeText(event.data?.content));
			if (body === "") return void 0;
			const values = noticeValues(source);
			return {
				seq: event.seq,
				time: event.time,
				producer: noticeProducer(source),
				summary: values.length > 0 ? "" : typeof source.summary === "string" ? source.summary : "",
				values,
				body
			};
		}
		/**
		* 匹配全部通知形式的注入。
		*
		* 只认 `form === 'notice'`:具体来源(`state` / `request` / `loop` / `watch:<id>` /
		* `rules:<id>`,以及通知通道上别的插件注册的源)各不相同,按 form 收口才收得全。
		* @returns 会话节点定义。
		*/
		function createNoticeDefinition() {
			return {
				kind: NOTICE_NODE,
				target: "chat",
				match: (event) => noticeData(event) === void 0 ? null : {
					id: "notice:" + event.seq,
					role: "start"
				},
				start: (_context, match) => ({ seq: match.event.seq }),
				update: (context) => context.state,
				buildViewNode(context) {
					const start = context.start;
					if (start === void 0) return null;
					const data = noticeData(start.event);
					if (data === void 0) return null;
					return {
						key: context.key,
						kind: NOTICE_NODE,
						id: context.id,
						target: "chat",
						anchorSeq: start.event.seq,
						location: start.location,
						visibility: "visible",
						data
					};
				}
			};
		}
		/** 数值样本:百分比取整,颜色沿用状态条的色带。 */
		function valueRow(values, t) {
			return values.map((entry, index) => react.default.createElement("span", {
				key: entry.kind,
				style: {
					color: tone(entry.value, entry.kind),
					fontWeight: 600
				}
			}, (index === 0 ? "" : " · ") + t(entry.kind) + " " + Math.round(entry.value) + "%"));
		}
		/**
		* 渲染一次注入:来源与数值成一行,正文按普通正文排版。
		* @param props - 框架给的节点与字典座位。
		* @returns 一行/一张通知卡片。
		*/
		function NoticeNodeView({ node, t, sessionId, openPrompts }) {
			const data = node?.data;
			if (data === void 0) return null;
			return react.default.createElement("div", {
				"data-context-care-notice": "",
				"data-context-care-seq": data.seq,
				"data-care-card": ""
			}, react.default.createElement(CareStyles), react.default.createElement("div", { className: "care-card-heading" }, react.default.createElement("span", { style: {
				fontSize: "var(--dsh-content-font-size-secondary, 13px)",
				fontWeight: 600,
				color: "var(--dsw-alias-label-secondary)"
			} }, noticeLabel(data.producer, t)), data.values.length > 0 ? react.default.createElement("span", { style: { fontSize: "var(--dsh-content-font-size-secondary, 13px)" } }, valueRow(data.values, t)) : data.summary === "" ? null : react.default.createElement("span", { style: {
				fontSize: "var(--dsh-content-font-size-secondary, 13px)",
				color: "var(--dsw-alias-label-tertiary)"
			} }, data.summary)), react.default.createElement("div", { className: "care-card-body" }, data.body), openPrompts && (data.producer === OWN || data.producer.startsWith(OWN + ":")) ? react.default.createElement("button", {
				type: "button",
				onClick: () => openPrompts(sessionId, data.seq)
			}, t("promptsDetails"), " →") : null);
		}
		//#endregion
		//#region src/action-detail.js
		const ReactFragment = react.default.Fragment;
		const actionSources = (action) => action.shadowedSeqs ?? action.sourceSeqs ?? [];
		const change = (action) => `${number(action.beforeInput)} → ${number(action.afterInput)}`;
		function phaseTone(action) {
			if (action.phase === "failed") return "error";
			if (action.outcome === "partial" || action.phase === "commit-record-failed") return "warning";
			if (["committed", "completed"].includes(action.phase)) return "success";
			return "working";
		}
		/** Complete input prices and fixed shadow estimates are kept in separate groups. */
		function ActionRecord({ action, t, revealSource, onBack }) {
			const heading = useDetailHeading();
			const priced = Number.isFinite(action.beforeInput) && Number.isFinite(action.afterInput);
			const saving = priced ? action.beforeInput - action.afterInput : null;
			const sources = actionSources(action);
			const leaves = action.coverage?.leafSeqs ?? [];
			const bounds = leaves.reduce(([low, high], seq) => [Math.min(low, seq), Math.max(high, seq)], [Infinity, -Infinity]);
			const coverageRange = leaves.length ? `${number(bounds[0])} … ${number(bounds[1])}` : "—";
			return h("article", { className: "care-detail" }, onBack ? h("button", {
				type: "button",
				className: "care-back",
				onClick: onBack
			}, "← ", t("back")) : null, h("div", { className: "care-detail-heading" }, h("div", { className: "care-eyebrow" }, t("actionsHistory"), " · ", date(action.at)), h("h3", {
				tabIndex: -1,
				ref: heading
			}, label(t, "action", action.action)), h("div", { className: "care-request-state" }, badge(label(t, "phase", action.phase), phaseTone(action)), action.outcome ? h("span", null, label(t, "outcome", action.outcome)) : null)), h("div", { className: "care-result" }, h("div", { className: "care-eyebrow" }, t("inputUnits")), priced ? h(ReactFragment, null, h("div", { className: "care-change" }, h("div", null, h("span", null, t("before")), h("strong", null, number(action.beforeInput))), h("span", {
				className: "care-change-arrow",
				"aria-hidden": true
			}, "→"), h("div", null, h("span", null, t("after")), h("strong", null, number(action.afterInput)))), h("p", { className: "care-saving" }, t(saving >= 0 ? "saved" : "increased"), " ", number(Math.abs(saving)), " ", t("tokens"), action.beforeInput > 0 ? ` · ${Math.round(Math.abs(saving) / action.beforeInput * 100)}%` : "")) : h("p", { className: "care-muted" }, t("actionsMissingPrice"))), action.error || action.failure ? h("p", { role: "alert" }, action.error ?? action.failure.message) : null, ...(action.secondaryFailures ?? []).map((failure, index) => h("p", {
				role: "alert",
				key: index
			}, `${failure.phase}: ${failure.message}`)), h(Section, { title: t("actionsReason") }, h("p", null, action.reason ? label(t, "reason", action.reason) : t("actionsReasonUnknown")), action.rule ? h("dl", { className: "care-fields" }, row(t("actionsRule"), label(t, "rule", action.rule))) : null), action.replacements?.length ? h(Section, { title: t("replacementFlow") }, h("ol", { className: "care-timeline" }, ...action.replacements.map((replacement, index) => h("li", { key: index }, h("div", null, `${number(replacement.oldStartSeq)} … ${number(replacement.oldEndSeq)}`, h("span", { className: "care-muted" }, " → ", t("action_checkpoint"), ` #${replacement.newSeq}`)), h(JumpButton, {
				seq: replacement.newSeq,
				t,
				revealSource
			}))))) : action.checkpointSeq !== void 0 ? h(Section, { title: t("actionsCheckpoint") }, h("p", null, `#${action.checkpointSeq}`), h(JumpButton, {
				seq: action.checkpointSeq,
				t,
				revealSource
			})) : null, h(Section, { title: t("selectedSources") }, h(Sources, {
				sources,
				t,
				revealSource
			})), action.coverage ? h(Section, { title: t("coverageSources") }, h("div", { className: "care-coverage-summary" }, h("strong", null, number(leaves.length), " ", t("coverageCount")), h("span", null, t("actionsDepth"), " ", number(action.coverage.depth)), h("span", { className: "care-muted" }, t("range"), " ", coverageRange)), h(Sources, {
				sources: leaves,
				t,
				revealSource
			})) : null, (action.commits ?? []).length ? h(Section, { title: t("summaryWork") }, ...action.commits.map((commit, index) => h("div", {
				className: "care-evidence",
				key: index
			}, commit.route ? h("p", { className: "care-route" }, `${commit.route.provider} / ${commit.route.model}`) : null, h("dl", { className: "care-fields" }, commit.usage ? row(t("actionsSummaryUsage"), `${number(commit.usage.inputTokens)} / ${number(commit.usage.outputTokens)} ${t("tokens")}`) : null, Number.isFinite(commit.shadowedTokenCount) ? row(t("actionsShadowPrice"), `${number(commit.shadowedTokenCount)} ${t("tokens")}`) : null)))) : null, Number.isFinite(action.routeSaving) || Number.isFinite(action.heuristicSaving) ? h(Section, { title: t("actionsSavings") }, h("dl", { className: "care-fields" }, row(t("routeSaving"), number(action.routeSaving)), row(t("fixedSaving"), number(action.heuristicSaving)))) : null, action.comparisons?.length ? h(Section, { title: t("actionsCandidates") }, ...action.comparisons.map((candidate, index) => h("div", {
				className: "care-evidence",
				key: index
			}, `${candidate.start} … ${candidate.end}`, h("p", null, label(t, "rule", candidate.rule), " · ", number(candidate.expectedSaving), " ", t("tokens"))))) : null, h(Section, { title: t("audit") }, h("p", { className: "care-muted" }, t(action.auditStatus === "session-only" ? "actionsSessionOnly" : action.auditStatus === "partial" ? "actionsPartial" : action.journalPersisted ? "actionsPersisted" : "actionsRecovered"))), h(RawRecord, {
				value: action,
				t
			}));
		}
		//#endregion
		//#region src/action-view.js
		function Budget({ admission, t }) {
			const budget = admission?.budget;
			if (!budget) return h("p", { className: "care-empty" }, t("actionsNoAdmission"));
			const limit = budget.hardInput;
			const percent = Number.isFinite(budget.inputTokens) && Number.isFinite(limit) && limit > 0 ? budget.inputTokens / limit * 100 : null;
			return h("section", {
				className: "care-budget",
				"aria-label": t("actionsBudget")
			}, h("div", { className: "care-budget-heading" }, h("h4", null, t("actionsBudget")), badge(t(admission.dispatched === true ? "actionsSent" : admission.dispatched === false ? "actionsNotSent" : "deliveryUnknown"), admission.dispatched === true ? "success" : void 0)), h("div", { className: "care-figures" }, h("strong", null, number(budget.inputTokens)), h("span", { className: "care-muted" }, `/ ${number(limit)} ${t("tokens")}`)), h("div", { className: "care-muted" }, `${t("actionsUsage")}${percent === null ? "—" : `${Math.round(percent)}%`}`), percent === null ? null : h("div", {
				className: "care-meter",
				role: "meter",
				"aria-label": t("actionsUsage"),
				"aria-valuemin": 0,
				"aria-valuemax": 100,
				"aria-valuenow": Math.min(100, Math.round(percent)),
				"aria-valuetext": `${Math.round(percent)}%`,
				"data-over-limit": percent > 100 ? "" : void 0,
				style: { "--care-fill": `${Math.min(100, Math.max(0, percent))}%` }
			}, h("span"), Number.isFinite(budget.softInput) ? h("i", {
				style: { left: `${Math.min(100, Math.max(0, budget.softInput / limit * 100))}%` },
				title: `${t("actionsSoftLimit")} ${number(budget.softInput)}`
			}) : null), h("dl", { className: "care-fields" }, row(t("actionsSoftLimit"), number(budget.softInput)), row(t("actionsReleaseTarget"), number(budget.releaseTarget))), h("div", { className: "care-route" }, admission.route ? `${admission.route.provider} / ${admission.route.model}` : t("noRoute")), h("details", { className: "care-technical" }, h("summary", null, t("actionsTechnical")), h("dl", { className: "care-fields" }, row(t("actionsCapacity"), `${number(budget.physicalCapacity)} / ${number(budget.policyCapacity)}`), row(t("actionsRetention"), `${number(budget.retainTail)} / ${number(budget.completionTokens)}`), admission.pricing ? row(t("actionsBasis"), admission.pricing.kind ?? "—") : null, admission.pricing ? row(t("actionsTextScale"), Number.isFinite(admission.pricing.textScale) ? admission.pricing.textScale.toLocaleString(void 0, { maximumFractionDigits: 3 }) : "—") : null, admission.pricing ? row(t("actionsSample"), number(admission.pricing.sampleSeq)) : null, admission.rawInput ? row(t("actionsRawPrices"), `${number(admission.rawInput.textTokens)} / ${number(admission.rawInput.visualTokens)}`) : null), h(RawRecord, {
				value: admission,
				t
			})));
		}
		/** Summary rows lead to a single result detail rather than nested disclosure walls. */
		function ActionDetails({ value, t, revealSource }) {
			const { selected, select, recordRef } = useRecordSelection();
			if (value?.status !== "ready") return h("div", {
				role: value?.status === "error" ? "alert" : "status",
				className: "care-empty"
			}, t(value?.status === "error" ? "actionsUnavailable" : "actionsLoading"), value?.error ? h("div", null, `${t("actionsError")}: ${value.error}`) : null);
			const action = value.actions.find((item) => item.id === selected);
			if (action) return h(ActionRecord, {
				key: action.id,
				action,
				t,
				revealSource,
				onBack: () => select(null)
			});
			return h(react.default.Fragment, null, h(Budget, {
				admission: value.admission,
				t
			}), h("div", { className: "care-section-heading" }, h("h4", null, t("actionsHistory")), h("span", { className: "care-muted" }, `${value.total ?? value.actions.length}`)), value.actions.length ? h("ul", { className: "care-record-list" }, ...value.actions.map((item) => h("li", { key: item.id }, h("button", {
				type: "button",
				ref: recordRef(item.id),
				className: "care-record",
				onClick: () => select(item.id),
				"aria-label": `${label(t, "action", item.action)} · ${date(item.at)}`
			}, h("span", { className: "care-record-top" }, h("strong", null, label(t, "action", item.action)), h("time", null, date(item.at))), h("span", { className: "care-record-change" }, Number.isFinite(item.beforeInput) && Number.isFinite(item.afterInput) ? `${change(item)} ${t("tokens")}` : `${actionSources(item).length} ${t("actionsSourceCount")}`), h("span", { className: "care-record-preview" }, item.reason ? label(t, "reason", item.reason) : t("actionsReasonUnknown")), h("span", { className: "care-record-bottom" }, badge(label(t, "phase", item.phase), phaseTone(item)), item.outcome ? h("span", null, label(t, "outcome", item.outcome)) : null, h("span", null, "→")))))) : h("p", { className: "care-empty" }, t("actionsEmpty")));
		}
		/** Toolbar entries open the two native sidebar tabs. */
		function ContextCareActionsOpener({ sessionId, openActions, openPrompts, t }) {
			const [error, setError] = (0, react.useState)(null);
			const open = (callback) => {
				try {
					callback(sessionId);
					setError(null);
				} catch (failure) {
					setError(String(failure));
				}
			};
			return h("div", { "data-care-entry": "" }, h(CareStyles), h("button", {
				type: "button",
				title: t("actionsOpen"),
				"aria-label": t("actionsTitle"),
				onClick: () => open(openActions)
			}, h("svg", {
				width: 20,
				height: 20,
				viewBox: "0 0 24 24",
				fill: "none",
				stroke: "currentColor",
				strokeWidth: 1.5,
				"aria-hidden": true,
				focusable: false
			}, h("rect", {
				x: 3,
				y: 4,
				width: 18,
				height: 16,
				rx: 3
			}), h("path", { d: "M15 4v16M7 8h4M7 12h4" }))), openPrompts ? h("button", {
				type: "button",
				title: t("promptsOpen"),
				"aria-label": t("promptsTitle"),
				onClick: () => open(openPrompts)
			}, h("svg", {
				width: 20,
				height: 20,
				viewBox: "0 0 24 24",
				fill: "none",
				stroke: "currentColor",
				strokeWidth: 1.5,
				"aria-hidden": true
			}, h("path", { d: "M4 4h16v12H9l-5 4V4M8 8h8M8 12h5" }))) : null, error ? h("span", { role: "alert" }, `${t("actionsOpenFailed")}: ${error}`) : null);
		}
		/** Header and page controls stay reachable while details scroll. */
		function ContextCareActions({ sessionId, useCareActions, watchActions, refreshActions, revealSource, t }) {
			const [page, setPage] = (0, react.useState)({
				sessionId,
				offset: 0
			});
			const offset = page.sessionId === sessionId ? page.offset : 0;
			(0, react.useEffect)(() => watchActions(sessionId, offset), [
				sessionId,
				offset,
				watchActions
			]);
			const value = useCareActions((table) => table.get(`${sessionId}:${offset}`));
			const ready = value?.status === "ready";
			return h("section", {
				"data-context-care-actions": "",
				"data-care-panel": "",
				"aria-label": t("actionsTitle")
			}, h(CareStyles), h("header", null, h("h3", null, t("actionsTitle")), h("button", {
				type: "button",
				onClick: () => refreshActions(sessionId, offset)
			}, t("actionsRefresh"))), h("main", null, h(ActionDetails, {
				key: `${sessionId}:${offset}`,
				value,
				t,
				revealSource
			})), h("footer", null, h("span", {
				className: "care-muted",
				role: "status"
			}, `${t("actionsPage")} ${Math.floor(offset / 20) + 1}${ready && Number.isFinite(value.total) ? ` / ${Math.max(1, Math.ceil(value.total / 20))}` : ""}`), h("div", null, h("button", {
				type: "button",
				disabled: offset === 0,
				onClick: () => setPage({
					sessionId,
					offset: Math.max(0, offset - 20)
				})
			}, t("actionsPrevious")), h("button", {
				type: "button",
				disabled: !ready || value.nextOffset == null,
				onClick: () => setPage({
					sessionId,
					offset: value.nextOffset
				})
			}, t("actionsNext")))));
		}
		//#endregion
		//#region src/http-failure.js
		/** Preserve a Host diagnostic alongside the failed route and HTTP status. */
		async function httpFailure(response, route) {
			const status = `${route}: HTTP ${response.status}`;
			if (!response.headers?.get("content-type")?.includes("application/json")) return new Error(status);
			const body = await response.json();
			const detail = typeof body?.message === "string" ? body.message : typeof body?.error === "string" ? body.error : void 0;
			return new Error(detail ? `${status}: ${detail}` : status);
		}
		//#endregion
		//#region src/action-records.js
		/**
		* Own session-scoped HTTP snapshots for the framework's injected observable hook.
		* The component receives plain watch callbacks; no subscription logic lives in it.
		* @param options fetch function, polling interval and timer providers
		* @returns stable source, watch(sessionId, offset) disposer and unload disposer
		*/
		function createActionRecords({ fetcher = fetch, pollMs = 2e3, setTimer = setInterval, clearTimer = clearInterval, endpoint = "/context-care/actions", collection = "actions" } = {}) {
			let snapshot = /* @__PURE__ */ new Map();
			const listeners = /* @__PURE__ */ new Set();
			const watches = /* @__PURE__ */ new Map();
			let disposed = false;
			const publish = (key, value) => {
				if (disposed) return;
				snapshot = new Map(snapshot).set(key, value);
				for (const listener of listeners) listener();
			};
			async function load(watch) {
				if (disposed || watch.loading) return;
				watch.loading = true;
				try {
					const response = await fetcher(`${endpoint}?sessionId=${encodeURIComponent(watch.sessionId)}&limit=20&offset=${watch.offset}${watch.seq === void 0 ? "" : `&seq=${watch.seq}`}`, {
						signal: watch.controller.signal,
						headers: { accept: "application/json" }
					});
					if (!response.ok) throw await httpFailure(response, endpoint);
					const body = await response.json();
					if (!Array.isArray(body[collection])) throw new Error(`Invalid ${collection} response`);
					if (!watch.controller.signal.aborted) publish(watch.key, {
						status: "ready",
						...body
					});
				} catch (error) {
					if (!watch.controller.signal.aborted) publish(watch.key, {
						status: "error",
						error: String(error)
					});
				} finally {
					watch.loading = false;
				}
			}
			const timer = setTimer(() => {
				for (const watch of watches.values()) load(watch);
			}, pollMs);
			return {
				source: {
					getSnapshot: () => snapshot,
					subscribe(listener) {
						listeners.add(listener);
						return () => listeners.delete(listener);
					}
				},
				watch(sessionId, offset = 0, seq) {
					if (disposed) return () => {};
					const key = `${sessionId}:${offset}${seq === void 0 ? "" : `:${seq}`}`;
					let watch = watches.get(key);
					if (!watch) {
						watch = {
							key,
							sessionId,
							offset,
							seq,
							count: 0,
							controller: new AbortController(),
							loading: false
						};
						watches.set(key, watch);
						publish(key, { status: "loading" });
						load(watch);
					}
					watch.count++;
					return () => {
						if (--watch.count > 0) return;
						watches.delete(key);
						watch.controller.abort();
						snapshot = new Map(snapshot);
						snapshot.delete(key);
						for (const listener of listeners) listener();
					};
				},
				refresh(sessionId, offset = 0, seq) {
					const watch = watches.get(`${sessionId}:${offset}${seq === void 0 ? "" : `:${seq}`}`);
					if (watch) load(watch);
				},
				dispose() {
					disposed = true;
					clearTimer(timer);
					for (const watch of watches.values()) watch.controller.abort();
					watches.clear();
					listeners.clear();
					snapshot = /* @__PURE__ */ new Map();
				}
			};
		}
		//#endregion
		//#region src/rewrite-records.js
		/** Fetch rewrite facts and publish failures through the same client data owner. */
		function createRewriteRecords({ fetcher = fetch, pollMs = 2e3, setTimer = setInterval, clearTimer = clearInterval, report = (error) => console.error("context-care: rewrite journal unavailable", error), now = Date.now } = {}) {
			let records = /* @__PURE__ */ new Map();
			let health = { status: "loading" };
			let signature = "";
			let disposed = false;
			let loading = false;
			let failures = 0;
			let retryAt = 0;
			const controller = new AbortController();
			const listeners = /* @__PURE__ */ new Set();
			const notify = () => {
				for (const listener of listeners) listener();
			};
			const subscribe = (listener) => {
				listeners.add(listener);
				return () => listeners.delete(listener);
			};
			async function load() {
				if (disposed || loading || now() < retryAt) return;
				loading = true;
				try {
					const response = await fetcher("/context-care/rewrite-journal", {
						signal: controller.signal,
						headers: { accept: "application/json" }
					});
					if (!response.ok) throw await httpFailure(response, "/context-care/rewrite-journal");
					const body = await response.json();
					if (!Array.isArray(body?.records)) throw new Error("/context-care/rewrite-journal: invalid records response");
					if (disposed) return;
					const nextSignature = JSON.stringify(body.records);
					const changed = nextSignature !== signature || health.status !== "ready";
					if (nextSignature !== signature) {
						const next = /* @__PURE__ */ new Map();
						for (const record of body.records) {
							if (typeof record?.hash !== "string" || !record.hash || typeof record.sessionId !== "string") throw new Error("/context-care/rewrite-journal: invalid record");
							next.set(record.sessionId + ":" + record.hash, record);
						}
						signature = nextSignature;
						records = next;
					}
					failures = 0;
					retryAt = 0;
					health = { status: "ready" };
					if (changed) notify();
				} catch (error) {
					if (controller.signal.aborted) return;
					const message = error instanceof Error ? error.message : String(error);
					if (health.error !== message) report(error);
					health = {
						status: "error",
						error: message
					};
					failures++;
					retryAt = now() + pollMs * 2 ** Math.min(failures, 4);
					notify();
				} finally {
					loading = false;
				}
			}
			load();
			const timer = setTimer(() => {
				load();
			}, pollMs);
			return {
				records: {
					getSnapshot: () => records,
					subscribe
				},
				health: {
					getSnapshot: () => health,
					subscribe
				},
				dispose() {
					disposed = true;
					controller.abort();
					clearTimer(timer);
					listeners.clear();
				}
			};
		}
		//#endregion
		//#region src/prompt-detail.js
		/** Human titles are derived from recorded rule identity, not from body guesses. */
		function promptTitle(prompt, t) {
			const rule = prompt.segments?.[0]?.ruleId;
			if (rule === "completion-observation") return t("promptCompletion");
			if (rule === "output-pattern") return t("promptPattern");
			if (prompt.producer === "dsh-context-care:state") return t("promptState");
			if (prompt.producer === "dsh-context-care:loop") return t("promptLoop");
			return prompt.title || t(`prompt_${prompt.kind}`);
		}
		const evidenceWithoutBody = (value) => Object.fromEntries(Object.entries(value).filter(([key]) => ![
			"text",
			"sourceSeqs",
			"segmentId",
			"key",
			"operationId",
			"evaluationId",
			"callId"
		].includes(key)));
		function PromptRecord({ prompt, t, revealSource, onBack }) {
			const heading = useDetailHeading();
			return h("article", { className: "care-detail" }, onBack ? h("button", {
				type: "button",
				className: "care-back",
				onClick: onBack
			}, "← ", t("back")) : null, h("div", { className: "care-detail-heading" }, h("div", { className: "care-eyebrow" }, t(`prompt_${prompt.kind}`), " · ", date(prompt.at)), h("h3", {
				tabIndex: -1,
				ref: heading
			}, promptTitle(prompt, t)), prompt.kind === "request" ? h("p", { className: "care-muted" }, t("requestOnly")) : null, [
				"request",
				"message",
				"checkpoint"
			].includes(prompt.kind) ? h(JumpButton, {
				seq: prompt.seq,
				revealSource,
				t
			}) : null), h(Section, { title: t("evidence") }, prompt.source?.contextCareTrace ? h(Fields, {
				value: evidenceWithoutBody(prompt.source.contextCareTrace),
				t
			}) : null, ...(prompt.segments ?? []).map((segment, index) => h("div", {
				className: "care-evidence",
				key: index
			}, h("h4", null, t("ruleName"), " · ", evidenceValue(segment.ruleId, t)), h(Fields, {
				value: evidenceWithoutBody(segment),
				t
			}))), ...(prompt.evaluations ?? []).map((evaluation, index) => h("div", {
				className: "care-evidence",
				key: index
			}, h("h4", null, t("promptsEvaluations")), h(Fields, {
				value: evidenceWithoutBody(evaluation),
				t
			}))), !prompt.source?.contextCareTrace && !prompt.segments?.length && !prompt.evaluations?.length ? h("p", { className: "care-muted" }, t("promptsLegacyTrace")) : null), h(Section, { title: t("exactText") }, prompt.bodyStatus === "segments-only" ? h("p", { className: "care-muted" }, t("promptsSegmentsOnly")) : null, h(TextReader, {
				text: prompt.text,
				t
			})), h(Section, { title: t("requestRoute") }, (prompt.calls ?? []).length ? prompt.calls.map((call, index) => h("div", {
				key: index,
				className: "care-request"
			}, h("div", { className: "care-route" }, call.route ? `${call.route.provider} / ${call.route.model}` : t("noRoute")), h("div", { className: "care-request-state" }, badge(t(call.dispatched === true ? "actionsSent" : call.dispatched === false ? "actionsNotSent" : "deliveryUnknown"), call.dispatched === true ? "success" : void 0), h("span", { className: "care-muted" }, call.phase ? evidenceValue(call.phase, t) : t("phaseUnknown"))))) : h("p", { className: "care-muted" }, t("promptsNoCalls"))), h(Section, { title: t("promptsSources") }, (prompt.sources ?? []).length ? h(Sources, {
				sources: prompt.sources,
				t,
				revealSource
			}) : h("p", { className: "care-muted" }, t("promptsNoSources"))), h("dl", { className: "care-fields care-muted" }, row(t("producer"), prompt.producer)), h(RawRecord, {
				value: prompt,
				t
			}));
		}
		//#endregion
		//#region src/prompt-view.js
		/** One readable record at a time; a source selection opens its detail directly. */
		function PromptDetails({ value, t, selectedSeq, revealSource }) {
			const { selected, select, recordRef } = useRecordSelection(value?.prompts?.find((prompt) => selectedSeq !== void 0 && prompt.seq === selectedSeq)?.id ?? null);
			if (value?.status !== "ready") return h("p", {
				className: "care-empty",
				role: value?.status === "error" ? "alert" : "status"
			}, value?.error ?? t("actionsLoading"));
			const prompt = value.prompts.find((item) => item.id === selected);
			if (prompt) return h(PromptRecord, {
				key: prompt.id,
				prompt,
				t,
				revealSource,
				onBack: () => select(null)
			});
			return h(react.default.Fragment, null, h("p", { className: "care-intro" }, t("promptsExplanation")), value.selectedFound === false ? h("p", { role: "alert" }, t("promptsNotFound")) : null, h("div", { className: "care-section-heading" }, h("h4", null, t("pageScope")), h("span", { className: "care-muted" }, value.prompts.length, " ", t("recordCount"))), value.prompts.length ? h("ul", { className: "care-record-list" }, ...value.prompts.map((item) => h("li", { key: item.id }, h("button", {
				type: "button",
				ref: recordRef(item.id),
				className: "care-record",
				onClick: () => select(item.id),
				"aria-label": `${promptTitle(item, t)} · ${date(item.at)}`
			}, h("span", { className: "care-record-top" }, h("strong", null, promptTitle(item, t)), h("time", null, date(item.at))), h("span", { className: "care-record-preview" }, item.text?.replace(/\s+/g, " ").slice(0, 100)), h("span", { className: "care-record-bottom" }, h("span", null, t(`prompt_${item.kind}`)), h("span", null, t("promptPreview"), " →")))))) : h("p", { className: "care-empty" }, t("promptsEmpty")));
		}
		/** Paged records retain a source selection across refresh and reset it on session changes. */
		function ContextCarePrompts({ sessionId, useCarePrompts, useCarePromptSelection, watchPrompts, refreshPrompts, revealSource, t }) {
			const selection = useCarePromptSelection((map) => map.get(sessionId));
			const selectedSeq = selection?.seq;
			const [page, setPage] = (0, react.useState)({
				sessionId,
				selection,
				offset: 0,
				locate: true
			});
			const same = page.sessionId === sessionId && page.selection === selection;
			const offset = same ? page.offset : 0;
			const seq = !same || page.locate ? selectedSeq : void 0;
			(0, react.useEffect)(() => watchPrompts(sessionId, offset, seq), [
				sessionId,
				offset,
				seq,
				watchPrompts
			]);
			const value = useCarePrompts((map) => map.get(`${sessionId}:${offset}${seq === void 0 ? "" : `:${seq}`}`));
			const actualOffset = value?.offset ?? offset;
			const ready = value?.status === "ready";
			const navigate = (next) => setPage({
				sessionId,
				selection,
				offset: next,
				locate: false
			});
			return h("section", {
				"data-care-panel": "",
				"aria-label": t("promptsTitle")
			}, h(CareStyles), h("header", null, h("h3", null, t("promptsTitle")), h("button", {
				type: "button",
				onClick: () => refreshPrompts(sessionId, offset, seq)
			}, t("actionsRefresh"))), h("main", null, ready ? h(PromptDetails, {
				key: `${sessionId}:${actualOffset}:${seq}`,
				value,
				t,
				selectedSeq: seq,
				revealSource
			}) : h("p", {
				className: "care-empty",
				role: value?.status === "error" ? "alert" : "status"
			}, value?.error ?? t("actionsLoading"))), h("footer", null, h("span", { role: "status" }, `${t("actionsPage")} ${Math.floor(actualOffset / 20) + 1}${ready ? ` / ${Math.max(1, Math.ceil(value.total / 20))}` : ""}`), h("div", null, h("button", {
				type: "button",
				disabled: actualOffset === 0,
				onClick: () => navigate(Math.max(0, actualOffset - 20))
			}, t("actionsPrevious")), h("button", {
				type: "button",
				disabled: !ready || value.nextOffset == null,
				onClick: () => navigate(value.nextOffset)
			}, t("actionsNext")))));
		}
		//#endregion
		//#region src/source-navigation.js
		const failure = (code) => Object.assign(new Error(code), { code });
		/** Resolve exact message identity from the host's Chat projection, never a nearby turn. */
		function sourceTarget(seq, entries, nodes) {
			const event = entries.find((entry) => entry.event.seq === seq)?.event;
			if (!event) return null;
			if (["tool/call", "tool/result"].includes(event.type) && event.data.callId) return {
				attribute: "data-chat-call-id",
				id: event.data.callId
			};
			const kinds = {
				"user/message": [
					"user",
					"steering",
					"context",
					"turn-trigger",
					"compaction",
					"manual-compaction",
					"context-care-notice"
				],
				"assistant/message": ["assistant-step"],
				"system/message": ["system-prompt"],
				"request/header": ["system-prompt"],
				"developer/message": ["context"]
			}[event.type];
			if (!kinds) return null;
			const matches = nodes.filter((node) => kinds.includes(node.kind) && (node.data?.seq === seq || node.data?.finalNode?.seq === seq || node.data?.compaction?.seq === seq || ["system/message", "request/header"].includes(event.type) && node.id === String(seq)));
			const node = matches.find((node) => node.kind === "context-care-notice") ?? (matches.length === 1 ? matches[0] : null);
			return node ? {
				attribute: "data-chat-node-key",
				id: node.key
			} : null;
		}
		/** One bounded navigation owner per Session binding, released with that binding. */
		function createSourceNavigator({ binding, conversation, isCurrent, document: doc = globalThis.document }) {
			let generation = 0;
			let disposed = false;
			const pending = /* @__PURE__ */ new Map();
			const cancel = () => {
				generation++;
				for (const [timer, resolve] of pending) {
					clearTimeout(timer);
					resolve();
				}
				pending.clear();
			};
			const pause = () => new Promise((resolve) => {
				const timer = setTimeout(() => {
					pending.delete(timer);
					resolve();
				}, 50);
				pending.set(timer, resolve);
			});
			const root = () => {
				const roots = [...doc.querySelectorAll("[data-conversation-session][data-conversation-region=\"chat\"]")].filter((element) => element.getAttribute("data-conversation-session") === binding.sessionId && element.getClientRects().length);
				if (roots.length !== 1) throw failure("jumpOpenChat");
				return roots[0];
			};
			return {
				cancel,
				dispose() {
					disposed = true;
					cancel();
				},
				async reveal(seq) {
					cancel();
					const ticket = generation;
					const check = () => {
						if (disposed || ticket !== generation || !isCurrent()) throw failure("jumpCancelled");
					};
					check();
					if (!Number.isSafeInteger(seq) || seq < 0) throw failure("jumpUnavailable");
					root();
					await binding.session.loadThrough(seq);
					check();
					let entries = binding.eventSource.getSnapshot().entries;
					const source = entries.find((entry) => entry.event.seq === seq)?.event;
					if (source && ["tool/call", "tool/result"].includes(source.type)) {
						const call = entries.find((entry) => entry.event.type === "tool/call" && entry.event.data.callId === source.data.callId)?.event;
						const rootCallId = call?.data.rootCallId ?? source.data.rootCallId ?? source.data.callId;
						const rootCall = entries.find((entry) => entry.event.type === "tool/call" && entry.event.data.callId === rootCallId)?.event;
						if (!call || !rootCall) {
							await binding.session.loadThrough(0);
							check();
						} else if (rootCall.seq < seq) {
							await binding.session.loadThrough(rootCall.seq);
							check();
						}
					}
					let found = false;
					for (let attempt = 0; attempt < 40; attempt++) {
						check();
						const host = root();
						const nodes = conversation.snapshot.getSnapshot().views.get("chat")?.nodes.values() ?? [];
						const target = sourceTarget(seq, binding.eventSource.getSnapshot().entries, nodes);
						const card = target && [...host.querySelectorAll(`[${target.attribute}]`)].find((element) => element.getAttribute(target.attribute) === target.id);
						if (card) {
							found = true;
							const hidden = [];
							for (let element = card; element && element !== host; element = element.parentElement) if (element.hasAttribute("hidden")) hidden.push(element);
							if (hidden.length) {
								const outer = hidden.at(-1);
								if (outer.getAttribute("hidden") !== "until-found") throw failure("jumpHidden");
								outer.dispatchEvent(new doc.defaultView.Event("beforematch", { bubbles: false }));
							} else if (card.getClientRects().length) {
								card.dispatchEvent(new doc.defaultView.Event("beforematch", { bubbles: true }));
								card.scrollIntoView({
									block: "center",
									inline: "nearest",
									behavior: "instant"
								});
								await pause();
								check();
								if (!card.isConnected || card.closest("[hidden]")) continue;
								const box = card.getBoundingClientRect();
								const viewport = host.getBoundingClientRect();
								if (box.bottom > Math.max(0, viewport.top) && box.top < Math.min(doc.defaultView.innerHeight, viewport.bottom) && box.right > viewport.left && box.left < viewport.right) return {
									seq,
									...target
								};
							}
						}
						await pause();
					}
					throw failure(found ? "jumpUnsettled" : "jumpMissing");
				}
			};
		}
		/** Slots receive only the callback; live services remain inside the apply closure. */
		function sourceNavigation(ctx) {
			const owners = /* @__PURE__ */ new Map();
			ctx.effect(() => () => {
				for (const state of [...owners.values()]) state.release();
			});
			return (sessionId) => {
				const binding = ctx.sessions.binding(sessionId);
				if (!binding) throw new Error("context-care: Session binding unavailable");
				let state = owners.get(binding);
				if (!state) {
					const navigator = createSourceNavigator({
						binding,
						conversation: ctx.uiConversation.binding(binding),
						isCurrent: () => ctx.sessions.binding(sessionId) === binding && ctx.sidebarRight.mounted.getSnapshot() === sessionId
					});
					const stop = ctx.sidebarRight.mounted.subscribe(() => {
						if (ctx.sidebarRight.mounted.getSnapshot() !== sessionId) navigator.cancel();
					});
					let released = false;
					const release = () => {
						if (released) return;
						released = true;
						stop();
						navigator.dispose();
						owners.delete(binding);
					};
					state = {
						navigator,
						release
					};
					owners.set(binding, state);
					binding.ctx.effect(() => release, "context-care: source navigation lifetime");
				}
				return (seq) => state.navigator.reveal(seq);
			};
		}
		//#endregion
		//#region src/client.js
		const inject = [
			"slots",
			"locale",
			"uiConversation",
			"sessions",
			"sidebarRightTabs",
			"sidebarRight",
			"layout"
		];
		const ACTIONS_TAB = "dsh-context-care:actions";
		const PROMPTS_TAB = "dsh-context-care:prompts";
		/** Mount status, diagnostics and durable rewrite cards through native slots. */
		function apply(ctx) {
			ctx.effect(() => ctx.locale.register("dsh-context-care", dictionaries));
			const revealFor = sourceNavigation(ctx);
			const actions = createActionRecords();
			const rewrites = createRewriteRecords();
			const prompts = createActionRecords({
				endpoint: "/context-care/prompts",
				collection: "prompts"
			});
			let selection = /* @__PURE__ */ new Map();
			const selectionListeners = /* @__PURE__ */ new Set();
			const promptSelection = {
				getSnapshot: () => selection,
				subscribe(listener) {
					selectionListeners.add(listener);
					return () => selectionListeners.delete(listener);
				}
			};
			function openPrompts(sessionId, seq) {
				selection = new Map(selection).set(sessionId, { seq });
				for (const listener of selectionListeners) listener();
				ctx.sidebarRight.openTabIn(sessionId, PROMPTS_TAB);
				if (ctx.sidebarRight.isExpanded() !== true) ctx.layout.openRightbar(false, false);
			}
			ctx.effect(() => () => {
				actions.dispose();
				rewrites.dispose();
				prompts.dispose();
				selectionListeners.clear();
				selection.clear();
			});
			ctx.slots.inject("conversation.composer.dock", () => ctx.slots.register({
				name: "conversation.composer.dock",
				id: "context-care",
				order: 4,
				locale: "dsh-context-care",
				inject: () => ({
					hooks: {
						careActions: actions.source,
						rewriteHealth: rewrites.health
					},
					watchActions: actions.watch
				})
			}, ContextCareStatus));
			const t = ctx.locale.bind("dsh-context-care");
			ctx.effect(() => ctx.sidebarRightTabs.register({
				id: ACTIONS_TAB,
				kind: ACTIONS_TAB,
				title: () => t("actionsTitle")
			}));
			ctx.slots.inject("sidebar.right.pane.tab", () => ctx.slots.register({
				name: "sidebar.right.pane.tab",
				key: ACTIONS_TAB,
				locale: "dsh-context-care",
				inject: (sessionId) => ({
					hooks: { careActions: actions.source },
					watchActions: actions.watch,
					refreshActions: actions.refresh,
					revealSource: revealFor(sessionId)
				})
			}, ContextCareActions));
			ctx.effect(() => ctx.sidebarRightTabs.register({
				id: PROMPTS_TAB,
				kind: PROMPTS_TAB,
				title: () => t("promptsTitle")
			}));
			ctx.slots.inject("sidebar.right.pane.tab", () => ctx.slots.register({
				name: "sidebar.right.pane.tab",
				key: PROMPTS_TAB,
				locale: "dsh-context-care",
				inject: (sessionId) => ({
					hooks: {
						carePrompts: prompts.source,
						carePromptSelection: promptSelection
					},
					watchPrompts: prompts.watch,
					refreshPrompts: prompts.refresh,
					revealSource: revealFor(sessionId)
				})
			}, ContextCarePrompts));
			ctx.slots.inject("conversation.input.right", () => ctx.slots.register({
				name: "conversation.input.right",
				id: "context-care-actions",
				order: 5,
				locale: "dsh-context-care",
				inject: () => ({
					openPrompts,
					openActions(sessionId) {
						ctx.sidebarRight.openTabIn(sessionId, ACTIONS_TAB);
						if (ctx.sidebarRight.isExpanded() !== true) ctx.layout.openRightbar(false, false);
					}
				})
			}, ContextCareActionsOpener));
			ctx.effect(() => ctx.uiConversation.events.register(createNoticeDefinition()));
			ctx.slots.inject("conversation.chat.node", () => ctx.slots.register({
				name: "conversation.chat.node",
				key: NOTICE_NODE,
				locale: "dsh-context-care",
				inject: () => ({ openPrompts })
			}, NoticeNodeView));
			ctx.effect(() => ctx.uiConversation.events.register(createRewriteDefinition()));
			ctx.slots.inject("conversation.chat.node", () => ctx.slots.register({
				name: "conversation.chat.node",
				key: REWRITE_NODE,
				locale: "dsh-context-care",
				inject: () => ({ hooks: { rewriteRecords: rewrites.records } })
			}, RewriteNodeView));
		}
		//#endregion
		exports.apply = apply;
		exports.inject = inject;
		return module.exports;
	}
});

//# sourceMappingURL=client.js.map