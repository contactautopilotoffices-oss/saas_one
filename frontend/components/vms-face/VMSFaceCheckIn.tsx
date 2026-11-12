'use client';

import React, { useState, useEffect } from 'react';
import { User, Truck, Building2, ArrowRight, ArrowLeft, LogIn, LogOut, Check, ScanFace, ShieldCheck, Info } from 'lucide-react';
import { motion } from 'framer-motion';
import CameraCapture from './CameraCapture';
import HostAutoComplete from './HostAutoComplete';

// VMS Face (testing) — copy of vms/VMSKiosk.tsx for the Tech Team. Writes to /api/vms-face, never /api/vms.

const PURPOSES = [
    { id: 'meeting', label: 'Meeting' },
    { id: 'interview', label: 'Interview' },
    { id: 'delivery', label: 'Delivery' },
    { id: 'vendor_work', label: 'Vendor work' },
    { id: 'personal', label: 'Personal' },
    { id: 'other', label: 'Other' },
];

interface VMSFaceCheckInProps {
    propertyId: string;
    propertyName: string;
}

type Category = 'visitor' | 'vendor' | 'other';
type KioskStep = 'home' | 'category' | 'visitor_type' | 'mobile' | 'verify_face' | 'consent' | 'enroll_photo' | 'form' | 'success' | 'checkout' | 'checkout_success';

// Face flow, consent first. Reception asks "Have you visited before?"
//   Returning → photo only → found among saved (consented) faces → fixed details pre-filled.
//   New → mobile → WhatsApp OTP consent → only then the photo is taken and saved.
// Declined or not found → manual check-in.
interface OtpState {
    challengeId: string;
    delivery: 'screen_test' | 'whatsapp';
    testCode?: string;
    consentText: string;
    verified: boolean;
}

interface FormData {
    name: string;
    mobile: string;
    coming_from: string;
    whom_to_meet: string;
    purpose: string;
    photo_url: string;
}

const VMSFaceCheckIn: React.FC<VMSFaceCheckInProps> = ({ propertyId, propertyName }) => {
    return (
        <div className="fixed inset-0 sm:relative sm:min-h-[700px] w-full h-full overflow-hidden">
            <VMSFaceCheckInContent propertyId={propertyId} propertyName={propertyName} />
        </div>
    );
};

