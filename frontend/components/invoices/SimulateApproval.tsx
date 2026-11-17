'use client';

import React, { useCallback, useEffect, useState } from 'react';
import { api, shortDate, Modal, inputCls, btnPrimary, btnGhost, ErrorLine } from './invoiceUi';

/**
 * Simulate a PO's approval, for the MVP run on POs that cannot be approved in Zoho yet.
 * Zoho is untouched. The approval is recorded here, labelled SIMULATED, and the approved-PO
 * WhatsApp goes to the TEST number only, never to the vendor's own number.
 */

interface Sent { ok: boolean; error?: string; to_last4?: string; params?: string[] }

export default function SimulateApproval({ orgId, po, resend, onClose, onDone, canConfigure = false }: {
    orgId: string; po: { id: string; po_number: string; vendor_name: string | null; po_amount: number | null; po_date: string | null };
    resend?: boolean; onClose: () => void; onDone: () => void; canConfigure?: boolean;
}) {
    const [phone, setPhone] = useState<{ has_phone: boolean; last4: string | null; auto_mode?: string } | null>(null);
    const [newPhone, setNewPhone] = useState('');
    const [busy, setBusy] = useState(false);
    const [error, setError] = useState<string | null>(null);
    const [result, setResult] = useState<{ invoice_due_at: string | null; whatsapp: Sent } | null>(null);

    const loadPhone = useCallback(async () => {
        try { setPhone(await api(`/api/po-approval/settings?org_id=${orgId}`)); } catch (e) { setError((e as Error).message); }
    }, [orgId]);
    useEffect(() => { loadPhone(); }, [loadPhone]);

    const savePhone = async () => {
        setBusy(true); setError(null);
        try { setPhone(await api('/api/po-approval/settings', { method: 'PUT', body: JSON.stringify({ org_id: orgId, test_phone: newPhone }) })); setNewPhone(''); } catch (e) { setError((e as Error).message); } finally { setBusy(false); }
    };

    const go = async () => {
        setBusy(true); setError(null);
        try {
            const r = await api<{ invoice_due_at: string | null; whatsapp: Sent }>('/api/po-approval', { method: 'POST', body: JSON.stringify({ org_id: orgId, po_id: po.id, action: resend ? 'resend' : 'simulate' }) });
            setResult(r); onDone();
        } catch (e) { setError((e as Error).message); } finally { setBusy(false); }
    };

    // A resend follows the switch: Live sends to the vendor's own number, anything else to the test number.
    const toVendor = !!resend && phone?.auto_mode === 'live';
    const value = po.po_amount == null ? '—' : Math.round(po.po_amount).toLocaleString('en-IN');
    const date = po.po_date ? po.po_date.split('-').reverse().join('-') : '—';

    return (
        <Modal title={`${resend ? 'Resend WhatsApp' : 'Simulate approval'} · ${po.po_number}`} onClose={onClose}>
            <div className="space-y-4">
                {!result && (
                    <>
                        <div className="rounded-xl border border-border bg-surface-elevated px-3 py-3 text-sm text-text-primary whitespace-pre-line leading-relaxed">
                            {`Hello ${po.vendor_name ?? 'Vendor'},\n\nYour Purchase Order has been approved and the approved copy is attached above.\n\nPO Details:\nPO Number: ${po.po_number}\nPO Date: ${date}\nPO Value: ₹${value}\n\nPlease keep your invoice ready within 48 hours of PO approval to ensure timely submission and processing.`}
                            <div className="text-[11px] text-text-tertiary mt-2">With the PO PDF attached. Template: po_approved_vendor_notification</div>
                        </div>
                        {!resend && (
                            <ul className="text-xs text-text-secondary space-y-1 list-disc pl-4">
                                <li>This records the approval <b>in this app only</b>, labelled SIMULATED. Zoho is not changed.</li>
                                <li>Invoice Control and the payment plan will treat the PO as approved, and the 48-hour invoice clock starts.</li>
                            </ul>
                        )}

                        {toVendor ? (
                            <div className="rounded-xl border border-red-500/30 bg-red-500/5 px-3 py-3 text-sm text-text-primary">
                                <b>This goes to {po.vendor_name ?? 'the vendor'}&apos;s own WhatsApp number</b> (the switch is Live). If the vendor has no number on file, nothing is sent and the row says so.
                            </div>
                        ) : (
                        <div className="rounded-xl border border-amber-500/30 bg-amber-500/5 px-3 py-3 space-y-2">
                            <div className="text-xs font-bold text-amber-700 dark:text-amber-400">Goes to your test number only, never to {po.vendor_name ?? 'the vendor'}</div>
                            {phone?.has_phone ? <div className="text-sm text-text-primary">Test number ending <b>{phone.last4}</b></div> : <div className="text-sm text-text-secondary">No test number is set yet.</div>}
                            {canConfigure ? <div className="flex gap-2">
                                <input className={inputCls} inputMode="tel" placeholder={phone?.has_phone ? 'Change the number (with country code)' : '91 98123 45678'} value={newPhone} onChange={(e) => setNewPhone(e.target.value)} />
                                <button className={btnGhost} disabled={busy || newPhone.trim().length < 10} onClick={savePhone}>Save</button>
                            </div> : !phone?.has_phone && <div className="text-xs text-text-secondary">Ask a super admin to set the test number.</div>}
                        </div>
                        )}

                        <ErrorLine message={error} />
                        <div className="flex gap-2">
                            <button className={btnPrimary} disabled={busy || (!toVendor && !phone?.has_phone)} onClick={go}>{busy ? 'Sending…' : resend ? (toVendor ? 'Send to the vendor' : 'Resend to my test number') : 'Simulate approval and send WhatsApp'}</button>
                            <button className={btnGhost} onClick={onClose}>Cancel</button>
                        </div>
                    </>
                )}

                {result && (
                    <div className="space-y-3">
                        {result.invoice_due_at && <p className="text-sm text-text-primary">Approval simulated. Invoice due by <b>{shortDate(result.invoice_due_at)}</b>.</p>}
                        {result.whatsapp.ok
                            ? <p className="text-sm text-emerald-700 dark:text-emerald-400 bg-emerald-500/10 border border-emerald-500/20 rounded-xl px-3 py-2">WhatsApp sent to the number ending {result.whatsapp.to_last4}, with the PO PDF.</p>
                            : <ErrorLine message={`The approval is recorded, but the WhatsApp did not send: ${result.whatsapp.error}`} />}
                        {result.whatsapp.params && <p className="text-[11px] text-text-tertiary">Values sent: {result.whatsapp.params.join(' · ')}</p>}
                        <button className={btnPrimary} onClick={onClose}>Done</button>
                    </div>
                )}
            </div>
        </Modal>
    );
}

