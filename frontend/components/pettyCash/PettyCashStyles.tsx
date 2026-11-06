export default function PettyCashStyles() {
    return <style>{`
.petty-cash-workflow {
  min-width: 0;
  font-size: 14px;
  color: var(--text-primary, #0f172a);
}
.petty-cash-workflow h1 {
  font-size: 1.5rem !important;
  font-weight: 900 !important;
  letter-spacing: -0.025em;
  line-height: 1.25;
}
.petty-cash-workflow h2 {
  font-size: 1.25rem !important;
  font-weight: 900 !important;
  letter-spacing: -0.02em;
  line-height: 1.3;
}
.petty-cash-workflow h3 {
  font-size: 0.875rem !important;
  font-weight: 800 !important;
  letter-spacing: -0.01em;
  line-height: 1.4;
}
.pc-header, .pc-summary {
  padding: 20px;
}
.pc-routing-body, .pc-modal-body {
  padding: 24px;
}
.pc-detail-summary {
  padding: 18px;
}
.petty-cash-workflow label, .pc-field-label {
  font-size: 11px;
  font-weight: 800;
  text-transform: uppercase;
  letter-spacing: 0.05em;
  color: var(--text-secondary, #64748b);
  line-height: 1.5;
}
.petty-cash-workflow .pc-input {
  display: block;
  width: 100%;
  min-width: 0;
  min-height: 42px;
  border: 1px solid var(--border, #cbd5e1);
  border-radius: 12px;
  padding: 10px 14px;
  background: var(--surface, #ffffff);
  color: var(--text-primary, #0f172a);
  margin-top: 6px;
  font-size: 13px;
  font-weight: 500;
  transition: border-color 0.15s ease, box-shadow 0.15s ease;
}
.dark .petty-cash-workflow .pc-input {
  border-color: #30363d;
  background: #0d1117;
  color: #f0f6fc;
}
.petty-cash-workflow textarea.pc-input {
  min-height: 92px;
  resize: vertical;
}
.petty-cash-workflow .pc-input:focus, .pc-select-trigger:focus-visible, .pc-select-open {
  outline: none;
  border-color: var(--primary, #0ea5e9);
  box-shadow: 0 0 0 3px rgba(var(--primary-rgb, 14, 165, 233), 0.15);
}
.petty-cash-workflow .pc-input:disabled {
  background: var(--surface-elevated, #f1f5f9);
  opacity: 0.6;
}
.dark .petty-cash-workflow .pc-input:disabled {
  background: #161b22;
  opacity: 0.5;
}
.petty-cash-workflow .pc-button {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  gap: 8px;
  min-height: 40px;
  border: 1px solid transparent;
  border-radius: 12px;
  padding: 10px 18px;
  background: var(--primary, #0ea5e9);
  color: #ffffff;
  font-size: 12px;
  line-height: 1.4;
  font-weight: 900;
  letter-spacing: 0.02em;
  box-shadow: 0 4px 12px rgba(var(--primary-rgb, 14, 165, 233), 0.2);
  transition: all 0.2s cubic-bezier(0.4, 0, 0.2, 1);
  cursor: pointer;
}
.petty-cash-workflow .pc-button:hover:not(:disabled) {
  filter: brightness(1.08);
  transform: translateY(-1px);
  box-shadow: 0 6px 16px rgba(var(--primary-rgb, 14, 165, 233), 0.28);
}
.petty-cash-workflow .pc-button:active:not(:disabled) {
  transform: scale(0.97);
}
.petty-cash-workflow .pc-button-secondary {
  background: var(--surface-elevated, #f8fafc);
  border: 1px solid var(--border, #e2e8f0);
  color: var(--text-primary, #0f172a);
  box-shadow: none;
  font-weight: 700;
}
.petty-cash-workflow .pc-button-secondary:hover:not(:disabled) {
  background: var(--surface, #ffffff);
  border-color: var(--primary, #0ea5e9);
  color: var(--primary-dark, var(--primary, #0ea5e9));
}
.dark .petty-cash-workflow .pc-button-secondary {
  background: #21262d;
  border-color: #30363d;
  color: #f0f6fc;
}
.dark .petty-cash-workflow .pc-button-secondary:hover:not(:disabled) {
  background: #30363d;
  border-color: #58a6ff;
  color: #ffffff;
}
.petty-cash-workflow .pc-button-danger {
  background: rgba(239, 68, 68, 0.08);
  border: 1px solid rgba(239, 68, 68, 0.2);
  color: #ef4444;
  box-shadow: none;
}
.petty-cash-workflow .pc-button-danger:hover:not(:disabled) {
  background: rgba(239, 68, 68, 0.15);
  border-color: #ef4444;
  color: #dc2626;
}
.dark .petty-cash-workflow .pc-button-danger {
  background: rgba(239, 68, 68, 0.12);
  border-color: rgba(239, 68, 68, 0.3);
  color: #f87171;
}
.petty-cash-workflow button:disabled {
  opacity: 0.45;
  cursor: not-allowed;
  transform: none !important;
  box-shadow: none !important;
}
.petty-cash-workflow button:focus-visible, .pc-select-option:focus-visible {
  outline: 2px solid var(--primary, #0ea5e9);
  outline-offset: 3px;
}
.petty-cash-workflow input[type=checkbox] {
  accent-color: var(--primary, #0ea5e9);
  width: 16px;
  height: 16px;
  vertical-align: middle;
}
.pc-panel {
  min-width: 0;
  border: 1px solid var(--border, #e2e8f0);
  border-radius: 20px;
  background: var(--surface, #ffffff);
  box-shadow: 0 1px 3px 0 rgba(0, 0, 0, 0.04);
  transition: border-color 0.2s ease, box-shadow 0.2s ease;
}
.dark .pc-panel {
  border-color: #30363d;
  background: #161b22;
  box-shadow: 0 1px 3px 0 rgba(0, 0, 0, 0.25);
}
.pc-panel-heading {
  display: flex;
  align-items: center;
  gap: 14px;
  padding: 20px 24px;
  border-bottom: 1px solid var(--border, #e2e8f0);
}
.dark .pc-panel-heading {
  border-color: #30363d;
}
.pc-panel-footer {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  justify-content: space-between;
  gap: 16px;
  padding: 18px 24px;
  border-top: 1px solid var(--border, #e2e8f0);
  background: var(--surface-elevated, #f8fafc);
  border-radius: 0 0 20px 20px;
}
.dark .pc-panel-footer {
  border-color: #30363d;
  background: #1c2128;
}
.pc-icon-tile {
  display: flex;
  align-items: center;
  justify-content: center;
  flex-shrink: 0;
  width: 44px;
  height: 44px;
  border-radius: 14px;
  background: rgba(var(--primary-rgb, 14, 165, 233), 0.1);
  color: var(--primary-dark, var(--primary, #0ea5e9));
  border: 1px solid rgba(var(--primary-rgb, 14, 165, 233), 0.15);
}
.pc-routing-stage {
  min-width: 0;
  border: 1px solid var(--border, #e2e8f0);
  border-radius: 16px;
  padding: 20px;
  background: var(--surface-elevated, #f8fafc);
}
.dark .pc-routing-stage {
  border-color: #30363d;
  background: #1c2128;
}
.pc-help {
  font-size: 12px;
  color: var(--text-secondary, #64748b);
  line-height: 1.6;
  margin-top: 10px;
}
.dark .pc-help {
  color: #8b949e;
}
.pc-field-label {
  display: block;
  margin-bottom: 6px;
  color: var(--text-primary, #0f172a);
}
.dark .pc-field-label {
  color: #f0f6fc;
}
.pc-select-trigger {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  width: 100%;
  min-height: 44px;
  padding: 10px 14px;
  border: 1px solid var(--border, #cbd5e1);
  border-radius: 12px;
  background: var(--surface, #ffffff);
  color: var(--text-primary, #0f172a);
  font-size: 13px;
  font-weight: 500;
  transition: border-color 0.15s ease, box-shadow 0.15s ease;
}
.dark .pc-select-trigger {
  border-color: #30363d;
  background: #0d1117;
  color: #f0f6fc;
}
.pc-select-menu {
  position: absolute;
  top: 100%;
  left: 0;
  right: 0;
  z-index: 50;
  margin-top: 6px;
  background: var(--surface, #ffffff);
  border: 1px solid var(--border, #cbd5e1);
  border-radius: 16px;
  box-shadow: 0 10px 25px -5px rgba(0, 0, 0, 0.1), 0 8px 10px -6px rgba(0, 0, 0, 0.1);
  overflow: hidden;
}
.dark .pc-select-menu {
  background: #161b22;
  border-color: #30363d;
  box-shadow: 0 10px 25px -5px rgba(0, 0, 0, 0.4);
}
.pc-select-option {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  padding: 10px 14px;
  border-radius: 10px;
  cursor: pointer;
  font-size: 13px;
  transition: background 0.12s ease;
}
.pc-select-option:hover {
  background: rgba(var(--primary-rgb, 14, 165, 233), 0.1);
}
.dark .pc-select-option:hover {
  background: rgba(255, 255, 255, 0.06);
}
.pc-table-wrap {
  min-width: 0;
  overflow-x: auto;
  border: 1px solid var(--border, #e2e8f0);
  border-radius: 18px;
  background: var(--surface, #ffffff);
  box-shadow: 0 1px 3px 0 rgba(0, 0, 0, 0.04);
}
.dark .pc-table-wrap {
  border-color: #30363d;
  background: #161b22;
}
.pc-table-wrap table {
  width: 100%;
  font-size: 13px;
  text-align: left;
  border-collapse: collapse;
}
.pc-table-wrap th {
  padding: 14px 18px;
  background: var(--surface-elevated, #f8fafc);
  color: var(--text-secondary, #64748b);
  font-size: 10px;
  letter-spacing: 0.08em;
  font-weight: 900;
  text-transform: uppercase;
  white-space: nowrap;
  border-bottom: 1px solid var(--border, #e2e8f0);
}
.dark .pc-table-wrap th {
  background: #1c2128;
  color: #8b949e;
  border-color: #30363d;
}
.pc-table-wrap td {
  padding: 14px 18px;
  border-bottom: 1px solid var(--border, #e2e8f0);
  vertical-align: middle;
}
.dark .pc-table-wrap td {
  border-color: #21262d;
}
.pc-table-wrap tbody tr:last-child td {
  border-bottom: 0;
}
.pc-table-wrap tbody tr:hover {
  background: var(--surface-elevated, #f8fafc);
}
.dark .pc-table-wrap tbody tr:hover {
  background: rgba(255, 255, 255, 0.03);
}
.pc-table-wrap td .pc-input {
  margin-top: 0;
}
.pc-empty {
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 10px;
  padding: 56px 20px;
  text-align: center;
  color: var(--text-secondary, #64748b);
}
.dark .pc-empty {
  color: #8b949e;
}
.pc-empty > svg {
  color: var(--primary, #0ea5e9);
  margin-bottom: 4px;
}
.pc-empty h3 {
  font-size: 15px;
  font-weight: 800;
  color: var(--text-primary, #0f172a);
}
.dark .pc-empty h3 {
  color: #f0f6fc;
}
.pc-empty p {
  font-size: 13px;
  max-width: 400px;
  line-height: 1.6;
}
.pc-alert, .pc-notice, .pc-success {
  display: flex;
  align-items: flex-start;
  gap: 12px;
  padding: 14px 18px;
  border-radius: 14px;
  font-size: 13px;
  line-height: 1.6;
  overflow-wrap: anywhere;
}
.pc-alert {
  background: rgba(239, 68, 68, 0.08);
  border: 1px solid rgba(239, 68, 68, 0.25);
  color: #ef4444;
}
.dark .pc-alert {
  background: rgba(239, 68, 68, 0.12);
  border-color: rgba(239, 68, 68, 0.3);
  color: #f87171;
}
.pc-notice {
  background: rgba(245, 158, 11, 0.08);
  border: 1px solid rgba(245, 158, 11, 0.25);
  color: var(--text-primary, #0f172a);
}
.dark .pc-notice {
  background: rgba(245, 158, 11, 0.12);
  border-color: rgba(245, 158, 11, 0.3);
  color: #f0f6fc;
}
.pc-success {
  background: rgba(16, 185, 129, 0.08);
  border: 1px solid rgba(16, 185, 129, 0.25);
  color: var(--text-primary, #0f172a);
}
.dark .pc-success {
  background: rgba(16, 185, 129, 0.12);
  border-color: rgba(16, 185, 129, 0.3);
  color: #f0f6fc;
}
.pc-status {
  display: inline-flex;
  align-items: center;
  border-radius: 8px;
  padding: 3px 8px;
  background: rgba(var(--primary-rgb, 14, 165, 233), 0.1);
  border: 1px solid rgba(var(--primary-rgb, 14, 165, 233), 0.2);
  color: var(--primary-dark, var(--primary, #0ea5e9));
  font-size: 9px;
  font-weight: 900;
  text-transform: uppercase;
  letter-spacing: 0.08em;
  white-space: nowrap;
}
.pc-status[data-status=closed], .pc-status[data-status=paid], .pc-status[data-status=approved] {
  background: rgba(16, 185, 129, 0.1);
  border-color: rgba(16, 185, 129, 0.25);
  color: #10b981;
}
.dark .pc-status[data-status=closed], .dark .pc-status[data-status=paid], .dark .pc-status[data-status=approved] {
  color: #34d399;
}
.pc-status[data-status=rejected], .pc-status[data-status=cancelled] {
  background: rgba(244, 63, 94, 0.1);
  border-color: rgba(244, 63, 94, 0.25);
  color: #f43f5e;
}
.dark .pc-status[data-status=rejected], .dark .pc-status[data-status=cancelled] {
  color: #fb7185;
}
.pc-status[data-status=submitted], .pc-status[data-status=pending_approval], .pc-status[data-status=sent_back] {
  background: rgba(245, 158, 11, 0.1);
  border-color: rgba(245, 158, 11, 0.25);
  color: #d97706;
}
.dark .pc-status[data-status=submitted], .dark .pc-status[data-status=pending_approval], .dark .pc-status[data-status=sent_back] {
  color: #fbbf24;
}
.pc-status[data-status=draft] {
  background: rgba(148, 163, 184, 0.1);
  border-color: rgba(148, 163, 184, 0.2);
  color: #64748b;
}
.dark .pc-status[data-status=draft] {
  color: #94a3b8;
}
.pc-upload {
  overflow-wrap: anywhere;
  padding: 18px;
  border: 1px dashed var(--border, #cbd5e1);
  border-radius: 14px;
  background: var(--surface-elevated, #f8fafc);
}
.dark .pc-upload {
  border-color: #30363d;
  background: #1c2128;
}
.pc-upload input[type=file] {
  font-size: 12px;
  font-weight: 500;
  color: var(--text-secondary, #64748b);
}
.dark .pc-upload input[type=file] {
  color: #8b949e;
}
.pc-upload input[type=file]::file-selector-button {
  padding: 8px 14px;
  margin-right: 14px;
  background: var(--surface, #ffffff);
  color: var(--text-primary, #0f172a);
  border: 1px solid var(--border, #cbd5e1);
  border-radius: 10px;
  cursor: pointer;
  font-weight: 800;
  font-size: 12px;
  transition: all 0.15s ease;
}
.dark .pc-upload input[type=file]::file-selector-button {
  background: #21262d;
  border-color: #30363d;
  color: #f0f6fc;
}
.pc-activity {
  border-left: 2px solid var(--border, #e2e8f0);
  margin-left: 8px;
  padding-left: 18px;
}
.dark .pc-activity {
  border-color: #30363d;
}
.pc-activity li {
  position: relative;
  padding: 6px 0;
  line-height: 1.7;
  color: var(--text-secondary, #64748b);
  overflow-wrap: anywhere;
}
.dark .pc-activity li {
  color: #8b949e;
}
.pc-activity li::before {
  content: '';
  position: absolute;
  left: -23px;
  top: 14px;
  width: 8px;
  height: 8px;
  border-radius: 50%;
  background: var(--primary, #0ea5e9);
  border: 2px solid var(--surface, #ffffff);
}
.dark .pc-activity li::before {
  border-color: #161b22;
}
@media (max-width: 640px) {
  .pc-header, .pc-summary, .pc-routing-body, .pc-modal-body {
    padding: 16px;
  }
  .pc-panel-heading {
    padding: 16px;
  }
  .pc-panel-footer {
    padding: 16px;
  }
  .pc-routing-stage {
    padding: 16px;
  }
  .pc-panel-footer > button {
    width: 100%;
  }
  .pc-empty {
    padding: 36px 16px;
  }
}
`}</style>;
}
