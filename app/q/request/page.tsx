'use client';

import React, { useState, useEffect, useRef } from 'react';
import { useSearchParams } from 'next/navigation';
import { Camera, MapPin, UploadCloud, CheckCircle2, AlertCircle, Loader2, X } from 'lucide-react';
import { Card, CardHeader, CardTitle, CardContent, CardFooter } from '@/frontend/components/ui/card';
import { Button } from '@/frontend/components/ui/button';
import { Input } from '@/frontend/components/ui/input';
import imageCompression from 'browser-image-compression';
import { Suspense } from 'react';

function GuestRequestContent() {
    const searchParams = useSearchParams();
    const zoneId = searchParams.get('zoneId');
    const sig = searchParams.get('sig');

    const [guestName, setGuestName] = useState('');
    const [guestPhone, setGuestPhone] = useState('');
    const [guestEmail, setGuestEmail] = useState('');
    const [description, setDescription] = useState('');
    const [photos, setPhotos] = useState<File[]>([]);
    
    const [deviceInfo, setDeviceInfo] = useState<any>({});
    const [locationData, setLocationData] = useState<any>({});
    
    const [status, setStatus] = useState<'idle' | 'loading' | 'success' | 'error'>('idle');
    const [errorMessage, setErrorMessage] = useState('');
    const fileInputRef = useRef<HTMLInputElement>(null);

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

    const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
        if (e.target.files) {
            const selectedFiles = Array.from(e.target.files);
            setPhotos((prev) => [...prev, ...selectedFiles].slice(0, 3)); // Max 3 photos
        }
    };

    const removePhoto = (index: number) => {
        setPhotos(photos.filter((_, i) => i !== index));
    };

    const uploadPhoto = async (file: File): Promise<string> => {
        // Compress the image
        const options = {
            maxSizeMB: 1, // Target max size
            maxWidthOrHeight: 1920, // Max dimension
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

    const handleSubmit = async (e: React.FormEvent) => {
        e.preventDefault();
        
        if (!zoneId || !sig) {
            setErrorMessage('Invalid QR Code. Missing parameters.');
            setStatus('error');
            return;
        }

        setStatus('loading');
        setErrorMessage('');
        requestLocation(); // Try to get location right before submit if not already got

        try {
            // Upload photos first
            const uploadedPhotoPaths = await Promise.all(photos.map(uploadPhoto));

            // Submit the full request
            const res = await fetch('/api/public/submit-guest-request', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    zoneId,
                    sig,
                    guestName,
                    guestPhone,
                    guestEmail,
                    description,
                    photoUrls: uploadedPhotoPaths,
                    deviceInfo,
                    locationData
                })
            });

            if (!res.ok) {
                const errData = await res.json();
                throw new Error(errData.error || 'Failed to submit request');
            }

            setStatus('success');
        } catch (error: any) {
            setStatus('error');
            setErrorMessage(error.message || 'An unexpected error occurred.');
        }
    };

    if (status === 'success') {
        return (
            <div className="min-h-screen bg-gray-50 flex items-center justify-center p-4">
                <Card className="w-full max-w-md text-center py-8">
                    <CardContent className="space-y-4 flex flex-col items-center">
                        <CheckCircle2 className="w-16 h-16 text-green-500" />
                        <h2 className="text-2xl font-bold text-gray-900">Request Submitted</h2>
                        <p className="text-gray-500">
                            Thank you. Our facility management team has received your request and will address it shortly.
                        </p>
                    </CardContent>
                </Card>
            </div>
        );
    }

    return (
        <div className="min-h-screen bg-gray-50 flex items-center justify-center p-4">
            <Card className="w-full max-w-md shadow-lg border-t-4 border-t-blue-600">
                <CardHeader>
                    <CardTitle className="text-xl font-semibold flex items-center gap-2">
                        Facility Request
                    </CardTitle>
                    <p className="text-sm text-gray-500">
                        Please describe the issue you are facing here. No registration required.
                    </p>
                </CardHeader>
                <form onSubmit={handleSubmit}>
                    <CardContent className="space-y-4">
                        {status === 'error' && (
                            <div className="bg-red-50 text-red-600 p-3 rounded-md flex gap-2 items-start text-sm">
                                <AlertCircle className="w-5 h-5 shrink-0" />
                                <span>{errorMessage}</span>
                            </div>
                        )}

                        <div className="space-y-2">
                            <label className="text-sm font-medium">Your Name *</label>
                            <Input 
                                required 
                                placeholder="John Doe" 
                                value={guestName} 
                                onChange={(e) => setGuestName(e.target.value)} 
                                disabled={status === 'loading'}
                            />
                        </div>

                        <div className="grid grid-cols-2 gap-4">
                            <div className="space-y-2">
                                <label className="text-sm font-medium">Phone</label>
                                <Input 
                                    type="tel" 
                                    placeholder="+1 234 567 8900" 
                                    value={guestPhone} 
                                    onChange={(e) => setGuestPhone(e.target.value)}
                                    disabled={status === 'loading'}
                                />
                            </div>
                            <div className="space-y-2">
                                <label className="text-sm font-medium">Email</label>
                                <Input 
                                    type="email" 
                                    placeholder="john@example.com" 
                                    value={guestEmail} 
                                    onChange={(e) => setGuestEmail(e.target.value)}
                                    disabled={status === 'loading'}
                                />
                            </div>
                        </div>

                        <div className="space-y-2">
                            <label className="text-sm font-medium flex justify-between items-center">
                                Description *
                                <span className="text-xs text-gray-400">Max 1000 chars</span>
                            </label>
                            <textarea 
                                required 
                                maxLength={1000}
                                placeholder="Describe the issue in detail (e.g., A/C is not cooling, water leak in restroom...)" 
                                className="flex w-full rounded-[var(--radius-md)] border border-border bg-surface px-3 py-2 text-sm font-body text-text-primary transition-smooth placeholder:text-text-tertiary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary focus-visible:border-primary disabled:cursor-not-allowed disabled:opacity-50 hover:border-primary/50 min-h-[120px]"
                                value={description}
                                onChange={(e) => setDescription(e.target.value)}
                                disabled={status === 'loading'}
                            />
                        </div>

                        <div className="space-y-2">
                            <label className="text-sm font-medium">Photos (Optional, max 3)</label>
                            <div 
                                className={`border-2 border-dashed border-gray-300 rounded-lg transition-colors ${photos.length === 0 ? 'p-6 hover:bg-gray-50 cursor-pointer flex flex-col items-center justify-center' : 'p-2'}`}
                                onClick={() => {
                                    if (photos.length === 0) fileInputRef.current?.click();
                                }}
                            >
                                {photos.length === 0 ? (
                                    <>
                                        <Camera className="w-8 h-8 text-gray-400 mb-2" />
                                        <span className="text-sm text-gray-500">Tap to take or upload a photo</span>
                                    </>
                                ) : (
                                    <div className="grid grid-cols-3 gap-2">
                                        {photos.map((file, idx) => (
                                            <div key={idx} className="relative group aspect-square rounded-md overflow-hidden bg-gray-100 border">
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
                                                    className="absolute top-1 right-1 bg-red-500 text-white rounded-full p-1 opacity-80 hover:opacity-100 shadow-sm"
                                                >
                                                    <X className="w-3 h-3" />
                                                </button>
                                            </div>
                                        ))}
                                        {photos.length < 3 && (
                                            <div 
                                                className="aspect-square flex flex-col items-center justify-center border-2 border-dashed border-gray-200 rounded-md bg-white hover:bg-gray-50 cursor-pointer"
                                                onClick={(e) => {
                                                    e.stopPropagation();
                                                    fileInputRef.current?.click();
                                                }}
                                            >
                                                <Camera className="w-6 h-6 text-gray-400" />
                                                <span className="text-[10px] text-gray-500 mt-1">Add More</span>
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
                                    disabled={photos.length >= 3 || status === 'loading'}
                                />
                            </div>
                        </div>
                    </CardContent>
                    
                    <CardFooter className="flex-col gap-3">
                        <Button 
                            className="w-full" 
                            type="submit" 
                            disabled={status === 'loading' || !zoneId || !sig}
                        >
                            {status === 'loading' ? (
                                <><Loader2 className="w-4 h-4 mr-2 animate-spin" /> Submitting...</>
                            ) : (
                                <><UploadCloud className="w-4 h-4 mr-2" /> Submit Request</>
                            )}
                        </Button>
                        <p className="text-xs text-gray-400 text-center flex items-center justify-center gap-1">
                            <MapPin className="w-3 h-3" /> By submitting, you allow capturing device context to prevent spam.
                        </p>
                    </CardFooter>
                </form>
            </Card>
        </div>
    );
}

export default function GuestRequestPage() {
    return (
        <Suspense fallback={<div className="p-8 text-center"><Loader2 className="w-8 h-8 animate-spin mx-auto text-primary" /></div>}>
            <GuestRequestContent />
        </Suspense>
    );
}
