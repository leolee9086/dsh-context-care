import React from 'react'

// Private selectors borrow Host theme and typography; the sheet leaves with its view.
export const css = `
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
`.trim()
export function CareStyles() { return React.createElement('style', null, css) }
