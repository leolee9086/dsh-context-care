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
				actionsPrevious: "较新记录",
				actionsNext: "更早记录",
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
				actionsPrevious: "Newer records",
				actionsNext: "Older records",
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
				"#3b82f6",
				"#14b8a6",
				"var(--dsw-alias-state-success-primary)"
			] : [
				"var(--dsw-alias-state-success-primary)",
				"#3b82f6",
				"var(--dsw-alias-state-warn-primary)",
				"var(--dsw-alias-state-error-primary)"
			])[value < 30 ? 0 : value < 60 ? 1 : value < 85 ? 2 : 3];
		}
		function indicator(label, value, level, kind, t) {
			const text = value === null || value === void 0 ? `${label}: ${t("unknown")}` : `${label}: ${value}% (${t(level)})`;
			return react.default.createElement("span", { style: {
				color: tone(value, kind),
				fontWeight: 600
			} }, text);
		}
		/** Pure display receives the framework-owned projection hook. */
		function ContextCareStatus({ useProjection, t }) {
			const state = useProjection("contextCareNumeric");
			return react.default.createElement("div", {
				"data-context-care": "",
				role: "status",
				title: t("description"),
				style: {
					display: "flex",
					flexWrap: "wrap",
					gap: "12px",
					alignItems: "center",
					fontSize: "12px",
					color: "var(--dsw-alias-label-secondary)",
					padding: "2px 4px"
				}
			}, indicator(t("fatigue"), state?.fatigueValue, state?.fatigue ?? "unknown", "fatigue", t), indicator(t("wakefulness"), state?.wakefulnessValue, state?.wakefulness ?? "unknown", "wakefulness", t), !state ? react.default.createElement("span", null, t("waiting")) : null);
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
		function NoticeNodeView({ node, t }) {
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
			} }, data.body));
		}
		//#endregion
		//#region src/action-view.js
		const number = (value) => Number.isFinite(value) ? Math.round(value).toLocaleString() : "—";
		const row = (label, value) => react.default.createElement("div", { key: label }, `${label}: ${value}`);
		/** Pure display of admission and immutable maintenance facts; no request contents. */
		function ActionDetails({ value, t }) {
			if (value?.status !== "ready") return react.default.createElement("div", { role: "status" }, t(value?.status === "error" ? "actionsUnavailable" : "actionsLoading"));
			const budget = value.admission?.budget;
			return react.default.createElement("div", { style: {
				maxHeight: "50vh",
				overflow: "auto",
				padding: "6px 0",
				overflowWrap: "anywhere"
			} }, budget ? react.default.createElement("div", null, row(t("actionsAdmission"), `${value.admission.route.provider} / ${value.admission.route.model}`), row(t("actionsInput"), number(budget.inputTokens)), value.admission.pricing ? row(t("actionsBasis"), `${value.admission.pricing.kind ?? "—"} · ${t("actionsTextScale")}: ${value.admission.pricing.textScale ?? "—"} · ${t("actionsSample")}: ${number(value.admission.pricing.sampleSeq)}`) : null, value.admission.rawInput ? row(t("actionsRawPrices"), `${number(value.admission.rawInput.textTokens)} / ${number(value.admission.rawInput.visualTokens)}`) : null, row(t("actionsCapacity"), `${number(budget.physicalCapacity)} / ${number(budget.policyCapacity)}`), row(t("actionsLimits"), `${number(budget.softInput)} / ${number(budget.hardInput)} / ${number(budget.releaseTarget)}`), row(t("actionsRetention"), `${number(budget.retainTail)} / ${number(budget.completionTokens)}`), row(t("actionsDispatch"), t(value.admission.dispatched ? "actionsSent" : "actionsNotSent"))) : react.default.createElement("div", null, t("actionsNoAdmission")), ...value.actions.map((action) => react.default.createElement("details", {
				key: action.id,
				style: {
					borderTop: "1px solid var(--dsw-alias-border-primary)",
					padding: "5px 0"
				}
			}, react.default.createElement("summary", null, `${t(`action_${action.action}`)} · ${t(`phase_${action.phase}`)}${action.outcome ? ` · ${t(`outcome_${action.outcome}`)}` : ""}`), row(t("actionsIdentity"), action.id), action.rule ? row(t("actionsRule"), t(`rule_${action.rule}`)) : null, row(t("actionsSources"), (action.shadowedSeqs ?? action.sourceSeqs ?? []).join(", ") || "—"), row(t("actionsPrice"), `${number(action.beforeInput)} → ${number(action.afterInput)}`), row(t("actionsSavings"), `${number(action.routeSaving ?? (action.beforeInput === void 0 || action.afterInput === void 0 ? void 0 : action.beforeInput - action.afterInput))} / ${number(action.heuristicSaving)}`), ...(action.replacements ?? []).map((replacement, index) => row(`${t("actionsReplacement")} ${index + 1}`, `${replacement.oldStartSeq} … ${replacement.oldEndSeq} → ${replacement.newSeq}`)), action.checkpointSeq !== void 0 ? row(t("actionsCheckpoint"), number(action.checkpointSeq)) : null, action.coverage ? row(t("actionsCoverage"), `${action.coverage.leafSeqs.join(", ")} · ${t("actionsDepth")}: ${action.coverage.depth}`) : null, action.comparisons ? row(t("actionsCandidates"), action.comparisons.map((candidate) => `${candidate.start} … ${candidate.end}: ${t(`rule_${candidate.rule}`)}, ${number(candidate.expectedSaving)}`).join("; ")) : null, action.error || action.failure ? row(t("actionsError"), action.error ?? action.failure.message) : null, row(t("actionsJournal"), t(action.journalPersisted ? "actionsPersisted" : "actionsRecovered")))), value.actions.length ? null : react.default.createElement("div", null, t("actionsEmpty")));
		}
		/** Framework hooks deliver reactive facts; local state owns only paging. */
		function ContextCareActions({ sessionId, useCareActions, watchActions, t }) {
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
			return react.default.createElement("details", { style: {
				fontSize: "12px",
				color: "var(--dsw-alias-label-secondary)"
			} }, react.default.createElement("summary", null, t("actionsTitle")), react.default.createElement(ActionDetails, {
				value,
				t
			}), react.default.createElement("div", { style: {
				display: "flex",
				gap: "8px",
				padding: "4px 0"
			} }, react.default.createElement("button", {
				type: "button",
				disabled: offset === 0,
				onClick: () => setPage({
					sessionId,
					offset: Math.max(0, offset - 20)
				})
			}, t("actionsPrevious")), react.default.createElement("button", {
				type: "button",
				disabled: value?.nextOffset == null,
				onClick: () => setPage({
					sessionId,
					offset: value.nextOffset
				})
			}, t("actionsNext"))));
		}
		//#endregion
		//#region src/action-records.js
		/**
		* Own session-scoped HTTP snapshots for the framework's injected observable hook.
		* The component receives plain watch callbacks; no subscription logic lives in it.
		* @param options fetch function, polling interval and timer providers
		* @returns stable source, watch(sessionId, offset) disposer and unload disposer
		*/
		function createActionRecords({ fetcher = fetch, pollMs = 2e3, setTimer = setInterval, clearTimer = clearInterval } = {}) {
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
					const response = await fetcher(`/context-care/actions?sessionId=${encodeURIComponent(watch.sessionId)}&limit=20&offset=${watch.offset}`, {
						signal: watch.controller.signal,
						headers: { accept: "application/json" }
					});
					if (!response.ok) throw new Error(`HTTP ${response.status}`);
					const body = await response.json();
					if (!Array.isArray(body.actions)) throw new Error("Invalid action response");
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
				watch(sessionId, offset = 0) {
					if (disposed) return () => {};
					const key = `${sessionId}:${offset}`;
					let watch = watches.get(key);
					if (!watch) {
						watch = {
							key,
							sessionId,
							offset,
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
		//#region src/client.js
		const inject = [
			"slots",
			"locale",
			"uiConversation"
		];
		/** 拉记录的间隔。改写发生在请求发出**之前**,而助手消息在响应**之后** ——
		*  所以只要这个间隔短于一次模型响应,卡片就赶得上。 */
		const POLL_MS = 2e3;
		/** 记录路由。host 侧 src/host.js 注册的同一条路径。 */
		const JOURNAL_ROUTE = "/context-care/rewrite-journal";
		/** Add two context indicators beneath the composer, without replacing its built-in statistics. */
		function apply(ctx) {
			ctx.effect(() => ctx.locale.register("dsh-context-care", dictionaries));
			ctx.slots.inject("conversation.composer.dock", () => ctx.slots.register({
				name: "conversation.composer.dock",
				id: "context-care",
				order: 4,
				locale: "dsh-context-care"
			}, ContextCareStatus));
			const actions = createActionRecords();
			ctx.effect(() => () => actions.dispose());
			ctx.slots.inject("conversation.composer.dock", () => ctx.slots.register({
				name: "conversation.composer.dock",
				id: "context-care-actions",
				order: 5,
				locale: "dsh-context-care",
				inject: () => ({
					hooks: { careActions: actions.source },
					watchActions: actions.watch
				})
			}, ContextCareActions));
			let table = /* @__PURE__ */ new Map();
			let signature = "";
			let disposed = false;
			const listeners = /* @__PURE__ */ new Set();
			const rewriteRecords = {
				getSnapshot: () => table,
				subscribe(listener) {
					listeners.add(listener);
					return () => listeners.delete(listener);
				}
			};
			const load = async () => {
				try {
					const response = await fetch(JOURNAL_ROUTE, { headers: { accept: "application/json" } });
					if (!response.ok) return;
					const body = await response.json();
					const records = Array.isArray(body?.records) ? body.records : [];
					if (disposed) return;
					const nextSignature = JSON.stringify(records);
					if (nextSignature === signature) return;
					const next = /* @__PURE__ */ new Map();
					for (const record of records) {
						if (typeof record?.hash !== "string" || record.hash === "") continue;
						next.set(record.sessionId + ":" + record.hash, record);
					}
					signature = nextSignature;
					table = next;
					for (const listener of listeners) listener();
				} catch {}
			};
			load();
			const timer = setInterval(() => {
				load();
			}, POLL_MS);
			ctx.effect(() => () => {
				disposed = true;
				clearInterval(timer);
				listeners.clear();
			});
			ctx.effect(() => ctx.uiConversation.events.register(createNoticeDefinition()));
			ctx.slots.inject("conversation.chat.node", () => ctx.slots.register({
				name: "conversation.chat.node",
				key: NOTICE_NODE,
				locale: "dsh-context-care"
			}, NoticeNodeView));
			ctx.effect(() => ctx.uiConversation.events.register(createRewriteDefinition()));
			ctx.slots.inject("conversation.chat.node", () => ctx.slots.register({
				name: "conversation.chat.node",
				key: REWRITE_NODE,
				locale: "dsh-context-care",
				inject: () => ({ hooks: { rewriteRecords } })
			}, RewriteNodeView));
		}
		//#endregion
		exports.apply = apply;
		exports.inject = inject;
		return module.exports;
	}
});

//# sourceMappingURL=client.js.map