const VMSFaceCheckInContent: React.FC<VMSFaceCheckInProps> = ({ propertyId, propertyName }) => {
    const [step, setStep] = useState<KioskStep>('home');
    const [category, setCategory] = useState<Category>('visitor');
    const [formData, setFormData] = useState<FormData>({
        name: '',
        mobile: '',
        coming_from: '',
        whom_to_meet: '',
        purpose: '',
        photo_url: '',
    });
    const [hostId, setHostId] = useState<string | null>(null);
    const [photoBlob, setPhotoBlob] = useState<Blob | null>(null);
    const [visitorId, setVisitorId] = useState('');
    const [checkoutId, setCheckoutId] = useState('');
    const [checkoutName, setCheckoutName] = useState('');
    const [isSubmitting, setIsSubmitting] = useState(false);
    const [error, setError] = useState('');
    const [faceProfileId, setFaceProfileId] = useState<string | null>(null);
    const [faceScore, setFaceScore] = useState<number | null>(null);
    const [faceNotice, setFaceNotice] = useState('');
    const [otp, setOtp] = useState<OtpState | null>(null);
    const [otpCode, setOtpCode] = useState('');

    // Reset to home after 30 seconds of inactivity on success screens
    useEffect(() => {
        if (step === 'success' || step === 'checkout_success') {
            const timer = setTimeout(() => resetKiosk(), 30000);
            return () => clearTimeout(timer);
        }
    }, [step]);

    const resetKiosk = () => {
        setStep('home');
        setCategory('visitor');
        setFormData({ name: '', mobile: '', coming_from: '', whom_to_meet: '', purpose: '', photo_url: '' });
        setHostId(null);
        setPhotoBlob(null);
        setVisitorId('');
        setCheckoutId('');
        setCheckoutName('');
        setError('');
        setFaceProfileId(null);
        setFaceScore(null);
        setFaceNotice('');
        setOtp(null);
        setOtpCode('');
    };

    const handlePhotoCapture = (imageUrl: string, blob: Blob) => {
        setFormData(prev => ({ ...prev, photo_url: imageUrl }));
        setPhotoBlob(blob);
    };

    const postJson = async (path: string, body: unknown) => {
        const res = await fetch(`/api/vms-face/${propertyId}${path}`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(body),
        });
        const data = await res.json().catch(() => ({}));
        return { ok: res.ok, status: res.status, data };
    };

    const toManualForm = (notice: string) => {
        setError('');
        setFaceNotice(notice);
        setStep('form');
    };

    // Step 1, before any photo: does this mobile already have a saved face (consent on file)?
    const handleLookup = async () => {
        if (formData.mobile.length !== 10) { setError('Enter the visitor\'s 10-digit mobile number'); return; }
        setIsSubmitting(true);
        setError('');
        try {
            const { ok, data } = await postJson('/face/lookup', { mobile: formData.mobile });
            if (!ok) throw new Error(data.error || 'Lookup failed');
            if (data.status === 'returning') setStep('verify_face');
            else if (data.status === 'new') setStep('consent');
            else toManualForm('Face recognition is off. Check in manually.');
        } catch (err) {
            setError(err instanceof Error ? err.message : 'Lookup failed');
        } finally {
            setIsSubmitting(false);
        }
    };

    // Returning visitor: compare the photo with the one face saved for this mobile.
    // A match pre-fills only the fixed details; purpose and host stay empty.
    const handleVerifyFace = async (imageUrl: string, blob: Blob, jpeg: string) => {
        handlePhotoCapture(imageUrl, blob);
        setIsSubmitting(true);
        setError('');
        try {
            // With a mobile (came from the new-visitor path), compare with that mobile's face only.
            const byMobile = formData.mobile.length === 10;
            const { ok, data } = await postJson('/face/verify', { image: jpeg, ...(byMobile ? { mobile: formData.mobile } : {}) });
            if (!ok) throw new Error(data.error || 'Face check failed');

            if (data.status === 'match') {
                setFormData(prev => ({
                    ...prev,
                    name: data.profile.name || '',
                    mobile: String(data.profile.mobile || '').replace(/^\+91/, ''),
                    coming_from: data.profile.coming_from || '',
                }));
                setFaceProfileId(data.profile.id);
                setFaceScore(typeof data.score === 'number' ? data.score : null);
                toManualForm(`Returning visitor verified${typeof data.score === 'number' ? ` (match ${(data.score * 100).toFixed(0)}%)` : ''}. Check the details, then pick purpose and host.`);
            } else if (data.status === 'no_match' && !byMobile) {
                // Not among saved faces: treat as a new visitor (consent first). Don't keep the photo.
                setFormData(prev => ({ ...prev, photo_url: '' }));
                setPhotoBlob(null);
                setStep('mobile');
                setError('Face not found among saved visitors. Continue as a new visitor.');
            } else if (data.status === 'no_match') {
                toManualForm('The face did not match the face saved for this number. Check in manually.');
            } else if (data.status === 'no_profile') {
                setFormData(prev => ({ ...prev, photo_url: '' }));
                setStep('consent');
            } else if (data.status === 'no_face') {
                setFormData(prev => ({ ...prev, photo_url: '' }));
                setError('No face found in the photo. Retake it facing the camera.');
            } else if (data.status === 'spoof') {
                setFormData(prev => ({ ...prev, photo_url: '' }));
                setError('The photo looks like a screen or a print. Take a live photo of the visitor.');
            } else if (data.status === 'disabled') {
                toManualForm('Face recognition is off. Check in manually.');
            } else {
                toManualForm('Face service unavailable right now. Check in manually.');
            }
        } catch (err) {
            console.error('Face verify error:', err);
            toManualForm('Face check failed. Check in manually.');
        } finally {
            setIsSubmitting(false);
        }
    };

    const handleSendOtp = async () => {
        if (!formData.name.trim()) { setError('Enter the visitor\'s name'); return; }
        setIsSubmitting(true);
        setError('');
        try {
            const { ok, data } = await postJson('/face/otp', { action: 'send', mobile: formData.mobile });
            if (!ok) throw new Error(data.error || 'Could not send the code');
            setOtp({ challengeId: data.challenge_id, delivery: data.delivery, testCode: data.test_code, consentText: data.consent_text, verified: false });
            setOtpCode('');
        } catch (err) {
            setError(err instanceof Error ? err.message : 'Could not send the code');
        } finally {
            setIsSubmitting(false);
        }
    };

    // The code the visitor read out is their consent. Only after this is the photo taken.
    const handleVerifyOtp = async () => {
        if (!otp) return;
        setIsSubmitting(true);
        setError('');
        try {
            const { ok, data } = await postJson('/face/otp', { action: 'verify', challenge_id: otp.challengeId, code: otpCode });
            if (!ok) {
                const left = data.attempts_left;
                throw new Error(`${data.error || 'Wrong code'}${typeof left === 'number' ? ` ${left} attempt(s) left.` : ''}`);
            }
            setOtp(prev => prev ? { ...prev, verified: true } : prev);
            setStep('enroll_photo');
        } catch (err) {
            setError(err instanceof Error ? err.message : 'Verification failed');
        } finally {
            setIsSubmitting(false);
        }
    };

    // Consent verified: take the photo and save the face.
    const handleEnrollPhoto = async (imageUrl: string, blob: Blob, jpeg: string) => {
        if (!otp?.verified) return;
        handlePhotoCapture(imageUrl, blob);
        setIsSubmitting(true);
        setError('');
        try {
            const enroll = await postJson('/face/enroll', {
                challenge_id: otp.challengeId,
                image: jpeg,
                name: formData.name.trim(),
                coming_from: formData.coming_from.trim(),
            });
            if (enroll.status === 503) { toManualForm('Consent verified, but the face service is unavailable. Face not saved; check in manually.'); return; }
            if (enroll.status === 409) { toManualForm(enroll.data.error || 'Face not saved. Check in manually.'); return; }
            if (!enroll.ok) {
                setFormData(prev => ({ ...prev, photo_url: '' }));
                throw new Error(enroll.data.error || 'Could not save the face');
            }
            setFaceProfileId(enroll.data.profile.id);
            toManualForm(enroll.data.status === 'already_enrolled'
                ? 'Consent verified. This face was already saved; details updated.'
                : 'Consent verified and face saved. Next visit will be recognised.');
        } catch (err) {
            setError(err instanceof Error ? err.message : 'Could not save the face');
        } finally {
            setIsSubmitting(false);
        }
    };

    const handleCheckin = async () => {
        if (!formData.name) {
            setError('Please enter visitor name');
            return;
        }
        if (!formData.purpose) {
            setError('Please select the purpose of visit');
            return;
        }

        setIsSubmitting(true);
        setError('');

        try {
            // First create visitor log (without photo)
            const response = await fetch(`/api/vms-face/${propertyId}`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    category,
                    name: formData.name,
                    mobile: formData.mobile ? `+91${formData.mobile}` : null,
                    coming_from: formData.coming_from,
                    whom_to_meet: formData.whom_to_meet,
                    purpose: formData.purpose,
                    host_id: hostId,
                    face_profile_id: faceProfileId,
                    face_match_score: faceScore,
                }),
            });

            const data = await response.json();

            if (!response.ok) {
                throw new Error(data.error || 'Check-in failed');
            }

            // Upload photo to Supabase Storage if exists
            if (photoBlob && data.visitor_id) {
                const photoFormData = new FormData();
                photoFormData.append('file', photoBlob, `${data.visitor_id}.webp`);
                photoFormData.append('visitor_id', data.visitor_id);

                await fetch(`/api/vms-face/${propertyId}/photos`, {
                    method: 'POST',
                    body: photoFormData,
                }).catch(console.error); // Non-blocking
            }

            setVisitorId(data.visitor_id);
            setStep('success');
        } catch (err: any) {
            console.error('Check-in error:', err);
            setError(err.message || 'Failed to check in. Please try again.');
        } finally {
            setIsSubmitting(false);
        }
    };

    const handleCheckout = async () => {
        if (!checkoutId) {
            setError('Please enter your Visitor ID');
            return;
        }

        setIsSubmitting(true);
        setError('');

        try {
            const response = await fetch(`/api/vms-face/${propertyId}`, {
                method: 'PATCH',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ visitor_id: checkoutId }),
            });

            const data = await response.json();

            if (!response.ok) {
                throw new Error(data.error || 'Check-out failed');
            }

            setCheckoutName(data.visitor?.name || 'Visitor');
            setStep('checkout_success');
        } catch (err: any) {
            console.error('Check-out error:', err);
            setError(err.message || 'Visitor ID not found. Please check and try again.');
        } finally {
            setIsSubmitting(false);
        }
    };

    if (step === 'home') {
        return (
            <div className="h-full w-full bg-[#ebf5f4] relative flex flex-col items-center justify-center overflow-hidden sm:p-8 sm:rounded-[2.5rem]">
                {/* Brand Mesh Gradient Background */}
                <div className="absolute inset-0 z-0">
                    <div className="absolute top-[-10%] right-[-10%] w-[50%] h-[50%] bg-primary/20 rounded-full blur-[100px]" />
                    <div className="absolute bottom-[-10%] left-[-10%] w-[50%] h-[50%] bg-secondary/10 rounded-full blur-[100px]" />
                    <div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-full h-full bg-[#ebf5f4]/80" />
                </div>

                <motion.div
                    initial={{ opacity: 0, y: 20 }}
                    animate={{ opacity: 1, y: 0 }}
                    className="bg-white sm:rounded-[2rem] shadow-[0_20px_50px_rgba(0,0,0,0.3)] p-6 sm:p-10 w-full h-full sm:h-auto sm:max-w-md relative z-10 border border-white/10 flex flex-col justify-center"
                >
                    <div className="text-center mb-6 sm:mb-12">
                        <div className="w-14 h-14 sm:w-20 sm:h-20 bg-primary rounded-3xl flex items-center justify-center mx-auto mb-4 sm:mb-6 shadow-xl shadow-primary/20 rotate-3">
                            <User className="w-7 h-7 sm:w-10 sm:h-10 text-white -rotate-3" />
                        </div>
                        <h1 className="text-xl sm:text-2xl font-black text-slate-900 uppercase tracking-widest leading-tight">Visitor Management</h1>
                        <p className="text-slate-400 font-bold mt-2 flex items-center justify-center gap-2 text-xs sm:text-sm">
                            <span className="w-1.5 h-1.5 bg-secondary rounded-full animate-pulse" />
                            {propertyName}
                        </p>
                    </div>

                    <div className="grid grid-cols-2 gap-4">
                        <button
                            onClick={() => setStep('category')}
                            className="flex flex-col items-center justify-center p-6 sm:p-8 bg-emerald-500 hover:bg-emerald-600 text-white rounded-[1.5rem] transition-all shadow-lg shadow-emerald-500/20 active:scale-95 group"
                        >
                            <LogIn className="w-8 h-8 sm:w-10 sm:h-10 mb-2 group-hover:scale-110 transition-transform" />
                            <span className="text-xl font-black tracking-tight">IN</span>
                        </button>
                        <button
                            onClick={() => setStep('checkout')}
                            className="flex flex-col items-center justify-center p-6 sm:p-8 bg-rose-500 hover:bg-rose-600 text-white rounded-[1.5rem] transition-all shadow-lg shadow-rose-500/20 active:scale-95 group"
                        >
                            <LogOut className="w-8 h-8 sm:w-10 sm:h-10 mb-2 group-hover:scale-110 transition-transform" />
                            <span className="text-xl font-black tracking-tight">OUT</span>
                        </button>
                    </div>
                </motion.div>
            </div>
        );
    }

    // CATEGORY SELECTION
    if (step === 'category') {
        return (
            <div className="h-full w-full bg-[#ebf5f4] relative flex flex-col items-center justify-center overflow-hidden sm:p-8 sm:rounded-[2.5rem]">
                <div className="absolute inset-0 z-0">
                    <div className="absolute top-[-10%] right-[-10%] w-[50%] h-[50%] bg-primary/20 rounded-full blur-[100px]" />
                    <div className="absolute bottom-[-10%] left-[-10%] w-[50%] h-[50%] bg-secondary/10 rounded-full blur-[100px]" />
                    <div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-full h-full bg-[#ebf5f4]/80" />
                </div>
                <div className="bg-white sm:rounded-3xl shadow-2xl p-6 sm:p-8 w-full h-full sm:h-auto sm:max-w-md relative z-10 flex flex-col overflow-y-auto">
                    <button
                        onClick={() => setStep('home')}
                        className="flex items-center gap-2 text-slate-700 hover:text-slate-900 mb-4 sm:mb-6 text-sm sm:text-base font-medium transition-colors"
                    >
                        <ArrowLeft className="w-5 h-5" /> Back
                    </button>

                    <h2 className="text-xl sm:text-2xl font-black text-slate-900 mb-4 sm:mb-6 text-center leading-tight">Select Category</h2>

                    <div className="space-y-2 sm:space-y-3 mb-6 sm:mb-8">
                        {[
                            { id: 'visitor', label: 'Visitor', icon: User, color: 'bg-primary', desc: 'General visitor' },
                            { id: 'vendor', label: 'Vendor', icon: Truck, color: 'bg-secondary', desc: 'Delivery or service' },
                            { id: 'other', label: 'Other', icon: Building2, color: 'bg-slate-500', desc: 'Interview, meeting, etc.' },
                        ].map((cat) => (
                            <button
                                key={cat.id}
                                onClick={() => setCategory(cat.id as Category)}
                                className={`w-full flex items-center gap-3 sm:gap-4 p-3 sm:p-4 rounded-2xl border-2 transition-all ${category === cat.id
                                    ? 'border-indigo-500 bg-indigo-50'
                                    : 'border-slate-100 hover:border-slate-200'
                                    }`}
                            >
                                <div className={`w-10 h-10 sm:w-12 sm:h-12 ${cat.color} rounded-xl flex items-center justify-center text-white shrink-0`}>
                                    <cat.icon className="w-5 h-5 sm:w-6 sm:h-6" />
                                </div>
                                <div className="text-left">
                                    <p className="font-bold text-sm sm:text-base text-slate-900">{cat.label}</p>
                                    <p className="text-[10px] sm:text-xs text-slate-400">{cat.desc}</p>
                                </div>
                                {category === cat.id && (
                                    <Check className="w-4 h-4 sm:w-5 sm:h-5 text-indigo-600 ml-auto" />
                                )}
                            </button>
                        ))}
                    </div>

                    <button
                        onClick={() => { setError(''); setStep('visitor_type'); }}
                        className="w-full py-3.5 sm:py-4 bg-primary hover:bg-primary-dark text-white rounded-2xl font-black flex items-center justify-center gap-2 transition-all shadow-lg shadow-primary/20 text-sm sm:text-base"
                    >
                        Continue <ArrowRight className="w-5 h-5" />
                    </button>
                </div>
            </div>
        );
    }

    const panel = (children: React.ReactNode, onBack: () => void, backLabel = 'Back') => (
        <div className="h-full w-full bg-[#ebf5f4] relative flex flex-col items-center justify-center overflow-hidden sm:p-8 sm:rounded-[2.5rem]">
            <div className="bg-white sm:rounded-[2rem] shadow-2xl p-5 sm:p-8 w-full h-full sm:h-auto sm:max-w-md sm:max-h-[92vh] relative z-10 overflow-y-auto">
                <button
                    onClick={() => { setError(''); onBack(); }}
                    className="flex items-center gap-2 text-slate-700 hover:text-slate-900 mb-4 text-sm sm:text-base font-medium transition-colors"
                >
                    <ArrowLeft className="w-5 h-5" /> {backLabel}
                </button>
                {error && (
                    <div role="alert" className="bg-rose-50 border border-rose-200 text-rose-600 p-2.5 rounded-xl mb-3 text-[11px] sm:text-sm">
                        {error}
                    </div>
                )}
                {children}
            </div>
        </div>
    );

    const spinner = (label: string) => (
        <div className="flex flex-col items-center gap-3 py-12" aria-live="polite">
            <div className="w-8 h-8 border-2 border-slate-200 border-t-primary rounded-full animate-spin" />
            <p className="text-xs font-black uppercase tracking-widest text-slate-500">{label}</p>
        </div>
    );

    const skipButton = (label: string, notice: string) => (
        <button
            type="button"
            onClick={() => { setOtp(null); toManualForm(notice); }}
            disabled={isSubmitting}
            className="w-full mt-4 py-3 border border-slate-200 rounded-2xl text-xs font-black uppercase tracking-widest text-slate-600 hover:bg-slate-50 disabled:opacity-50"
        >
            {label}
        </button>
    );

    // STEP 1 — "Have you visited before?"
    if (step === 'visitor_type') {
        return panel(
            <>
                <div className="text-center mb-5">
                    <ScanFace className="w-10 h-10 text-primary mx-auto mb-2" />
                    <h2 className="text-lg sm:text-xl font-black text-slate-900 leading-tight">Have you visited before?</h2>
                    <p className="text-xs text-slate-500 mt-1">Ask the visitor. Returning visitors only need a photo.</p>
                </div>
                <div className="grid grid-cols-2 gap-3">
                    <button type="button" onClick={() => { setFormData(prev => ({ ...prev, mobile: '' })); setStep('verify_face'); }}
                        className="flex flex-col items-center justify-center gap-2 p-5 bg-emerald-500 hover:bg-emerald-600 text-white rounded-2xl font-black transition-all active:scale-95">
                        <ShieldCheck className="w-7 h-7" />
                        <span className="text-sm">Returning visitor</span>
                    </button>
                    <button type="button" onClick={() => setStep('mobile')}
                        className="flex flex-col items-center justify-center gap-2 p-5 bg-primary hover:bg-primary-dark text-white rounded-2xl font-black transition-all active:scale-95">
                        <User className="w-7 h-7" />
                        <span className="text-sm">New visitor</span>
                    </button>
                </div>
                {skipButton('Skip face — manual check-in', 'Face check skipped. Check in manually.')}
            </>,
            () => setStep('category'),
        );
    }

    // NEW VISITOR — MOBILE NUMBER (before any photo)
    if (step === 'mobile') {
        return panel(
            <>
                <div className="text-center mb-5">
                    <ScanFace className="w-10 h-10 text-primary mx-auto mb-2" />
                    <h2 className="text-lg sm:text-xl font-black text-slate-900 leading-tight">Visitor&apos;s Mobile Number</h2>
                    <p className="text-xs text-slate-500 mt-1">The consent code is sent to this number. No photo is taken until the visitor agrees.</p>
                </div>
                <label htmlFor="fv-mobile" className="block text-[10px] font-black text-slate-400 uppercase tracking-widest mb-1">Mobile (WhatsApp) *</label>
                <div className="flex rounded-2xl overflow-hidden border border-slate-200 focus-within:border-indigo-500 mb-4">
                    <span className="px-3 py-3 bg-slate-100 border-r border-slate-200 text-slate-500 font-medium text-sm">+91</span>
                    <input id="fv-mobile" type="tel" inputMode="numeric" autoFocus value={formData.mobile}
                        onChange={(e) => setFormData(prev => ({ ...prev, mobile: e.target.value.replace(/\D/g, '').slice(0, 10) }))}
                        onKeyDown={(e) => { if (e.key === 'Enter' && formData.mobile.length === 10) handleLookup(); }}
                        placeholder="10 digit"
                        className="flex-1 px-4 py-3 bg-slate-50 text-slate-900 font-medium focus:outline-none" />
                </div>
                <button type="button" onClick={handleLookup} disabled={isSubmitting || formData.mobile.length !== 10}
                    className="w-full py-3.5 bg-primary hover:bg-primary-dark text-white rounded-2xl font-black flex items-center justify-center gap-2 disabled:opacity-50">
                    {isSubmitting ? <div className="w-5 h-5 border-2 border-white/20 border-t-white rounded-full animate-spin" /> : <>Continue <ArrowRight className="w-5 h-5" /></>}
                </button>
                {skipButton('Skip face — manual check-in', 'Face check skipped. Check in manually.')}
            </>,
            () => setStep('visitor_type'),
        );
    }

    // RETURNING VISITOR — photo only (or, from the new-visitor path, compare with that mobile's face)
    if (step === 'verify_face') {
        return panel(
            <>
                <div className="text-center mb-4">
                    <ShieldCheck className="w-10 h-10 text-emerald-600 mx-auto mb-2" />
                    <h2 className="text-lg sm:text-xl font-black text-slate-900 leading-tight">Returning Visitor</h2>
                    <p className="text-xs text-slate-500 mt-1">
                        {formData.mobile.length === 10
                            ? <>+91 {formData.mobile} already has a saved face. Scan to verify it&apos;s them.</>
                            : <>Take the visitor&apos;s photo. Their details fill in automatically.</>}
                    </p>
                </div>
                {isSubmitting ? spinner('Checking face…') : <CameraCapture onCapture={handleVerifyFace} confirmLabel="Verify Face" />}
                {skipButton('Skip — manual check-in', 'Face check skipped. Check in manually.')}
            </>,
            () => setStep(formData.mobile.length === 10 ? 'mobile' : 'visitor_type'),
        );
    }

    // NEW VISITOR — consent by WhatsApp OTP, before any photo
    if (step === 'consent') {
        return panel(
            <>
                <div className="mb-4">
                    <h2 className="text-lg font-black text-slate-900 leading-tight">New Visitor — Consent</h2>
                    <p className="text-xs text-slate-500 mt-1">Ask if they agree to save their face for faster visits. No photo is taken until they agree.</p>
                </div>
                <div className="space-y-3">
                    <div>
                        <label htmlFor="fv-name" className="block text-[10px] font-black text-slate-400 uppercase tracking-widest mb-1">Name *</label>
                        <input id="fv-name" type="text" value={formData.name} disabled={!!otp}
                            onChange={(e) => setFormData(prev => ({ ...prev, name: e.target.value }))}
                            placeholder="Full name"
                            className="w-full px-4 py-3 bg-slate-50 border border-slate-200 rounded-2xl text-slate-900 font-medium focus:border-indigo-500 focus:ring-0 disabled:opacity-60" />
                    </div>
                    <div>
                        <label htmlFor="fv-company" className="block text-[10px] font-black text-slate-400 uppercase tracking-widest mb-1">Coming From</label>
                        <input id="fv-company" type="text" value={formData.coming_from} disabled={!!otp}
                            onChange={(e) => setFormData(prev => ({ ...prev, coming_from: e.target.value }))}
                            placeholder="Company or address"
                            className="w-full px-4 py-3 bg-slate-50 border border-slate-200 rounded-2xl text-slate-900 font-medium focus:border-indigo-500 focus:ring-0 disabled:opacity-60" />
                    </div>
                    <p className="text-xs text-slate-600">Mobile: <span className="font-bold">+91 {formData.mobile}</span></p>

                    {!otp ? (
                        <button type="button" onClick={handleSendOtp} disabled={isSubmitting || !formData.name.trim()}
                            className="w-full py-3.5 bg-primary hover:bg-primary-dark text-white rounded-2xl font-black flex items-center justify-center gap-2 disabled:opacity-50">
                            {isSubmitting ? <div className="w-5 h-5 border-2 border-white/20 border-t-white rounded-full animate-spin" /> : <>Send consent code</>}
                        </button>
                    ) : (
                        <div className="space-y-3 pt-1">
                            <div className="flex gap-2 p-3 bg-slate-50 border border-slate-200 rounded-xl text-[11px] text-slate-600">
                                <Info className="w-4 h-4 shrink-0 text-slate-400 mt-0.5" />
                                <p>
                                    {otp.delivery === 'whatsapp' ? 'A code was sent to the visitor on WhatsApp.' : 'Test mode: the code below would be sent on WhatsApp.'}
                                    {' '}Show this notice to the visitor (or read it aloud) before they share the code:
                                    {' '}<span className="italic font-semibold text-slate-800">&ldquo;{otp.consentText}&rdquo;</span> Then ask the visitor to read the code out.
                                </p>
                            </div>
                            {otp.testCode && (
                                <p className="text-center text-xs font-bold text-amber-700 bg-amber-50 border border-amber-200 rounded-xl py-2" aria-live="polite">
                                    Test code: <span className="font-mono text-base tracking-[0.3em]">{otp.testCode}</span>
                                </p>
                            )}
                            <label htmlFor="fv-otp" className="block text-[10px] font-black text-slate-400 uppercase tracking-widest">Code read out by visitor</label>
                            <input id="fv-otp" type="text" inputMode="numeric" autoComplete="one-time-code" value={otpCode}
                                onChange={(e) => setOtpCode(e.target.value.replace(/\D/g, '').slice(0, 6))}
                                placeholder="6 digits"
                                className="w-full px-4 py-3 bg-slate-50 border-2 border-slate-200 rounded-xl text-slate-900 font-bold text-lg text-center tracking-[0.4em] focus:border-indigo-500 focus:ring-0" />
                            <button type="button" onClick={handleVerifyOtp} disabled={isSubmitting || otpCode.length !== 6}
                                className="w-full py-3.5 bg-emerald-600 hover:bg-emerald-700 text-white rounded-2xl font-black flex items-center justify-center gap-2 disabled:opacity-50">
                                {isSubmitting ? <div className="w-5 h-5 border-2 border-white/20 border-t-white rounded-full animate-spin" /> : <><ShieldCheck className="w-5 h-5" /> Verify consent</>}
                            </button>
                            <button type="button" onClick={handleSendOtp} disabled={isSubmitting}
                                className="w-full text-[11px] font-bold text-slate-500 hover:text-slate-800 disabled:opacity-50">
                                Send a new code
                            </button>
                        </div>
                    )}
                </div>
                {skipButton('Visitor declines — check in without saving face', 'Visitor declined. Face not saved.')}
            </>,
            () => { setOtp(null); setStep('mobile'); },
        );
    }

    // NEW VISITOR — consent verified, now take the photo and save the face
    if (step === 'enroll_photo') {
        return panel(
            <>
                <div className="text-center mb-4">
                    <ShieldCheck className="w-10 h-10 text-emerald-600 mx-auto mb-2" />
                    <h2 className="text-lg sm:text-xl font-black text-slate-900 leading-tight">Consent Verified</h2>
                    <p className="text-xs text-slate-500 mt-1">Now take {formData.name.trim() || 'the visitor'}&apos;s photo to save their face.</p>
                </div>
                {isSubmitting ? spinner('Saving face…') : <CameraCapture onCapture={handleEnrollPhoto} confirmLabel="Save Face" />}
                {skipButton('Skip — check in without saving face', 'Face not saved. Check in manually.')}
            </>,
            () => { setOtp(null); setStep('consent'); },
        );
    }

    // VISITOR FORM
    if (step === 'form') {
        return (
            <div className="h-full w-full bg-[#ebf5f4] relative flex flex-col items-center justify-center overflow-hidden sm:p-8 sm:rounded-[2.5rem]">
                <div className="absolute inset-0 z-0">
                    <div className="absolute top-[-10%] right-[-10%] w-[40%] h-[40%] bg-primary/10 rounded-full blur-[100px]" />
                </div>
                <div className="bg-white sm:rounded-[2rem] shadow-2xl p-5 sm:p-8 w-full h-full sm:max-w-md sm:max-h-[92vh] overflow-y-auto relative z-10">
                    <button
                        onClick={() => setStep('category')}
                        className="flex items-center gap-2 text-slate-700 hover:text-slate-900 mb-4 sm:mb-6 text-sm sm:text-base font-medium transition-colors"
                    >
                        <ArrowLeft className="w-5 h-5" />
                        Back
                    </button>

                    <h2 className="text-lg sm:text-xl font-black text-slate-900 mb-4 sm:mb-6 leading-tight">Visitor Form</h2>

                    {faceNotice && (
                        <div aria-live="polite" className={`flex gap-2 p-2.5 rounded-xl mb-3 text-[11px] sm:text-sm border ${faceProfileId
                            ? 'bg-emerald-50 border-emerald-200 text-emerald-700'
                            : 'bg-slate-50 border-slate-200 text-slate-600'}`}>
                            {faceProfileId ? <ShieldCheck className="w-4 h-4 shrink-0 mt-0.5" /> : <Info className="w-4 h-4 shrink-0 mt-0.5" />}
                            <span>{faceNotice}</span>
                        </div>
                    )}

                    {error && (
                        <div className="bg-rose-50 border border-rose-200 text-rose-600 p-2.5 rounded-xl mb-3 text-[11px] sm:text-sm">
                            {error}
                        </div>
                    )}

                    <div className="space-y-3 sm:space-y-4">
                        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 sm:gap-4">
                            <div>
                                <label className="block text-[9px] sm:text-[10px] font-black text-slate-400 uppercase tracking-widest mb-1 sm:mb-1.5">
                                    Name *
                                </label>
                                <input
                                    type="text"
                                    value={formData.name}
                                    onChange={(e) => setFormData(prev => ({ ...prev, name: e.target.value }))}
                                    placeholder="Full name"
                                    className="w-full px-3 sm:px-4 py-2.5 sm:py-3 bg-slate-50 border border-slate-200 rounded-2xl text-slate-900 font-medium text-sm sm:text-base focus:border-indigo-500 focus:ring-0 transition-colors"
                                />
                            </div>

                            <div>
                                <label className="block text-[9px] sm:text-[10px] font-black text-slate-400 uppercase tracking-widest mb-1 sm:mb-1.5">
                                    Mobile
                                </label>
                                <div className="flex rounded-2xl overflow-hidden border border-slate-200 focus-within:border-indigo-500 transition-colors">
                                    <span className="px-2 sm:px-3 py-2.5 sm:py-3 bg-slate-100 border-r border-slate-200 text-slate-500 font-medium text-xs sm:text-sm shrink-0">
                                        +91
                                    </span>
                                    <input
                                        type="tel"
                                        value={formData.mobile}
                                        onChange={(e) => setFormData(prev => ({ ...prev, mobile: e.target.value.replace(/\D/g, '').slice(0, 10) }))}
                                        placeholder="10 digit"
                                        className="flex-1 px-3 sm:px-4 py-2.5 sm:py-3 bg-slate-50 text-slate-900 font-medium text-sm sm:text-base focus:outline-none"
                                    />
                                </div>
                            </div>
                        </div>

                        <div>
                            <label className="block text-[9px] sm:text-[10px] font-black text-slate-400 uppercase tracking-widest mb-1 sm:mb-1.5">
                                Coming From
                            </label>
                            <input
                                type="text"
                                value={formData.coming_from}
                                onChange={(e) => setFormData(prev => ({ ...prev, coming_from: e.target.value }))}
                                placeholder="Company or address"
                                className="w-full px-3 sm:px-4 py-2.5 sm:py-3 bg-slate-50 border border-slate-200 rounded-xl text-slate-900 font-medium text-sm sm:text-base focus:border-indigo-500 focus:ring-0 transition-colors"
                            />
                        </div>

                        <div>
                            <label className="block text-[9px] sm:text-[10px] font-black text-slate-400 uppercase tracking-widest mb-1 sm:mb-1.5">
                                Purpose of Visit *
                            </label>
                            <div className="grid grid-cols-2 sm:grid-cols-3 gap-2">
                                {PURPOSES.map((p) => (
                                    <button
                                        key={p.id}
                                        type="button"
                                        onClick={() => setFormData(prev => ({ ...prev, purpose: p.id }))}
                                        aria-pressed={formData.purpose === p.id}
                                        className={`px-3 py-2.5 rounded-xl border-2 text-xs sm:text-sm font-bold transition-all ${formData.purpose === p.id
                                            ? 'border-indigo-500 bg-indigo-50 text-indigo-700'
                                            : 'border-slate-100 bg-slate-50 text-slate-600 hover:border-slate-200'
                                            }`}
                                    >
                                        {p.label}
                                    </button>
                                ))}
                            </div>
                        </div>

                        <HostAutoComplete
                            propertyId={propertyId}
                            value={formData.whom_to_meet}
                            onChange={(value) => setFormData(prev => ({ ...prev, whom_to_meet: value }))}
                            onSelectHostId={(id) => setHostId(id)}
                        />

                        {/* Camera */}
                        <div className="pt-2 sm:pt-4">
                            <label className="block text-[9px] sm:text-[10px] font-black text-slate-400 uppercase tracking-widest mb-2 sm:mb-3 text-center">
                                Capture Photo
                            </label>
                            {formData.photo_url ? (
                                <div className="flex flex-col items-center">
                                    <img
                                        src={formData.photo_url}
                                        alt="Visitor"
                                        className="w-24 h-32 sm:w-32 sm:h-40 object-cover rounded-xl border-2 border-emerald-500 mb-2"
                                    />
                                    <button
                                        type="button"
                                        onClick={() => setFormData(prev => ({ ...prev, photo_url: '' }))}
                                        className="text-[10px] sm:text-sm text-slate-500 hover:text-slate-700 font-bold uppercase tracking-tighter"
                                    >
                                        Change Photo
                                    </button>
                                </div>
                            ) : (
                                <CameraCapture onCapture={handlePhotoCapture} />
                            )}
                        </div>
                    </div>

                    <button
                        onClick={handleCheckin}
                        disabled={isSubmitting || !formData.name || !formData.whom_to_meet || !formData.purpose}
                        className="w-full py-3.5 sm:py-4 bg-primary hover:bg-primary-dark text-white rounded-2xl font-black mt-4 sm:mt-6 flex items-center justify-center gap-2 transition-all disabled:opacity-50 shadow-lg shadow-primary/20 text-sm sm:text-base"
                    >
                        {isSubmitting ? (
                            <div className="w-5 h-5 border-2 border-white/20 border-t-white rounded-full animate-spin" />
                        ) : (
                            <>
                                <Check className="w-5 h-5" /> Confirm
                            </>
                        )}
                    </button>
                </div>
            </div>
        );
    }

    // CHECK-IN SUCCESS
    if (step === 'success') {
        return (
            <div className="h-full w-full bg-emerald-600 relative flex flex-col items-center justify-center sm:p-8 overflow-hidden sm:rounded-[2.5rem] text-white">
                <div className="absolute inset-0 z-0">
                    <div className="absolute top-[-10%] right-[-10%] w-[50%] h-[50%] bg-white/20 rounded-full blur-[100px]" />
                    <div className="absolute bottom-[-10%] left-[-10%] w-[50%] h-[50%] bg-white/10 rounded-full blur-[100px]" />
                </div>
                <motion.div
                    initial={{ opacity: 0, scale: 0.9 }}
                    animate={{ opacity: 1, scale: 1 }}
                    className="text-center relative z-10 w-full h-full flex flex-col items-center justify-center p-6"
                >
                    <div className="w-24 h-24 bg-white/20 rounded-full flex items-center justify-center mx-auto mb-6">
                        <Check className="w-12 h-12" />
                    </div>
                    <h1 className="text-3xl font-black mb-2">Welcome, {formData.name}!</h1>
                    <p className="text-emerald-100 text-lg mb-8">Your visit has been logged.</p>

                    <div className="bg-white/10 rounded-2xl p-6 mb-8">
                        <p className="text-sm text-emerald-100 mb-1">Your Visitor ID</p>
                        <p className="text-4xl font-black tracking-wider">{visitorId}</p>
                    </div>

                    <p className="text-emerald-100 text-sm mb-4">
                        Please remember this ID for check-out.
                    </p>

                    <button
                        onClick={resetKiosk}
                        className="px-8 py-3 bg-white text-emerald-600 rounded-xl font-black hover:bg-emerald-50 transition-all"
                    >
                        Done
                    </button>
                </motion.div>
            </div>
        );
    }

    // CHECKOUT SCREEN
    if (step === 'checkout') {
        return (
            <div className="h-full w-full bg-[#ebf5f4] relative flex flex-col items-center justify-center sm:p-8 overflow-hidden sm:rounded-[2.5rem]">
                <div className="absolute inset-0 z-0">
                    <div className="absolute bottom-[-10%] right-[-10%] w-[40%] h-[40%] bg-rose-500/10 rounded-full blur-[100px]" />
                </div>
                <div className="bg-white sm:rounded-[2rem] shadow-2xl p-6 sm:p-10 w-full h-full sm:h-auto sm:max-w-md relative z-10 flex flex-col justify-center">
                    <button
                        onClick={() => setStep('home')}
                        className="flex items-center gap-2 text-slate-700 hover:text-slate-900 mb-4 sm:mb-6 text-sm sm:text-base font-medium transition-colors"
                    >
                        <ArrowLeft className="w-5 h-5" /> Back
                    </button>

                    <h2 className="text-xl sm:text-2xl font-black text-slate-900 mb-4 sm:mb-6 text-center leading-tight">Visitor Check-Out</h2>

                    {error && (
                        <div className="bg-rose-50 border border-rose-200 text-rose-600 p-3 rounded-xl mb-4 text-xs sm:text-sm">
                            {error}
                        </div>
                    )}

                    <div className="mb-4 sm:mb-6">
                        <label className="block text-[10px] font-black text-slate-400 uppercase tracking-widest mb-2">
                            Enter Visitor ID
                        </label>
                        <input
                            type="text"
                            value={checkoutId}
                            onChange={(e) => setCheckoutId(e.target.value.toUpperCase())}
                            placeholder="e.g., PROP-00123"
                            className="w-full px-4 py-3 sm:py-4 bg-slate-50 border-2 border-slate-200 rounded-xl text-slate-900 font-bold text-base sm:text-lg text-center tracking-wider focus:border-rose-500 focus:ring-0 transition-colors"
                        />
                    </div>

                    <button
                        onClick={handleCheckout}
                        disabled={isSubmitting || !checkoutId}
                        className="w-full py-3.5 sm:py-4 bg-rose-500 hover:bg-rose-600 text-white rounded-2xl font-black flex items-center justify-center gap-2 transition-all disabled:opacity-50 text-sm sm:text-base shadow-lg shadow-rose-500/20"
                    >
                        {isSubmitting ? (
                            <div className="w-5 h-5 border-2 border-white/20 border-t-white rounded-full animate-spin" />
                        ) : (
                            <>
                                <LogOut className="w-4 h-4 sm:w-5 sm:h-5" /> OUT
                            </>
                        )}
                    </button>
                </div>
            </div>
        );
    }

    // CHECKOUT SUCCESS
    if (step === 'checkout_success') {
        return (
            <div className="h-full w-full bg-rose-500 relative flex flex-col items-center justify-center sm:p-8 overflow-hidden sm:rounded-[2.5rem] text-white">
                <div className="absolute inset-0 z-0">
                    <div className="absolute top-[-10%] right-[-10%] w-[50%] h-[50%] bg-white/20 rounded-full blur-[100px]" />
                    <div className="absolute bottom-[-10%] left-[-10%] w-[50%] h-[50%] bg-white/10 rounded-full blur-[100px]" />
                </div>
                <motion.div
                    initial={{ opacity: 0, scale: 0.9 }}
                    animate={{ opacity: 1, scale: 1 }}
                    className="text-center relative z-10 w-full h-full flex flex-col items-center justify-center p-6"
                >
                    <div className="w-24 h-24 bg-white/20 rounded-full flex items-center justify-center mx-auto mb-6">
                        <LogOut className="w-12 h-12" />
                    </div>
                    <h1 className="text-3xl font-black mb-2">Goodbye, {checkoutName}!</h1>
                    <p className="text-rose-100 text-lg mb-8">Your visit has been completed.</p>

                    <button
                        onClick={resetKiosk}
                        className="px-8 py-3 bg-white text-rose-600 rounded-xl font-black hover:bg-rose-50 transition-all"
                    >
                        Done
                    </button>
                </motion.div>
            </div>
        );
    }

    return null;
};

export default VMSFaceCheckIn;
