'use client';

import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { motion } from 'framer-motion';
import {
    AlertCircle,
    Check,
    GripVertical,
    Loader2,
    Plus,
    RotateCcw,
    Save,
    Smartphone,
    Trash2,
    X,
} from 'lucide-react';
import { Button } from '@/frontend/components/ui/button';
import {
    BUILTIN_FIELDS,
    DEFAULT_GUEST_FORM_FIELDS,
    GuestFormField,
    MAX_CUSTOM_FIELDS,
    editorFieldList,
    isBuiltinFieldKey,
    isCustomFieldKey,
    normalizeGuestFormFields,
    visibleGuestFormFields,
} from '@/frontend/lib/guestTicketForm';

/**
 * Edit which fields this property's QR client-support form asks for.
 *
 * One property may want only "Your Name" and "Process Name"; another only "Process Name" and "ID".
 * Each row switches a field on or off, marks it required, and renames its label. Properties that
 * are never touched here keep the form exactly as it shipped.
 *
 * Laid out as a bottom sheet on phones and a centred dialog from `sm` up, since supervisors open
 * this on site.
 */
export default function TicketFormConfigModal({
    propertyId,
    onClose,
}: {
    propertyId: string;
    onClose: () => void;
}) {
    const [fields, setFields] = useState<GuestFormField[]>([]);
    const [loading, setLoading] = useState(true);
    const [saving, setSaving] = useState(false);
    const [error, setError] = useState<string | null>(null);
    const [saved, setSaved] = useState(false);

    const load = useCallback(async () => {
        setLoading(true);
        setError(null);
        try {
            const res = await fetch(`/api/properties/${propertyId}/ticket-form-config`);
            const data = await res.json();
            if (!res.ok) throw new Error(data.error || 'Could not load the form setup.');
            setFields(editorFieldList(normalizeGuestFormFields(data.fields)));
        } catch (err: any) {
            setError(err.message || 'Could not load the form setup.');
        } finally {
            setLoading(false);
        }
    }, [propertyId]);

    useEffect(() => { load(); }, [load]);

    // Esc closes the sheet.
    useEffect(() => {
        const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
        window.addEventListener('keydown', onKey);
        return () => window.removeEventListener('keydown', onKey);
    }, [onClose]);

    const update = (key: string, patch: Partial<GuestFormField>) => {
        setSaved(false);
        setFields(prev => prev.map(f => (f.key === key ? { ...f, ...patch } : f)));
    };

    const move = (index: number, direction: -1 | 1) => {
        const target = index + direction;
        if (target < 0 || target >= fields.length) return;
        setSaved(false);
        setFields(prev => {
            const next = [...prev];
            [next[index], next[target]] = [next[target], next[index]];
            return next;
        });
    };

    const customCount = useMemo(() => fields.filter(f => isCustomFieldKey(f.key)).length, [fields]);

    const addCustomField = () => {
        if (customCount >= MAX_CUSTOM_FIELDS) return;
        setSaved(false);
        const used = new Set(fields.map(f => f.key));
        let n = customCount + 1;
        while (used.has(`custom_field_${n}`)) n += 1;
        setFields(prev => [...prev, {
            key: `custom_field_${n}`,
            label: `Extra field ${n}`,
            type: 'text',
            enabled: true,
            required: false,
        }]);
    };

    const removeCustomField = (key: string) => {
        setSaved(false);
        setFields(prev => prev.filter(f => f.key !== key));
    };

    const resetToDefault = () => {
        setSaved(false);
        setFields(editorFieldList([...DEFAULT_GUEST_FORM_FIELDS]));
    };

    const enabledFields = useMemo(() => visibleGuestFormFields(fields), [fields]);

    const save = async () => {
        if (enabledFields.length === 0) {
            setError('Keep at least one field switched on.');
            return;
        }
        setSaving(true);
        setError(null);
        try {
            const res = await fetch(`/api/properties/${propertyId}/ticket-form-config`, {
                method: 'PUT',
                headers: { 'Content-Type': 'application/json' },
                // Only the fields in use are stored; the rest keep their defaults.
                body: JSON.stringify({ fields: fields.filter(f => f.enabled) }),
            });
            const data = await res.json();
            if (!res.ok) throw new Error(data.error || 'Could not save the form setup.');
            setFields(editorFieldList(normalizeGuestFormFields(data.fields)));
            setSaved(true);
            setTimeout(() => setSaved(false), 2500);
        } catch (err: any) {
            setError(err.message || 'Could not save the form setup.');
        } finally {
            setSaving(false);
        }
    };

    return (
        <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="fixed inset-0 bg-slate-900/50 backdrop-blur-sm z-[200] flex items-end sm:items-center sm:justify-center sm:p-4"
            onClick={onClose}
        >
            <motion.div
                initial={{ y: '100%', opacity: 0.6 }}
                animate={{ y: 0, opacity: 1 }}
                exit={{ y: '100%', opacity: 0.6 }}
                transition={{ type: 'spring', damping: 30, stiffness: 280 }}
                onClick={(e) => e.stopPropagation()}
                className="bg-white w-full sm:max-w-2xl rounded-t-3xl sm:rounded-2xl shadow-2xl flex flex-col max-h-[92dvh] sm:max-h-[86vh] overflow-hidden"
            >
                {/* Header */}
                <div className="px-5 sm:px-6 pt-4 pb-4 border-b border-slate-100 shrink-0">
                    <div className="mx-auto mb-3 h-1.5 w-10 rounded-full bg-slate-200 sm:hidden" />
                    <div className="flex items-start justify-between gap-3">
                        <div className="min-w-0">
                            <h3 className="text-lg sm:text-xl font-black text-slate-900 tracking-tight">Ticket Form Setup</h3>
                            <p className="text-xs sm:text-sm font-semibold text-slate-500 mt-1 leading-relaxed">
                                Choose what clients at this property are asked for after scanning the QR code.
                            </p>
                        </div>
                        <button
                            onClick={onClose}
                            className="p-2 -mr-1 rounded-full text-slate-400 hover:text-slate-700 hover:bg-slate-100 transition-colors shrink-0"
                            aria-label="Close"
                        >
                            <X className="w-5 h-5" />
                        </button>
                    </div>
                </div>

                {/* Body */}
                <div className="flex-1 overflow-y-auto px-4 sm:px-6 py-4 bg-slate-50/70 overscroll-contain">
                    {loading ? (
                        <div className="py-16 flex justify-center">
                            <Loader2 className="w-7 h-7 animate-spin text-slate-400" />
                        </div>
                    ) : (
                        <div className="space-y-3">
                            {error && (
                                <div className="bg-red-50 border border-red-200 text-red-800 p-3 rounded-xl flex gap-2.5 items-start text-xs font-bold">
                                    <AlertCircle className="w-4 h-4 shrink-0 text-red-600 mt-0.5" />
                                    <span>{error}</span>
                                </div>
                            )}

                            {/* Live summary of what the client will see */}
                            <div className="bg-white border border-slate-200 rounded-xl p-3.5 shadow-xs">
                                <div className="flex items-center gap-2 mb-2">
                                    <Smartphone className="w-3.5 h-3.5 text-primary shrink-0" />
                                    <h4 className="text-[10px] font-black uppercase tracking-widest text-slate-500">
                                        Client sees {enabledFields.length} field{enabledFields.length === 1 ? '' : 's'}
                                    </h4>
                                </div>
                                {enabledFields.length === 0 ? (
                                    <p className="text-xs font-bold text-amber-600">
                                        Nothing is switched on — the QR form would have nothing to fill in.
                                    </p>
                                ) : (
                                    <div className="flex flex-wrap gap-1.5">
                                        {enabledFields.map(f => (
                                            <span
                                                key={f.key}
                                                className="px-2 py-1 rounded-lg bg-slate-100 border border-slate-200 text-[11px] font-bold text-slate-700"
                                            >
                                                {f.label}
                                                {f.required && <span className="text-red-500 ml-0.5">*</span>}
                                            </span>
                                        ))}
                                    </div>
                                )}
                            </div>

                            {/* Field rows */}
                            {fields.map((field, index) => {
                                const builtin = isBuiltinFieldKey(field.key);
                                const hint = isBuiltinFieldKey(field.key)
                                    ? BUILTIN_FIELDS[field.key].hint
                                    : 'Stored with the ticket as an extra answer.';
                                return (
                                    <div
                                        key={field.key}
                                        className={`bg-white border rounded-xl p-3.5 shadow-xs transition-colors ${
                                            field.enabled ? 'border-slate-200' : 'border-slate-100 bg-slate-50/60'
                                        }`}
                                    >
                                        <div className="flex items-start gap-3">
                                            {/* Reorder */}
                                            <div className="flex flex-col items-center gap-0.5 pt-0.5 shrink-0">
                                                <button
                                                    type="button"
                                                    onClick={() => move(index, -1)}
                                                    disabled={index === 0}
                                                    className="px-1 text-slate-300 hover:text-slate-600 disabled:opacity-30 disabled:hover:text-slate-300 text-xs leading-none"
                                                    aria-label={`Move ${field.label} up`}
                                                >
                                                    ▲
                                                </button>
                                                <GripVertical className="w-3.5 h-3.5 text-slate-200" />
                                                <button
                                                    type="button"
                                                    onClick={() => move(index, 1)}
                                                    disabled={index === fields.length - 1}
                                                    className="px-1 text-slate-300 hover:text-slate-600 disabled:opacity-30 disabled:hover:text-slate-300 text-xs leading-none"
                                                    aria-label={`Move ${field.label} down`}
                                                >
                                                    ▼
                                                </button>
                                            </div>

                                            <div className="flex-1 min-w-0 space-y-2.5">
                                                {/* Label + on/off */}
                                                <div className="flex items-center justify-between gap-3">
                                                    <input
                                                        value={field.label}
                                                        onChange={(e) => update(field.key, { label: e.target.value })}
                                                        maxLength={60}
                                                        placeholder="Field label"
                                                        className="flex-1 min-w-0 text-sm font-bold text-slate-900 bg-transparent border-b border-transparent hover:border-slate-200 focus:border-primary focus:outline-none py-0.5"
                                                    />
                                                    <label className="flex items-center gap-2 shrink-0 cursor-pointer select-none">
                                                        <span className="text-[10px] font-black uppercase tracking-wider text-slate-400">
                                                            {field.enabled ? 'On' : 'Off'}
                                                        </span>
                                                        <span className="relative inline-flex">
                                                            <input
                                                                type="checkbox"
                                                                checked={field.enabled}
                                                                onChange={(e) => update(field.key, {
                                                                    enabled: e.target.checked,
                                                                    ...(e.target.checked ? {} : { required: false }),
                                                                })}
                                                                className="sr-only peer"
                                                            />
                                                            <span className="w-11 h-6 rounded-full bg-slate-200 peer-checked:bg-primary transition-colors" />
                                                            <span className="absolute top-0.5 left-0.5 w-5 h-5 rounded-full bg-white shadow transition-transform peer-checked:translate-x-5" />
                                                        </span>
                                                    </label>
                                                </div>

                                                <p className="text-[11px] font-semibold text-slate-400 leading-snug">{hint}</p>

                                                {field.enabled && (
                                                    <div className="flex flex-wrap items-center gap-x-4 gap-y-2 pt-0.5">
                                                        <label className="flex items-center gap-2 cursor-pointer select-none">
                                                            <input
                                                                type="checkbox"
                                                                checked={field.required}
                                                                onChange={(e) => update(field.key, { required: e.target.checked })}
                                                                className="w-4 h-4 rounded border-slate-300 text-primary focus:ring-primary/30"
                                                            />
                                                            <span className="text-xs font-bold text-slate-600">Required</span>
                                                        </label>

                                                        {!builtin && (
                                                            <>
                                                                <select
                                                                    value={field.type}
                                                                    onChange={(e) => update(field.key, {
                                                                        type: e.target.value as GuestFormField['type'],
                                                                        ...(e.target.value === 'select' && !field.options?.length
                                                                            ? { options: ['Option 1'] }
                                                                            : {}),
                                                                    })}
                                                                    className="text-xs font-bold text-slate-700 bg-slate-50 border border-slate-200 rounded-lg px-2 py-1.5 focus:outline-none focus:ring-2 focus:ring-primary/20"
                                                                >
                                                                    <option value="text">Short text</option>
                                                                    <option value="textarea">Long text</option>
                                                                    <option value="select">Dropdown</option>
                                                                </select>
                                                                <button
                                                                    type="button"
                                                                    onClick={() => removeCustomField(field.key)}
                                                                    className="ml-auto flex items-center gap-1.5 text-xs font-bold text-red-500 hover:text-red-700 transition-colors"
                                                                >
                                                                    <Trash2 className="w-3.5 h-3.5" /> Remove
                                                                </button>
                                                            </>
                                                        )}
                                                    </div>
                                                )}

                                                {field.enabled && field.type === 'select' && (
                                                    <input
                                                        value={(field.options || []).join(', ')}
                                                        onChange={(e) => update(field.key, {
                                                            options: e.target.value.split(',').map(o => o.trim()).filter(Boolean),
                                                        })}
                                                        placeholder="Comma-separated options, e.g. Housekeeping, AC, Plumbing"
                                                        className="w-full text-xs font-semibold text-slate-700 bg-slate-50 border border-slate-200 rounded-lg px-2.5 py-2 focus:outline-none focus:ring-2 focus:ring-primary/20"
                                                    />
                                                )}

                                                {field.enabled && field.type !== 'select' && field.key !== 'photos' && (
                                                    <input
                                                        value={field.placeholder || ''}
                                                        onChange={(e) => update(field.key, { placeholder: e.target.value })}
                                                        maxLength={120}
                                                        placeholder="Placeholder text shown inside the box (optional)"
                                                        className="w-full text-xs font-semibold text-slate-600 bg-slate-50 border border-slate-200 rounded-lg px-2.5 py-2 focus:outline-none focus:ring-2 focus:ring-primary/20"
                                                    />
                                                )}
                                            </div>
                                        </div>
                                    </div>
                                );
                            })}

                            {/* Add custom field */}
                            <button
                                type="button"
                                onClick={addCustomField}
                                disabled={customCount >= MAX_CUSTOM_FIELDS}
                                className="w-full flex items-center justify-center gap-2 py-3 rounded-xl border-2 border-dashed border-slate-300 text-sm font-bold text-slate-500 hover:border-primary hover:text-primary transition-colors disabled:opacity-40 disabled:hover:border-slate-300 disabled:hover:text-slate-500"
                            >
                                <Plus className="w-4 h-4" />
                                {customCount >= MAX_CUSTOM_FIELDS
                                    ? `Limit of ${MAX_CUSTOM_FIELDS} extra fields reached`
                                    : 'Add an extra field'}
                            </button>
                        </div>
                    )}
                </div>

                {/* Footer */}
                <div className="px-4 sm:px-6 py-3.5 border-t border-slate-100 bg-white flex items-center gap-2.5 shrink-0 pb-[max(0.875rem,env(safe-area-inset-bottom))]">
                    <Button
                        variant="outline"
                        onClick={resetToDefault}
                        disabled={loading || saving}
                        className="bg-white h-11 px-3 shrink-0"
                        title="Back to the standard form"
                    >
                        <RotateCcw className="w-4 h-4 sm:mr-2" />
                        <span className="hidden sm:inline">Reset</span>
                    </Button>
                    <Button
                        onClick={save}
                        disabled={loading || saving || enabledFields.length === 0}
                        className="flex-1 h-11 font-bold"
                    >
                        {saving ? (
                            <><Loader2 className="w-4 h-4 mr-2 animate-spin" /> Saving...</>
                        ) : saved ? (
                            <><Check className="w-4 h-4 mr-2" /> Saved</>
                        ) : (
                            <><Save className="w-4 h-4 mr-2" /> Save form setup</>
                        )}
                    </Button>
                </div>
            </motion.div>
        </motion.div>
    );
}
