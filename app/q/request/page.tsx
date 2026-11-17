'use client';

import React, { useState, useEffect, useRef, Suspense, useMemo } from 'react';
import { useSearchParams } from 'next/navigation';
import {
    Camera,
    MapPin,
    UploadCloud,
    CheckCircle2,
    AlertCircle,
    Loader2,
    X,
    User,
    FileText,
    Copy,
    Check,
    ShieldCheck,
    AlertTriangle,
    Layers,
    BadgeCheck,
    Phone,
    Mail,
    ListFilter,
} from 'lucide-react';
import { Button } from '@/frontend/components/ui/button';
import { Input } from '@/frontend/components/ui/input';
import imageCompression from 'browser-image-compression';
import {
    DEFAULT_GUEST_FORM_FIELDS,
    GuestFormField,
    MAX_GUEST_PHOTOS,
    maxLengthForField,
    normalizeGuestFormFields,
    validateGuestFormAnswer,
    visibleGuestFormFields,
} from '@/frontend/lib/guestTicketForm';

interface ZoneInfo {
    id: string;
    zoneName: string;
    floor: string | null;
    propertyName: string | null;
}

/** The icon shown beside each field's label. */
const FIELD_ICONS: Record<string, React.ComponentType<{ className?: string }>> = {
    guest_name: User,
    client_id: BadgeCheck,
    process_name: Layers,
    description: FileText,
    guest_phone: Phone,
    guest_email: Mail,
    photos: Camera,
};

const INPUT_CLASS =
    'h-13 px-4 rounded-2xl border-2 border-slate-200 hover:border-slate-300 focus-visible:border-primary ' +
    'focus-visible:ring-4 focus-visible:ring-primary/15 text-base font-bold text-slate-900 ' +
    'placeholder:text-slate-400 placeholder:font-medium bg-slate-50/60 focus:bg-white transition-all shadow-xs';

