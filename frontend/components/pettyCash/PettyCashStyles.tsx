export default function PettyCashStyles() {
    return <style>{`
.petty-cash-workflow{min-width:0;font-size:14px;color:var(--text-primary)}
.petty-cash-workflow h1{font-size:18px!important}
.petty-cash-workflow h2{font-size:16px!important}
.petty-cash-workflow h3{font-size:14px!important;line-height:1.5}
.pc-header,.pc-summary{padding:20px}
.pc-routing-body,.pc-modal-body{padding:24px}
.pc-detail-summary{padding:16px}
.petty-cash-workflow label,.pc-field-label{font-size:13px;font-weight:600;line-height:1.5}
.petty-cash-workflow .pc-input{display:block;width:100%;min-width:0;min-height:40px;border:1px solid var(--border);border-radius:10px;padding:9px 12px;background:var(--surface);color:var(--text-primary);margin-top:6px;font-size:14px;font-weight:400;transition:border-color .15s,box-shadow .15s}
.petty-cash-workflow textarea.pc-input{min-height:88px;resize:vertical}
.petty-cash-workflow .pc-input:focus,.pc-select-trigger:focus-visible,.pc-select-open{outline:none;border-color:var(--primary);box-shadow:0 0 0 3px rgba(var(--primary-rgb),.12)}
.petty-cash-workflow .pc-input:disabled{background:var(--surface-elevated);opacity:.6}
.petty-cash-workflow .pc-button{display:inline-flex;align-items:center;justify-content:center;gap:8px;min-height:40px;border:1px solid var(--primary-dark);border-radius:10px;padding:9px 16px;background:var(--primary-dark);color:#fff;font-size:13px;line-height:20px;font-weight:600;transition:background .15s,box-shadow .15s}
.petty-cash-workflow .pc-button:hover:not(:disabled){background:var(--primary);box-shadow:var(--shadow-sm)}
.petty-cash-workflow .pc-button-secondary{background:var(--surface);border-color:var(--border);color:var(--text-primary)}
.petty-cash-workflow .pc-button-secondary:hover:not(:disabled){background:var(--surface-elevated)}
.petty-cash-workflow .pc-button-danger{background:transparent;border-color:var(--border);color:var(--error)}
.petty-cash-workflow .pc-button-danger:hover:not(:disabled){background:rgba(239,68,68,.08)}
.petty-cash-workflow button:disabled{opacity:.45;cursor:not-allowed}
.petty-cash-workflow button:focus-visible,.pc-select-option:focus-visible{outline:2px solid var(--primary);outline-offset:3px}
.petty-cash-workflow input[type=checkbox]{accent-color:var(--primary);width:16px;height:16px;vertical-align:middle}
.pc-panel{min-width:0;border:1px solid var(--border);border-radius:16px;background:var(--surface);box-shadow:var(--shadow-sm)}
.pc-panel-heading{display:flex;align-items:center;gap:12px;padding:20px 24px;border-bottom:1px solid var(--border)}
.pc-panel-footer{display:flex;flex-wrap:wrap;align-items:center;justify-content:space-between;gap:16px;padding:16px 24px;border-top:1px solid var(--border);background:var(--surface-elevated);border-radius:0 0 16px 16px}
.pc-icon-tile{display:flex;align-items:center;justify-content:center;flex-shrink:0;width:40px;height:40px;border-radius:12px;background:rgba(var(--primary-rgb),.1);color:var(--primary-dark)}
.pc-routing-stage{min-width:0;border:1px solid var(--border);border-radius:12px;padding:20px;background:var(--surface-elevated)}
.pc-help{font-size:12px;color:var(--text-secondary);line-height:1.6;margin-top:10px}
.pc-field-label{display:block;margin-bottom:6px;color:var(--text-primary)}
.pc-select-trigger{display:flex;align-items:center;justify-content:space-between;gap:12px;width:100%;min-height:44px;padding:10px 12px;border:1px solid var(--border);border-radius:10px;background:var(--surface);color:var(--text-primary);font-size:14px;transition:border-color .15s,box-shadow .15s}
.pc-select-menu{position:absolute;top:100%;left:0;right:0;z-index:50;margin-top:6px;background:var(--surface);border:1px solid var(--border);border-radius:12px;box-shadow:var(--shadow-lg);overflow:hidden}
.pc-select-option{display:flex;align-items:center;justify-content:space-between;gap:12px;padding:10px;border-radius:8px;cursor:pointer;font-size:14px}
.pc-select-option:hover{background:rgba(var(--primary-rgb),.1)}
.pc-table-wrap{min-width:0;overflow-x:auto;border:1px solid var(--border);border-radius:16px;background:var(--surface);box-shadow:var(--shadow-sm)}
.pc-table-wrap table{width:100%;font-size:13px;text-align:left;border-collapse:collapse}
.pc-table-wrap th{padding:14px 16px;background:var(--surface-elevated);color:var(--text-secondary);font-size:11px;letter-spacing:.04em;font-weight:600;text-transform:uppercase;white-space:nowrap;border-bottom:1px solid var(--border)}
.pc-table-wrap td{padding:14px 16px;border-bottom:1px solid var(--border);vertical-align:middle}
.pc-table-wrap tbody tr:last-child td{border-bottom:0}
.pc-table-wrap tbody tr:hover{background:var(--surface-elevated)}
.pc-table-wrap td .pc-input{margin-top:0}
.pc-empty{display:flex;flex-direction:column;align-items:center;justify-content:center;gap:8px;padding:48px 20px;text-align:center;color:var(--text-secondary)}
.pc-empty>svg{color:var(--primary);margin-bottom:6px}
.pc-empty h3{font-size:14px;font-weight:600;color:var(--text-primary)}
.pc-empty p{font-size:13px;max-width:380px;line-height:1.6}
.pc-alert,.pc-notice,.pc-success{display:flex;align-items:flex-start;gap:10px;padding:12px 16px;border-radius:12px;font-size:13px;line-height:1.6;overflow-wrap:anywhere}
.pc-alert{background:rgba(239,68,68,.06);border:1px solid rgba(239,68,68,.2);color:var(--error)}
.pc-notice{background:rgba(245,158,11,.06);border:1px solid rgba(245,158,11,.25);color:var(--text-primary)}
.pc-success{background:rgba(16,185,129,.06);border:1px solid rgba(16,185,129,.2);color:var(--text-primary)}
.pc-status{display:inline-flex;align-items:center;border-radius:6px;padding:4px 8px;background:rgba(var(--primary-rgb),.1);color:var(--primary-dark);font-size:11px;font-weight:600;white-space:nowrap}
.pc-status[data-status=closed],.pc-status[data-status=paid]{background:rgba(16,185,129,.1);color:var(--success)}
.pc-status[data-status=rejected],.pc-status[data-status=cancelled]{background:rgba(239,68,68,.08);color:var(--error)}
.pc-status[data-status=submitted],.pc-status[data-status=pending_approval],.pc-status[data-status=sent_back]{background:rgba(245,158,11,.1);color:var(--text-primary)}
.pc-upload{overflow-wrap:anywhere;padding:16px;border:1px dashed var(--border);border-radius:12px;background:var(--surface-elevated)}
.pc-upload input[type=file]{font-size:12px;font-weight:400;color:var(--text-secondary)}
.pc-upload input[type=file]::file-selector-button{padding:8px 12px;margin-right:12px;background:var(--surface);color:var(--text-primary);border:1px solid var(--border);border-radius:8px;cursor:pointer;font-weight:600}
.pc-activity{border-left:2px solid var(--border);margin-left:6px;padding-left:16px}
.pc-activity li{position:relative;padding:6px 0;line-height:1.7;color:var(--text-secondary);overflow-wrap:anywhere}
.pc-activity li::before{content:'';position:absolute;left:-21px;top:13px;width:8px;height:8px;border-radius:50%;background:var(--primary);border:2px solid var(--surface)}
@media(max-width:640px){.pc-header,.pc-summary,.pc-routing-body,.pc-modal-body{padding:16px}.pc-panel-heading{padding:16px}.pc-panel-footer{padding:16px}.pc-routing-stage{padding:16px}.pc-panel-footer>button{width:100%}.pc-empty{padding:36px 16px}}
`}</style>;
}
