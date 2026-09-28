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
				noticeSubRules: "规则"
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
				noticeSubRules: "rule"
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