function GuestRequestContent() {
    const searchParams = useSearchParams();
    const zoneId = searchParams.get('zoneId');
    const sig = searchParams.get('sig');
    const initialProcess = searchParams.get('process') || searchParams.get('category') || '';

    const [fields, setFields] = useState<GuestFormField[]>(() => visibleGuestFormFields(DEFAULT_GUEST_FORM_FIELDS));
    const [answers, setAnswers] = useState<Record<string, string>>({});
    const [photos, setPhotos] = useState<File[]>([]);

    const [zoneInfo, setZoneInfo] = useState<ZoneInfo | null>(null);
    const [zoneLoading, setZoneLoading] = useState(true);
    const [zoneError, setZoneError] = useState<string | null>(null);

    const [deviceInfo, setDeviceInfo] = useState<any>({});
    const [locationData, setLocationData] = useState<any>({});

    const [status, setStatus] = useState<'idle' | 'loading' | 'success' | 'error'>('idle');
    const [errorMessage, setErrorMessage] = useState('');
    const [submittedTicket, setSubmittedTicket] = useState<{ ticketNumber?: string; name?: string } | null>(null);
    const [copied, setCopied] = useState(false);

    const fileInputRef = useRef<HTMLInputElement>(null);

    const textFields = useMemo(() => fields.filter(f => f.key !== 'photos'), [fields]);
    const photosField = useMemo(() => fields.find(f => f.key === 'photos'), [fields]);

    // Fetch zone information and this property's form configuration on mount.
    useEffect(() => {
        if (!zoneId || !sig) {
            setZoneLoading(false);
            setZoneError('Missing QR parameters. Please scan the QR code again.');
            return;
        }

        const fetchZoneInfo = async () => {
            try {
                setZoneLoading(true);
                const res = await fetch(`/api/public/zone-info?zoneId=${encodeURIComponent(zoneId)}&sig=${encodeURIComponent(sig)}`);
                const data = await res.json();

                if (!res.ok || !data.success) {
                    setZoneError(data.error || 'Invalid or expired QR code.');
                    return;
                }

                setZoneInfo(data.zone);
                const resolved = visibleGuestFormFields(normalizeGuestFormFields(data.formFields));
                setFields(resolved);

                // Pre-fill the process field from the QR link when that field is in use.
                if (initialProcess && resolved.some(f => f.key === 'process_name')) {
                    setAnswers(prev => ({ process_name: initialProcess, ...prev }));
                }
            } catch (err) {
                console.error('Failed to load zone info:', err);
                setZoneError('Unable to verify location. Please check your connection.');
            } finally {
                setZoneLoading(false);
            }
        };

        fetchZoneInfo();
    }, [zoneId, sig, initialProcess]);

    useEffect(() => {
        // Capture Device Info
        if (typeof window !== 'undefined') {
            setDeviceInfo({
                userAgent: navigator.userAgent,
                platform: navigator.platform,
                language: navigator.language,
                screenResolution: `${window.screen.width}x${window.screen.height}`
            });
        }
    }, []);

    const requestLocation = () => {
        if ('geolocation' in navigator) {
            navigator.geolocation.getCurrentPosition(
                (position) => {
                    setLocationData({
                        lat: position.coords.latitude,
                        lng: position.coords.longitude,
                        accuracy: position.coords.accuracy
                    });
                },
                (error) => {
                    console.warn("Location error:", error);
                },
                { enableHighAccuracy: true, timeout: 5000, maximumAge: 0 }
            );
        }
    };

    const setAnswer = (key: string, value: string) => {
        setAnswers(prev => ({ ...prev, [key]: value }));
    };

    const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
        if (e.target.files) {
            const selectedFiles = Array.from(e.target.files);
            setPhotos((prev) => [...prev, ...selectedFiles].slice(0, MAX_GUEST_PHOTOS));
        }
        // Allow picking the same file again after removing it.
        e.target.value = '';
    };

    const removePhoto = (index: number) => {
        setPhotos(photos.filter((_, i) => i !== index));
    };

    const uploadPhoto = async (file: File): Promise<string> => {
        // Compress the image
        const options = {
            maxSizeMB: 1,
            maxWidthOrHeight: 1920,
            useWebWorker: true,
            fileType: file.type
        };

        let fileToUpload = file;
        try {
            fileToUpload = await imageCompression(file, options);
        } catch (error) {
            console.warn('Image compression failed, using original file', error);
        }

        // Get presigned URL
        const res = await fetch('/api/public/get-presigned-url', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ zoneId, sig, fileName: fileToUpload.name })
        });

        if (!res.ok) throw new Error('Failed to get upload URL');
        const data = await res.json();

        // Upload to Supabase Storage
        const uploadRes = await fetch(data.signedUrl, {
            method: 'PUT',
            headers: { 'Content-Type': fileToUpload.type },
            body: fileToUpload
        });

        if (!uploadRes.ok) throw new Error('Failed to upload photo');

        return data.path;
    };

    /** The first validation message across the configured fields, or null when the form is complete. */
    const validationError = useMemo(() => {
        for (const field of textFields) {
            const message = validateGuestFormAnswer(field, answers[field.key] ?? '');
            if (message) return message;
        }
        if (photosField?.required && photos.length === 0) {
            return `${photosField.label} is required.`;
        }
        return null;
    }, [textFields, photosField, answers, photos.length]);

    const handleSubmit = async (e: React.FormEvent) => {
        e.preventDefault();

        if (!zoneId || !sig) {
            setErrorMessage('Invalid QR Code. Missing parameters.');
            setStatus('error');
            return;
        }

        if (validationError) {
            setErrorMessage(validationError);
            setStatus('error');
            return;
        }

        setStatus('loading');
        setErrorMessage('');
        requestLocation();

        try {
            const uploadedPhotoPaths = photosField ? await Promise.all(photos.map(uploadPhoto)) : [];

            const payloadAnswers: Record<string, string> = {};
            for (const field of textFields) {
                const value = (answers[field.key] ?? '').trim();
                if (value) payloadAnswers[field.key] = value;
            }

            const res = await fetch('/api/public/submit-guest-request', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    zoneId,
                    sig,
                    answers: payloadAnswers,
                    photoUrls: uploadedPhotoPaths,
                    deviceInfo,
                    locationData
                })
            });

            if (!res.ok) {
                const errData = await res.json().catch(() => ({}));
                throw new Error(errData.error || 'Failed to submit request');
            }

            const resData = await res.json();
            const ticketNum = resData.data?.ticket_number || (resData.data?.id ? `GR-${resData.data.id.substring(0, 6).toUpperCase()}` : undefined);

            setSubmittedTicket({
                ticketNumber: ticketNum,
                name: (answers.guest_name || '').trim() || undefined
            });
            setStatus('success');
        } catch (error: any) {
            setStatus('error');
            setErrorMessage(error.message || 'An unexpected error occurred. Please try again.');
        }
    };

    const copyTicketNumber = () => {
        if (submittedTicket?.ticketNumber) {
            navigator.clipboard.writeText(submittedTicket.ticketNumber);
            setCopied(true);
            setTimeout(() => setCopied(false), 2000);
        }
    };

    // Invalid QR or Missing params view
    if (zoneError) {
        return (
            <div className="min-h-[100dvh] bg-gradient-to-b from-slate-50 via-slate-100 to-slate-200/80 flex flex-col justify-center items-center p-4 sm:p-6">
                <div className="w-full max-w-md bg-white rounded-3xl p-7 sm:p-9 shadow-2xl border-2 border-slate-200/90 text-center space-y-5">
                    <div className="w-16 h-16 rounded-3xl bg-amber-50 border-2 border-amber-200 text-amber-600 flex items-center justify-center mx-auto shadow-sm">
                        <AlertTriangle className="w-8 h-8" />
                    </div>
                    <div className="space-y-2">
                        <h2 className="text-2xl font-black text-slate-900 tracking-tight">Invalid QR Code</h2>
                        <p className="text-sm font-bold text-slate-600 leading-relaxed max-w-xs mx-auto">
                            {zoneError}
                        </p>
                    </div>
                    <div className="pt-2 border-t border-slate-100">
                        <p className="text-xs font-black uppercase tracking-widest text-slate-400">
                            Please scan an official Autopilot Facility QR
                        </p>
                    </div>
                </div>
            </div>
        );
    }

    // Success View
    if (status === 'success') {
        return (
            <div className="min-h-[100dvh] bg-gradient-to-b from-slate-50 via-slate-100 to-slate-200/80 flex flex-col justify-between p-4 sm:p-6 lg:p-8">
                <div className="max-w-md mx-auto w-full pt-4 sm:pt-8">
                    {/* Brand Header */}
                    <div className="flex flex-col items-center mb-7 text-center">
                        <img
                            src="/autopilot-logo-new.png"
                            alt="Autopilot"
                            className="h-9 sm:h-10 w-auto object-contain mb-2"
                        />
                        <span className="text-[11px] sm:text-xs font-black uppercase tracking-[0.25em] text-slate-500">
                            Facility Assistance
                        </span>
                    </div>

                    {/* Success Card */}
                    <div className="bg-white rounded-3xl p-7 sm:p-9 shadow-2xl border-2 border-slate-200/90 text-center space-y-7">
                        <div className="w-20 h-20 rounded-3xl bg-emerald-50 border-4 border-emerald-200 text-emerald-600 flex items-center justify-center mx-auto shadow-md">
                            <CheckCircle2 className="w-11 h-11" />
                        </div>

                        <div className="space-y-2">
                            <h2 className="text-2xl sm:text-3xl font-black text-slate-900 tracking-tight">
                                Request Submitted
                            </h2>
                            <p className="text-sm sm:text-base font-bold text-slate-600 leading-relaxed">
                                {submittedTicket?.name ? (
                                    <>Thank you, <span className="font-black text-slate-900">{submittedTicket.name}</span>. </>
                                ) : 'Thank you. '}
                                Our facility management operations team has received your report and is taking action.
                            </p>
                        </div>

                        {/* Reference Ticket Box */}
                        {submittedTicket?.ticketNumber && (
                            <div className="bg-slate-50 border-2 border-slate-200/90 rounded-2xl p-5 flex items-center justify-between gap-3 shadow-xs">
                                <div className="text-left min-w-0">
                                    <span className="text-[10px] sm:text-[11px] font-black uppercase tracking-widest text-slate-500 block">
                                        Ticket Reference
                                    </span>
                                    <span className="text-lg sm:text-xl font-black text-slate-900 tracking-wider font-mono break-all">
                                        {submittedTicket.ticketNumber}
                                    </span>
                                </div>
                                <button
                                    onClick={copyTicketNumber}
                                    className="p-3 rounded-xl bg-white border-2 border-slate-200 text-slate-700 hover:text-slate-900 hover:bg-slate-100 active:scale-95 transition-all shadow-sm shrink-0"
                                    title="Copy reference number"
                                >
                                    {copied ? <Check className="w-5 h-5 text-emerald-600" /> : <Copy className="w-5 h-5" />}
                                </button>
                            </div>
                        )}

                        <p className="text-xs font-bold text-slate-500 leading-relaxed">
                            Keep this reference handy if you need to follow up with the facility team.
                        </p>
                    </div>
                </div>

                <div className="text-center py-6">
                    <p className="text-xs font-black tracking-wide text-slate-400">
                        Powered by <span className="font-black text-slate-700">Autopilot FMS</span>
                    </p>
                </div>
            </div>
        );
    }

    /** One configured field, rendered according to its type. */
    const renderField = (field: GuestFormField) => {
        const Icon = FIELD_ICONS[field.key] || (field.type === 'select' ? ListFilter : FileText);
        const value = answers[field.key] ?? '';
        const limit = maxLengthForField(field);

        return (
            <div key={field.key} className="space-y-2">
                <div className="flex justify-between items-center gap-2">
                    <label
                        htmlFor={`field-${field.key}`}
                        className="text-xs sm:text-[13px] font-black uppercase tracking-wider text-slate-800 flex items-center gap-1.5"
                    >
                        <Icon className="w-3.5 h-3.5 text-slate-500 shrink-0" />
                        <span>{field.label}</span>
                        {field.required
                            ? <span className="text-red-500 font-black ml-0.5">*</span>
                            : <span className="text-[10px] font-bold text-slate-400 normal-case tracking-normal">(optional)</span>}
                    </label>
                    {field.type === 'textarea' && (
                        <span className="text-xs font-black text-slate-500 bg-slate-100 px-2.5 py-0.5 rounded-lg border border-slate-200 shrink-0">
                            {value.length}/{limit}
                        </span>
                    )}
                </div>

                {field.type === 'textarea' ? (
                    <textarea
                        id={`field-${field.key}`}
                        maxLength={limit}
                        placeholder={field.placeholder}
                        className="flex w-full min-h-[120px] rounded-2xl border-2 border-slate-200 bg-slate-50/60 focus:bg-white px-4 py-3.5 text-base font-bold text-slate-900 transition-all placeholder:text-slate-400 placeholder:font-medium focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-primary/15 focus-visible:border-primary disabled:cursor-not-allowed disabled:opacity-50 hover:border-slate-300 resize-none shadow-xs"
                        value={value}
                        onChange={(e) => setAnswer(field.key, e.target.value)}
                        disabled={status === 'loading'}
                    />
                ) : field.type === 'select' ? (
                    <select
                        id={`field-${field.key}`}
                        value={value}
                        onChange={(e) => setAnswer(field.key, e.target.value)}
                        disabled={status === 'loading'}
                        className="flex w-full h-13 rounded-2xl border-2 border-slate-200 bg-slate-50/60 focus:bg-white px-4 text-base font-bold text-slate-900 transition-all focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-primary/15 focus-visible:border-primary hover:border-slate-300 shadow-xs appearance-none"
                    >
                        <option value="">{field.placeholder || `Select ${field.label}`}</option>
                        {(field.options || []).map(option => (
                            <option key={option} value={option}>{option}</option>
                        ))}
                    </select>
                ) : (
                    <Input
                        id={`field-${field.key}`}
                        type={field.type === 'tel' ? 'tel' : field.type === 'email' ? 'email' : 'text'}
                        inputMode={field.type === 'tel' ? 'tel' : field.type === 'email' ? 'email' : 'text'}
                        maxLength={limit}
                        placeholder={field.placeholder}
                        value={value}
                        onChange={(e) => setAnswer(field.key, e.target.value)}
                        disabled={status === 'loading'}
                        className={INPUT_CLASS}
                    />
                )}
            </div>
        );
    };

    return (
        <div className="min-h-[100dvh] bg-gradient-to-b from-slate-50 via-slate-100 to-slate-200/80 flex flex-col">
            <div className="flex-1 w-full max-w-md mx-auto px-4 pt-6 pb-4 sm:px-6 sm:pt-8">
                {/* Brand Header */}
                <div className="flex flex-col items-center mb-5 sm:mb-7 text-center">
                    <img
                        src="/autopilot-logo-new.png"
                        alt="Autopilot"
                        className="h-9 sm:h-10 w-auto object-contain mb-2"
                    />
                    <p className="text-[11px] sm:text-xs font-black uppercase tracking-[0.25em] text-slate-500">
                        Facility Management
                    </p>
                </div>

                {/* Main Card */}
                <div className="bg-white rounded-3xl shadow-2xl shadow-slate-900/10 border-2 border-slate-200/90 overflow-hidden">
                    {/* Header Banner */}
                    <div className="p-5 sm:p-8 border-b-2 border-slate-100 bg-white">
                        <h1 className="text-[1.6rem] leading-tight sm:text-3xl font-black text-slate-900 tracking-tight">
                            Facility Request
                        </h1>
                        <p className="text-xs sm:text-sm font-bold text-slate-500 leading-relaxed mt-1.5">
                            Describe the issue you are facing here. No login required.
                        </p>

                        {/* Scanned Location Banner */}
                        <div className="mt-3.5 flex items-start gap-2 p-2.5 sm:px-3.5 sm:py-2 rounded-xl bg-slate-50 border border-slate-200 text-xs font-bold text-slate-700 shadow-2xs">
                            <MapPin className="w-4 h-4 text-primary shrink-0 mt-0.5" />
                            <div className="flex flex-wrap items-center gap-x-2 gap-y-0.5 min-w-0">
                                <span className="font-black text-slate-900">
                                    {zoneLoading ? 'Checking location...' : (zoneInfo?.zoneName || 'Designated Facility Area')}
                                </span>
                                {zoneInfo?.floor && (
                                    <span className="text-slate-600 font-bold">
                                        • Floor: {zoneInfo.floor.trim()}
                                    </span>
                                )}
                                {zoneInfo?.propertyName && (
                                    <span className="text-slate-500 font-medium">
                                        • {zoneInfo.propertyName.trim()}
                                    </span>
                                )}
                            </div>
                        </div>
                    </div>

                    {/* Form */}
                    <form onSubmit={handleSubmit} className="p-5 sm:p-8 space-y-5 sm:space-y-7">
                        {status === 'error' && errorMessage && (
                            <div className="bg-red-50 border-2 border-red-200 text-red-800 p-4 rounded-2xl flex gap-3 items-start text-xs sm:text-sm font-bold animate-in fade-in shadow-xs">
                                <AlertCircle className="w-5 h-5 shrink-0 text-red-600 mt-0.5" />
                                <span>{errorMessage}</span>
                            </div>
                        )}

                        {zoneLoading ? (
                            <div className="space-y-5" aria-hidden>
                                {[0, 1, 2].map(i => (
                                    <div key={i} className="space-y-2">
                                        <div className="h-3 w-28 rounded bg-slate-100 animate-pulse" />
                                        <div className="h-13 rounded-2xl bg-slate-100 animate-pulse" />
                                    </div>
                                ))}
                            </div>
                        ) : (
                            <>
                                {textFields.map(renderField)}

                                {/* Photos Upload */}
                                {photosField && (
                                    <div className="space-y-2">
                                        <div className="flex justify-between items-center gap-2">
                                            <label className="text-xs sm:text-[13px] font-black uppercase tracking-wider text-slate-800 flex items-center gap-1.5">
                                                <Camera className="w-3.5 h-3.5 text-slate-500 shrink-0" />
                                                <span>{photosField.label}</span>
                                                {photosField.required
                                                    ? <span className="text-red-500 font-black ml-0.5">*</span>
                                                    : <span className="text-[10px] font-bold text-slate-400 normal-case tracking-normal">(optional)</span>}
                                            </label>
                                            <span className="text-xs font-black text-slate-500 bg-slate-100 px-2.5 py-0.5 rounded-lg border border-slate-200 shrink-0">
                                                {photos.length}/{MAX_GUEST_PHOTOS}
                                            </span>
                                        </div>

                                        <div
                                            className={`border-2 border-dashed border-slate-300 rounded-2xl transition-all ${
                                                photos.length === 0
                                                    ? 'p-6 sm:p-7 bg-slate-50/70 hover:bg-slate-50 hover:border-primary cursor-pointer flex flex-col items-center justify-center text-center group'
                                                    : 'p-3.5 bg-slate-50/50'
                                            }`}
                                            onClick={() => {
                                                if (photos.length === 0) fileInputRef.current?.click();
                                            }}
                                        >
                                            {photos.length === 0 ? (
                                                <>
                                                    <div className="w-14 h-14 rounded-2xl bg-white border-2 border-slate-200 shadow-md flex items-center justify-center text-primary mb-3 group-hover:scale-105 group-hover:border-primary/40 transition-transform">
                                                        <Camera className="w-6 h-6" />
                                                    </div>
                                                    <span className="text-sm sm:text-base font-black text-slate-800">
                                                        Take photo or upload
                                                    </span>
                                                    <span className="text-xs font-bold text-slate-500 mt-1">
                                                        Capture photo for faster inspection and resolution
                                                    </span>
                                                </>
                                            ) : (
                                                <div className="grid grid-cols-3 gap-3">
                                                    {photos.map((file, idx) => (
                                                        <div key={idx} className="relative group aspect-square rounded-2xl overflow-hidden bg-slate-200 border-2 border-slate-200 shadow-sm">
                                                            <img
                                                                src={URL.createObjectURL(file)}
                                                                alt="Preview"
                                                                className="w-full h-full object-cover"
                                                            />
                                                            <button
                                                                type="button"
                                                                onClick={(e) => {
                                                                    e.stopPropagation();
                                                                    removePhoto(idx);
                                                                }}
                                                                className="absolute top-1.5 right-1.5 bg-red-600 hover:bg-red-700 text-white rounded-full p-1.5 shadow-lg transition-all active:scale-90"
                                                                title="Remove photo"
                                                            >
                                                                <X className="w-3.5 h-3.5" />
                                                            </button>
                                                        </div>
                                                    ))}
                                                    {photos.length < MAX_GUEST_PHOTOS && (
                                                        <div
                                                            className="aspect-square flex flex-col items-center justify-center border-2 border-dashed border-slate-300 rounded-2xl bg-white hover:bg-slate-50 hover:border-primary cursor-pointer transition-all active:scale-95 shadow-xs"
                                                            onClick={(e) => {
                                                                e.stopPropagation();
                                                                fileInputRef.current?.click();
                                                            }}
                                                        >
                                                            <Camera className="w-6 h-6 text-slate-400 mb-1" />
                                                            <span className="text-[10px] sm:text-[11px] font-black uppercase tracking-wider text-slate-600">Add More</span>
                                                        </div>
                                                    )}
                                                </div>
                                            )}
                                            <input
                                                type="file"
                                                accept="image/*"
                                                capture="environment"
                                                multiple
                                                className="hidden"
                                                ref={fileInputRef}
                                                onChange={handleFileChange}
                                                disabled={photos.length >= MAX_GUEST_PHOTOS || status === 'loading'}
                                            />
                                        </div>
                                    </div>
                                )}

                                {/* Submit Button */}
                                <div className="pt-1 space-y-3.5">
                                    <Button
                                        className="w-full h-14 bg-primary hover:bg-primary/95 text-white font-black rounded-2xl shadow-xl shadow-primary/25 text-sm sm:text-base uppercase tracking-wider transition-all active:scale-[0.98] flex items-center justify-center gap-2.5"
                                        type="submit"
                                        disabled={status === 'loading' || !zoneId || !sig || !!validationError}
                                    >
                                        {status === 'loading' ? (
                                            <>
                                                <Loader2 className="w-5 h-5 mr-2 animate-spin" /> Submitting Report...
                                            </>
                                        ) : (
                                            <>
                                                <UploadCloud className="w-5 h-5 mr-1" /> Submit Issue Report
                                            </>
                                        )}
                                    </Button>

                                    <p className="text-xs font-bold text-slate-500 text-center flex items-center justify-center gap-2">
                                        <ShieldCheck className="w-4 h-4 text-emerald-600 shrink-0" />
                                        Instant dispatch to maintenance operations team
                                    </p>
                                </div>
                            </>
                        )}
                    </form>
                </div>
            </div>

            {/* Footer */}
            <div className="text-center pb-[max(1.5rem,env(safe-area-inset-bottom))] pt-2">
                <p className="text-xs font-black tracking-wide text-slate-400">
                    Powered by <span className="font-black text-slate-700">Autopilot FMS</span>
                </p>
            </div>
        </div>
    );
}

export default function GuestRequestPage() {
    return (
        <Suspense fallback={
            <div className="min-h-[100dvh] bg-slate-100 flex items-center justify-center p-4">
                <div className="text-center space-y-3">
                    <Loader2 className="w-8 h-8 animate-spin mx-auto text-primary" />
                    <p className="text-xs font-bold uppercase tracking-widest text-slate-400">Loading Facility Portal...</p>
                </div>
            </div>
        }>
            <GuestRequestContent />
        </Suspense>
    );
}
