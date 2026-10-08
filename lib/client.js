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
[data-care-panel], [data-care-entry], [data-context-care] {
  font-family: inherit;
  font-size: var(--dsh-content-font-size-secondary, 13px);
  line-height: calc(20px + var(--dsh-content-font-delta-secondary, 0px));
  font-variant-numeric: tabular-nums;
  color: var(--dsw-alias-label-secondary);
}
[data-care-entry] { display: inline-flex; align-items: center; position: relative; flex: none; }
[data-care-panel] { display: flex; flex-direction: column; height: 100%; min-height: 0; box-sizing: border-box; }
[data-care-panel] h3, [data-care-panel] h4 { margin: 0; font-size: inherit; font-weight: 500; color: var(--dsw-alias-label-primary); }
[data-care-panel] header { display: flex; align-items: center; justify-content: space-between; gap: 12px; padding: 16px; border-bottom: .5px solid var(--dsw-alias-border-l2); }
[data-care-panel] main { flex: 1; min-height: 0; overflow: auto; padding: 16px; scrollbar-width: thin; scrollbar-color: var(--dsw-alias-scrollbar-bg-l2) transparent; }
[data-care-panel] footer { display: flex; flex-wrap: wrap; align-items: center; justify-content: space-between; gap: 8px; padding: 12px 16px; border-top: .5px solid var(--dsw-alias-border-l2); }
[data-care-panel] button, [data-care-entry] button {
  display: inline-flex; align-items: center; justify-content: center; flex: none;
  gap: 6px; box-sizing: border-box; min-height: 28px; padding: 3px 10px;
  appearance: none; border: 0; border-radius: var(--dsw-radius-sm);
  background: transparent; color: var(--dsw-alias-label-secondary); font: inherit; cursor: pointer;
}
[data-care-entry] button { width: 28px; height: 28px; padding: 4px; }
[data-care-panel] button:hover:not(:disabled), [data-care-entry] button:hover { background: var(--dsw-alias-interactive-bg-hover); color: var(--dsw-alias-label-primary); }
[data-care-panel] button:active:not(:disabled), [data-care-entry] button:active { background: var(--dsw-alias-interactive-bg-active); }
[data-care-panel] button:disabled { opacity: .4; cursor: not-allowed; }
[data-care-panel] button:focus-visible, [data-care-panel] summary:focus-visible, [data-care-entry] button:focus-visible {
  outline: var(--dsw-focus-ring-width, 2px) solid var(--dsw-focus-ring-color, var(--dsw-alias-state-business-primary)); outline-offset: 2px;
}
[data-care-panel] .care-budget { padding: 16px; margin-bottom: 12px; border-radius: var(--dsw-radius-md); background: var(--dsw-alias-bg-layer-2); border: .5px solid var(--dsw-alias-border-l2); }
[data-care-panel] .care-budget-heading, [data-care-panel] .care-section-heading { display: flex; align-items: center; justify-content: space-between; gap: 12px; margin-bottom: 12px; }
[data-care-panel] .care-figures { display: flex; align-items: baseline; flex-wrap: wrap; gap: 6px; margin: 8px 0; }
[data-care-panel] .care-figures strong { font-size: calc(var(--dsh-content-font-size, 14px) + 10px); line-height: 1.4; font-weight: 500; color: var(--dsw-alias-label-primary); }
[data-care-panel] .care-meter { height: 4px; margin: 12px 0; border-radius: var(--dsw-radius-xs); overflow: hidden; background: var(--dsw-alias-interactive-bg-hover); }
[data-care-panel] .care-meter > span { display: block; height: 100%; width: var(--care-fill); background: var(--dsw-alias-state-business-primary); }
[data-care-panel] .care-meter[data-over-limit] > span { background: var(--dsw-alias-state-error-primary); }
[data-care-panel] .care-muted { color: var(--dsw-alias-label-tertiary); }
[data-care-panel] .care-route { overflow-wrap: anywhere; margin-top: 8px; }
[data-care-panel] dl { display: grid; grid-template-columns: minmax(100px, 1fr) minmax(0, 1.4fr); column-gap: 12px; row-gap: 8px; margin: 12px 0 0; }
[data-care-panel] dt { color: var(--dsw-alias-label-tertiary); }
[data-care-panel] dd { margin: 0; min-width: 0; overflow-wrap: anywhere; }
[data-care-panel] .care-technical { margin-bottom: 24px; }
[data-care-panel] summary { cursor: pointer; border-radius: var(--dsw-radius-sm); }
[data-care-panel] .care-technical > summary { padding: 6px 8px; color: var(--dsw-alias-label-tertiary); }
[data-care-panel] summary:hover { background: var(--dsw-alias-interactive-bg-hover); }
[data-care-panel] .care-action { border-top: .5px solid var(--dsw-alias-border-l2); }
[data-care-panel] .care-action > summary { display: grid; grid-template-columns: 16px minmax(0, 1fr); align-items: start; gap: 8px; list-style: none; padding: 12px 8px; }
[data-care-panel] .care-action > summary::-webkit-details-marker { display: none; }
[data-care-panel] .care-chevron { margin-top: 3px; color: var(--dsw-alias-label-tertiary); }
[data-care-panel] .care-action[open] .care-chevron { transform: rotate(90deg); }
[data-care-panel] .care-action-title { display: flex; flex-wrap: wrap; align-items: center; gap: 8px; color: var(--dsw-alias-label-primary); }
[data-care-panel] .care-action-time { margin-left: auto; color: var(--dsw-alias-label-tertiary); font-size: calc(var(--dsh-content-font-size-secondary, 13px) - 1px); }
[data-care-panel] .care-action-change { display: block; margin-top: 4px; color: var(--dsw-alias-label-secondary); }
[data-care-panel] .care-action dl { margin: 0 8px 16px 32px; }
[data-care-panel] .care-badge { display: inline-flex; align-items: center; gap: 4px; font-size: calc(var(--dsh-content-font-size-secondary, 13px) - 1px); color: var(--dsw-alias-label-tertiary); }
[data-care-panel] .care-badge::before { content: ''; width: 5px; height: 5px; border-radius: 50%; corner-shape: round; background: currentColor; }
[data-care-panel] .care-badge[data-tone='success'] { color: var(--dsw-alias-state-success-primary); }
[data-care-panel] .care-badge[data-tone='error'] { color: var(--dsw-alias-state-error-primary); }
[data-care-panel] .care-badge[data-tone='working'] { color: var(--dsw-alias-state-business-primary); }
[data-care-panel] .care-badge[data-tone='warning'] { color: var(--dsw-alias-state-warn-label); }
[data-care-panel] .care-prompt-detail { margin: 0 8px 16px 32px; min-width: 0; }
[data-care-panel] .care-prompt-detail section { margin-top: 16px; }
[data-care-panel] .care-prompt-text { white-space: pre-wrap; overflow-wrap: anywhere; font: inherit; color: var(--dsw-alias-label-primary); padding: 10px; border-radius: var(--dsw-radius-sm); background: var(--dsw-alias-bg-layer-2); }
[data-care-panel] .care-empty { margin: 0; padding: 24px 8px; color: var(--dsw-alias-label-tertiary); }
[data-care-panel] [role='alert'] { padding: 12px; border-radius: var(--dsw-radius-sm); background: var(--dsw-alias-interactive-bg-hover-danger); color: var(--dsw-alias-state-error-primary); overflow-wrap: anywhere; }
[data-care-entry] [role='alert'] { position: absolute; bottom: calc(100% + 8px); right: 0; width: 240px; padding: 12px; border-radius: var(--dsw-radius-sm); background: var(--dsw-alias-bg-layer-2); color: var(--dsw-alias-state-error-primary); box-shadow: var(--dsw-elevation-panel); overflow-wrap: anywhere; z-index: 1; }
[data-context-care] { display: flex; flex-wrap: wrap; align-items: center; gap: 12px; padding: 1px 4px; font-size: calc(var(--dsh-content-font-size-secondary, 13px) - 1px); }
[data-context-care] > span { font-weight: 500; }
`.trim();
		function CareStyles() {
			return react.default.createElement("style", null, css);
		}
		//#endregion
		//#region src/client-view.js
		const dictionaries = {
			zh: {
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
				style: { color: "var(--dsw-alias-state-error-primary)" }
			}, "− " + oneLine(removed)));
			if (added.length > 0) rows.push(react.default.createElement("div", {
				key: "added",
				style: { color: "var(--dsw-alias-state-success-primary)" }
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
				style: {
					borderLeft: "3px solid var(--dsw-alias-state-warn-primary)",
					padding: "6px 10px",
					margin: "6px 0",
					background: "var(--dsw-alias-bg-secondary)"
				}
			}, react.default.createElement("strong", null, t("rewriteTitle")), ...hits.map((hit, index) => react.default.createElement("div", { key: index }, (hit.pattern ?? t("rewriteUnknown")) + " · " + hit.charsBefore + " → " + hit.charsAfter + " " + t("rewriteChars"), Number.isSafeInteger(hit.removedLines) ? " · " + t("rewriteRemoved") + " " + hit.removedLines + " " + t("rewriteLines") : "", ...snippetRows(hit))));
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
				style: {
					borderLeft: "2px solid var(--dsw-alias-border-l3, rgba(127,127,127,.35))",
					background: "var(--dsw-alias-bg-secondary, rgba(127,127,127,.06))",
					borderRadius: "var(--dsw-radius-md, 6px)",
					padding: "8px 12px",
					margin: "8px 0"
				}
			}, react.default.createElement("div", { style: {
				display: "flex",
				alignItems: "baseline",
				gap: "10px",
				flexWrap: "wrap",
				marginBottom: 6
			} }, react.default.createElement("span", { style: {
				fontSize: "var(--dsh-content-font-size-secondary, 13px)",
				fontWeight: 600,
				color: "var(--dsw-alias-label-secondary)"
			} }, noticeLabel(data.producer, t)), data.values.length > 0 ? react.default.createElement("span", { style: { fontSize: "var(--dsh-content-font-size-secondary, 13px)" } }, valueRow(data.values, t)) : data.summary === "" ? null : react.default.createElement("span", { style: {
				fontSize: "var(--dsh-content-font-size-secondary, 13px)",
				color: "var(--dsw-alias-label-tertiary)"
			} }, data.summary)), react.default.createElement("div", { style: {
				fontSize: "var(--dsh-content-font-size, 14px)",
				lineHeight: "22px",
				color: "var(--dsw-alias-label-primary)",
				whiteSpace: "pre-wrap",
				wordBreak: "break-word"
			} }, data.body), openPrompts && (data.producer === OWN || data.producer.startsWith(OWN + ":")) ? react.default.createElement("button", {
				type: "button",
				onClick: () => openPrompts(sessionId, data.seq),
				style: {
					font: "inherit",
					color: "var(--dsw-alias-label-secondary)",
					background: "transparent",
					border: 0,
					cursor: "pointer",
					marginTop: 6
				}
			}, t("promptsDetails")) : null);
		}
		//#endregion
		//#region src/action-view.js
		const h$1 = react.default.createElement;
		const number = (value) => Number.isFinite(value) ? Math.round(value).toLocaleString() : "—";
		const ratio = (value) => Number.isFinite(value) ? value.toLocaleString(void 0, { maximumFractionDigits: 3 }) : "—";
		const row = (label, value, raw) => h$1(react.default.Fragment, { key: label }, h$1("dt", null, label), h$1("dd", raw ? { title: String(raw) } : null, value));
		const change = (action) => `${number(action.beforeInput)} → ${number(action.afterInput)}`;
		const badge = (label, tone) => h$1("span", {
			className: "care-badge",
			"data-tone": tone
		}, label);
		const date = (at) => Number.isFinite(at) ? new Date(at).toLocaleString(void 0, {
			month: "2-digit",
			day: "2-digit",
			hour: "2-digit",
			minute: "2-digit"
		}) : null;
		function phaseTone(action) {
			if (action.phase === "failed") return "error";
			if (action.outcome === "partial" || action.phase === "commit-record-failed") return "warning";
			if (["committed", "completed"].includes(action.phase)) return "success";
			return [
				"started",
				"planning",
				"prepared",
				"repaired"
			].includes(action.phase) ? "working" : void 0;
		}
		function Budget({ admission, t }) {
			const budget = admission?.budget;
			if (!budget) return h$1("p", { className: "care-empty" }, t("actionsNoAdmission"));
			const limit = budget.hardInput;
			const percent = Number.isFinite(budget.inputTokens) && Number.isFinite(limit) && limit > 0 ? budget.inputTokens / limit * 100 : null;
			return h$1(react.default.Fragment, null, h$1("section", {
				className: "care-budget",
				"aria-label": t("actionsBudget")
			}, h$1("div", { className: "care-budget-heading" }, h$1("h4", null, t("actionsBudget")), badge(t(admission.dispatched ? "actionsSent" : "actionsNotSent"), admission.dispatched ? "success" : void 0)), h$1("div", { className: "care-figures" }, h$1("strong", null, number(budget.inputTokens)), h$1("span", { className: "care-muted" }, `/ ${number(limit)} tok`)), h$1("div", { className: "care-muted" }, `${t("actionsUsage")}${percent === null ? "—" : `${Math.round(percent)}%`}`), percent === null ? null : h$1("div", {
				className: "care-meter",
				role: "meter",
				"aria-label": t("actionsUsage"),
				"aria-valuemin": 0,
				"aria-valuemax": 100,
				"aria-valuenow": Math.min(100, Math.round(percent)),
				"aria-valuetext": `${Math.round(percent)}%`,
				"data-over-limit": percent > 100 ? "" : void 0,
				style: { "--care-fill": `${Math.min(100, Math.max(0, percent))}%` }
			}, h$1("span")), h$1("dl", null, row(t("actionsSoftLimit"), number(budget.softInput)), row(t("actionsReleaseTarget"), number(budget.releaseTarget))), h$1("div", { className: "care-route" }, admission.route ? `${admission.route.provider} / ${admission.route.model}` : "—")), h$1("details", { className: "care-technical" }, h$1("summary", null, t("actionsTechnical")), h$1("dl", null, row(t("actionsCapacity"), `${number(budget.physicalCapacity)} / ${number(budget.policyCapacity)}`), row(t("actionsRetention"), `${number(budget.retainTail)} / ${number(budget.completionTokens)}`), admission.pricing ? row(t("actionsBasis"), admission.pricing.kind ?? "—") : null, admission.pricing ? row(t("actionsTextScale"), ratio(admission.pricing.textScale), admission.pricing.textScale) : null, admission.pricing ? row(t("actionsSample"), number(admission.pricing.sampleSeq)) : null, admission.rawInput ? row(t("actionsRawPrices"), `${number(admission.rawInput.textTokens)} / ${number(admission.rawInput.visualTokens)}`) : null)));
		}
		function Action({ action, t }) {
			const at = date(action.at);
			const priced = Number.isFinite(action.beforeInput) && Number.isFinite(action.afterInput);
			const sources = action.shadowedSeqs ?? action.sourceSeqs ?? [];
			return h$1("details", { className: "care-action" }, h$1("summary", null, h$1("svg", {
				className: "care-chevron",
				width: 14,
				height: 14,
				viewBox: "0 0 16 16",
				"aria-hidden": true
			}, h$1("path", {
				d: "m6 3 5 5-5 5",
				fill: "none",
				stroke: "currentColor",
				strokeWidth: 1.5
			})), h$1("span", null, h$1("span", { className: "care-action-title" }, t(`action_${action.action}`), badge(t(`phase_${action.phase}`), phaseTone(action)), at ? h$1("time", {
				className: "care-action-time",
				dateTime: new Date(action.at).toISOString(),
				title: new Date(action.at).toLocaleString()
			}, at) : null), h$1("span", { className: "care-action-change" }, priced ? `${change(action)} tok` : `${sources.length} ${t("actionsSourceCount")}`, action.outcome ? ` · ${t(`outcome_${action.outcome}`)}` : ""), h$1("span", { className: "care-action-change care-muted" }, action.reason ? t(`reason_${action.reason}`) : t("actionsReasonUnknown")))), h$1("dl", null, row(t("actionsIdentity"), action.id), action.rule ? row(t("actionsRule"), t(`rule_${action.rule}`)) : null, row(t("actionsSources"), h$1("details", null, h$1("summary", null, `${sources.length} ${t("actionsSourceCount")}`), sources.join(", "))), row(t("actionsPrice"), priced ? change(action) : t("actionsMissingPrice")), priced || Number.isFinite(action.routeSaving) || Number.isFinite(action.heuristicSaving) ? row(t("actionsSavings"), `${number(action.routeSaving ?? (Number.isFinite(action.beforeInput) && Number.isFinite(action.afterInput) ? action.beforeInput - action.afterInput : void 0))} / ${number(action.heuristicSaving)}`) : null, ...(action.replacements ?? []).map((replacement, index) => row(`${t("actionsReplacement")} ${index + 1}`, `${replacement.oldStartSeq} … ${replacement.oldEndSeq} → ${replacement.newSeq}`)), action.checkpointSeq !== void 0 ? row(t("actionsCheckpoint"), number(action.checkpointSeq)) : null, action.coverage ? row(t("actionsCoverage"), `${action.coverage.leafSeqs.join(", ")} · ${t("actionsDepth")}: ${action.coverage.depth}`) : null, action.comparisons ? row(t("actionsCandidates"), action.comparisons.map((candidate) => `${candidate.start} … ${candidate.end}: ${t(`rule_${candidate.rule}`)}, ${number(candidate.expectedSaving)}`).join("; ")) : null, action.error || action.failure ? row(t("actionsError"), h$1("span", { role: "alert" }, action.error ?? action.failure.message)) : null, ...(action.secondaryFailures ?? []).map((failure, index) => row(`${t("actionsError")} ${index + 1}`, `${failure.phase}: ${failure.message}`)), ...(action.commits ?? []).flatMap((commit, index) => [
				commit.route?.provider ? row(`${t("actionsSummaryRoute")} ${index + 1}`, `${commit.route.provider} / ${commit.route.model}`) : null,
				Number.isFinite(commit.shadowedTokenCount) ? row(`${t("actionsShadowPrice")} ${index + 1}`, `${number(commit.shadowedTokenCount)} tok`) : null,
				commit.usage ? row(`${t("actionsSummaryUsage")} ${index + 1}`, `${number(commit.usage.inputTokens)} / ${number(commit.usage.outputTokens)} tok`) : null
			]), action.auditKeys?.length ? row(t("actionsAuditKeys"), action.auditKeys.join(", ")) : null, row(t("actionsJournal"), t(action.auditStatus === "session-only" ? "actionsSessionOnly" : action.auditStatus === "partial" ? "actionsPartial" : action.journalPersisted ? "actionsPersisted" : "actionsRecovered"))));
		}
		/** Request and maintenance facts remain available behind readable summaries. */
		function ActionDetails({ value, t }) {
			if (value?.status !== "ready") return h$1("div", {
				role: value?.status === "error" ? "alert" : "status",
				className: "care-empty"
			}, t(value?.status === "error" ? "actionsUnavailable" : "actionsLoading"), value?.error ? h$1("div", null, `${t("actionsError")}: ${value.error}`) : null);
			return h$1(react.default.Fragment, null, h$1(Budget, {
				admission: value.admission,
				t
			}), h$1("div", { className: "care-section-heading" }, h$1("h4", null, t("actionsHistory")), h$1("span", { className: "care-muted" }, `${value.total ?? value.actions.length}`)), value.actions.length ? value.actions.map((action) => h$1(Action, {
				key: action.id,
				action,
				t
			})) : h$1("p", { className: "care-empty" }, t("actionsEmpty")));
		}
		/** An operation belongs in the composer toolbar, independently of status. */
		function ContextCareActionsOpener({ sessionId, openActions, openPrompts, t }) {
			const [error, setError] = (0, react.useState)(null);
			return h$1("div", { "data-care-entry": "" }, h$1(CareStyles), h$1("button", {
				type: "button",
				title: t("actionsOpen"),
				"aria-label": t("actionsTitle"),
				onClick: () => {
					try {
						openActions(sessionId);
						setError(null);
					} catch (failure) {
						setError(String(failure));
					}
				}
			}, h$1("svg", {
				width: 20,
				height: 20,
				viewBox: "0 0 24 24",
				fill: "none",
				stroke: "currentColor",
				strokeWidth: 1.5,
				"aria-hidden": true,
				focusable: false
			}, h$1("rect", {
				x: 3,
				y: 4,
				width: 18,
				height: 16,
				rx: 3
			}), h$1("path", { d: "M15 4v16M7 8h4M7 12h4" }))), openPrompts ? h$1("button", {
				type: "button",
				title: t("promptsOpen"),
				"aria-label": t("promptsTitle"),
				onClick: () => {
					try {
						openPrompts(sessionId);
						setError(null);
					} catch (failure) {
						setError(String(failure));
					}
				}
			}, h$1("svg", {
				width: 20,
				height: 20,
				viewBox: "0 0 24 24",
				fill: "none",
				stroke: "currentColor",
				strokeWidth: 1.5,
				"aria-hidden": true
			}, h$1("path", { d: "M4 4h16v12H9l-5 4V4M8 8h8M8 12h5" }))) : null, error ? h$1("span", { role: "alert" }, `${t("actionsOpenFailed")}: ${error}`) : null);
		}
		/** Only the body scrolls; paging and refresh remain reachable in a narrow pane. */
		function ContextCareActions({ sessionId, useCareActions, watchActions, refreshActions, t }) {
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
			return h$1("section", {
				"data-context-care-actions": "",
				"data-care-panel": "",
				"aria-label": t("actionsTitle")
			}, h$1(CareStyles), h$1("header", null, h$1("h3", null, t("actionsTitle")), h$1("button", {
				type: "button",
				onClick: () => refreshActions(sessionId, offset)
			}, t("actionsRefresh"))), h$1("main", { key: `${sessionId}:${offset}` }, h$1(ActionDetails, {
				value,
				t
			})), h$1("footer", null, h$1("span", {
				className: "care-muted",
				role: "status"
			}, `${t("actionsPage")} ${Math.floor(offset / 20) + 1}${ready && Number.isFinite(value.total) ? ` / ${Math.max(1, Math.ceil(value.total / 20))}` : ""}`), h$1("div", null, h$1("button", {
				type: "button",
				disabled: offset === 0,
				onClick: () => setPage({
					sessionId,
					offset: Math.max(0, offset - 20)
				})
			}, t("actionsPrevious")), h$1("button", {
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
		//#region src/prompt-view.js
		const h = react.default.createElement;
		const raw = (value) => h("pre", { className: "care-prompt-text" }, JSON.stringify(value, null, 2));
		/** Full injected text and its durable references, including request-only prompts. */
		function PromptDetails({ value, t, selectedSeq }) {
			if (value?.status !== "ready") return h("p", {
				className: "care-empty",
				role: value?.status === "error" ? "alert" : "status"
			}, value?.error ?? t("actionsLoading"));
			return h(react.default.Fragment, null, h("p", { className: "care-muted" }, t("promptsExplanation")), value.selectedFound === false ? h("p", { role: "alert" }, t("promptsNotFound")) : null, value.prompts.length ? value.prompts.map((prompt) => h("details", {
				className: "care-action",
				key: prompt.id,
				open: prompt.seq === selectedSeq || void 0
			}, h("summary", null, h("span", { className: "care-chevron" }, "›"), h("span", null, h("span", { className: "care-action-title" }, noticeLabel(prompt.producer, t), prompt.seq === void 0 ? "" : ` · #${prompt.seq}`), h("span", { className: "care-action-change" }, prompt.title || t(`prompt_${prompt.kind}`)))), h("div", { className: "care-prompt-detail" }, prompt.bodyStatus === "segments-only" ? h("p", { className: "care-muted" }, t("promptsSegmentsOnly")) : null, h("pre", { className: "care-prompt-text" }, prompt.text), h("dl", null, h("dt", null, t("promptsSource")), h("dd", null, prompt.producer), h("dt", null, t("promptsTime")), h("dd", null, Number.isFinite(prompt.at) ? new Date(prompt.at).toLocaleString() : t("promptsNotRecorded")), h("dt", null, t("promptsIdentity")), h("dd", null, prompt.id)), prompt.source?.contextCareTrace ? h("section", null, h("h4", null, t("promptsTrigger")), raw(prompt.source.contextCareTrace)) : null, prompt.kind === "message" && !prompt.source?.contextCareTrace ? h("p", { className: "care-muted" }, t("promptsLegacyTrace")) : null, prompt.evaluations?.length ? h("section", null, h("h4", null, t("promptsEvaluations")), raw(prompt.evaluations)) : null, ...(prompt.segments ?? []).map((segment, index) => h("section", { key: index }, h("h4", null, `${t("promptsSegment")} ${index + 1} · ${segment.ruleId}`), raw(segment))), h("section", null, h("h4", null, t("promptsCalls")), prompt.calls.length ? raw(prompt.calls) : h("p", { className: "care-muted" }, t("promptsNoCalls"))), h("section", null, h("h4", null, t("promptsSources")), prompt.sources.length ? prompt.sources.map((source) => h("details", { key: source.seq }, h("summary", null, `#${source.seq} · ${source.type}${source.truncated ? ` · ${t("promptsExcerpt")}` : ""}`), h("pre", { className: "care-prompt-text" }, source.excerpt || t("promptsNotRecorded")))) : h("p", { className: "care-muted" }, t("promptsNoSources")))))) : h("p", { className: "care-empty" }, t("promptsEmpty")));
		}
		/** A separate paged prompt collection retains event selection across refresh and clears it on session change. */
		function ContextCarePrompts({ sessionId, useCarePrompts, useCarePromptSelection, watchPrompts, refreshPrompts, t }) {
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
			}, t("actionsRefresh"))), h("main", { key: `${sessionId}:${actualOffset}:${selectedSeq}` }, h(PromptDetails, {
				value,
				t,
				selectedSeq
			})), h("footer", null, h("span", { role: "status" }, `${t("actionsPage")} ${Math.floor(actualOffset / 20) + 1}${ready ? ` / ${Math.max(1, Math.ceil(value.total / 20))}` : ""}`), h("div", null, h("button", {
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
		//#region src/client.js
		const inject = [
			"slots",
			"locale",
			"uiConversation",
			"sidebarRightTabs",
			"sidebarRight",
			"layout"
		];
		const ACTIONS_TAB = "dsh-context-care:actions";
		const PROMPTS_TAB = "dsh-context-care:prompts";
		/** Mount status, diagnostics and durable rewrite cards through native slots. */
		function apply(ctx) {
			ctx.effect(() => ctx.locale.register("dsh-context-care", dictionaries));
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
				inject: () => ({
					hooks: { careActions: actions.source },
					watchActions: actions.watch,
					refreshActions: actions.refresh
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
				inject: () => ({
					hooks: {
						carePrompts: prompts.source,
						carePromptSelection: promptSelection
					},
					watchPrompts: prompts.watch,
					refreshPrompts: prompts.refresh
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