import React from 'react'

// Private selectors consume the Host's theme and typography. The rendered
// stylesheet leaves with the display; published clients need no CSS loader.
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
[data-care-panel] .care-empty { margin: 0; padding: 24px 8px; color: var(--dsw-alias-label-tertiary); }
[data-care-panel] [role='alert'] { padding: 12px; border-radius: var(--dsw-radius-sm); background: var(--dsw-alias-interactive-bg-hover-danger); color: var(--dsw-alias-state-error-primary); overflow-wrap: anywhere; }
[data-care-entry] [role='alert'] { position: absolute; bottom: calc(100% + 8px); right: 0; width: 240px; padding: 12px; border-radius: var(--dsw-radius-sm); background: var(--dsw-alias-bg-layer-2); color: var(--dsw-alias-state-error-primary); box-shadow: var(--dsw-elevation-panel); overflow-wrap: anywhere; z-index: 1; }
[data-context-care] { display: flex; flex-wrap: wrap; align-items: center; gap: 12px; padding: 1px 4px; font-size: calc(var(--dsh-content-font-size-secondary, 13px) - 1px); }
[data-context-care] > span { font-weight: 500; }
`.trim()

export function CareStyles() { return React.createElement('style', null, css) }
