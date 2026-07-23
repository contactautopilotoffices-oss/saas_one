'use client';

import React, { useState, useEffect } from 'react';
import { useParams } from 'next/navigation';
import { createClient } from '@/frontend/utils/supabase/client';
import { Card, CardHeader, CardTitle, CardContent } from '@/frontend/components/ui/card';
import { Button } from '@/frontend/components/ui/button';
import { Input } from '@/frontend/components/ui/input';
import { Plus, Download, Loader2, QrCode } from 'lucide-react';
import { QRCodeSVG } from 'qrcode.react';

export default function FacilityQRDashboard({ propertyId }: { propertyId: string }) {
    const supabase = createClient();
    
    const [zones, setZones] = useState<any[]>([]);
    const [loading, setLoading] = useState(true);
    const [isCreating, setIsCreating] = useState(false);
    
    const [newFloor, setNewFloor] = useState('');
    const [newZone, setNewZone] = useState('');

    useEffect(() => {
        fetchZones();
    }, [propertyId]);

    const fetchZones = async () => {
        setLoading(true);
        const { data, error } = await supabase
            .from('qr_facility_zones')
            .select('*')
            .eq('property_id', propertyId)
            .order('created_at', { ascending: false });
            
        if (!error && data) {
            setZones(data);
        } else {
            console.error('Error fetching zones', error);
        }
        setLoading(false);
    };

    const handleCreateZone = async (e: React.FormEvent) => {
        e.preventDefault();
        if (!newZone || !propertyId) return;

        setIsCreating(true);
        
        // Generate a secure signature
        const signature = crypto.randomUUID().replace(/-/g, '') + crypto.randomUUID().replace(/-/g, '');

        const { error } = await supabase
            .from('qr_facility_zones')
            .insert({
                property_id: propertyId,
                floor: newFloor,
                zone_name: newZone,
                qr_signature: signature
            });

        if (!error) {
            setNewFloor('');
            setNewZone('');
            fetchZones();
        } else {
            console.error('Error creating zone', error);
            alert('Failed to create zone. Are you an admin?');
        }
        setIsCreating(false);
    };

    const downloadQR = (zoneId: string, zoneName: string) => {
        const svg = document.getElementById(`qr-${zoneId}`);
        if (!svg) return;
        
        const svgData = new XMLSerializer().serializeToString(svg);
        const canvas = document.createElement("canvas");
        const ctx = canvas.getContext("2d");
        const img = new Image();
        
        img.onload = () => {
            canvas.width = img.width;
            canvas.height = img.height;
            ctx?.drawImage(img, 0, 0);
            const pngFile = canvas.toDataURL("image/png");
            
            const downloadLink = document.createElement("a");
            downloadLink.download = `QR_${zoneName.replace(/\s+/g, '_')}.png`;
            downloadLink.href = `${pngFile}`;
            downloadLink.click();
        };
        
        img.src = "data:image/svg+xml;base64," + btoa(svgData);
    };

    const getAppUrl = () => {
        if (typeof window !== 'undefined') {
            return window.location.origin;
        }
        return 'https://app.saasone.com';
    };

    return (
        <div className="p-4 sm:p-6 space-y-6 max-w-6xl mx-auto w-full">
            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
                <div>
                    <h1 className="text-2xl sm:text-3xl font-bold tracking-tight text-gray-900">Facility QR Codes</h1>
                    <p className="text-sm sm:text-base text-gray-500 mt-1">Generate QR codes for guests to report issues without an app.</p>
                </div>
            </div>

            <Card>
                <CardHeader>
                    <CardTitle>Create New QR Zone</CardTitle>
                </CardHeader>
                <CardContent>
                    <form onSubmit={handleCreateZone} className="flex flex-col sm:flex-row gap-4 sm:items-end w-full">
                        <div className="space-y-2 flex-1 w-full">
                            <label className="text-sm font-medium">Floor (Optional)</label>
                            <Input 
                                placeholder="e.g. 1st Floor" 
                                value={newFloor} 
                                onChange={e => setNewFloor(e.target.value)} 
                            />
                        </div>
                        <div className="space-y-2 flex-1 w-full">
                            <label className="text-sm font-medium">Zone Name *</label>
                            <Input 
                                placeholder="e.g. Lobby Restroom" 
                                required 
                                value={newZone} 
                                onChange={e => setNewZone(e.target.value)} 
                            />
                        </div>
                        <Button type="submit" className="w-full sm:w-auto" disabled={isCreating || !newZone}>
                            {isCreating ? <Loader2 className="w-4 h-4 animate-spin mr-2" /> : <Plus className="w-4 h-4 mr-2" />}
                            Generate QR
                        </Button>
                    </form>
                </CardContent>
            </Card>

            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
                {loading ? (
                    <div className="col-span-full flex justify-center py-10">
                        <Loader2 className="w-8 h-8 animate-spin text-gray-400" />
                    </div>
                ) : zones.map((zone) => {
                    const qrUrl = `${getAppUrl()}/q/request?zoneId=${zone.id}&sig=${zone.qr_signature}`;
                    return (
                        <Card key={zone.id} className="overflow-hidden flex flex-col">
                            <div className="bg-gray-100 p-6 flex justify-center items-center border-b">
                                <div className="bg-white p-2 rounded-lg shadow-sm">
                                    <QRCodeSVG 
                                        id={`qr-${zone.id}`}
                                        value={qrUrl} 
                                        size={180}
                                        level="H"
                                        includeMargin={true}
                                    />
                                </div>
                            </div>
                            <CardContent className="p-4 flex-1">
                                <h3 className="font-semibold text-lg">{zone.zone_name}</h3>
                                {zone.floor && <p className="text-sm text-gray-500">Floor: {zone.floor}</p>}
                                <div className="mt-4 pt-4 border-t flex justify-between items-center">
                                    <span className="text-xs text-gray-400 font-mono" title="Signature">
                                        sig: {zone.qr_signature.substring(0,8)}...
                                    </span>
                                    <Button 
                                        variant="outline" 
                                        size="sm" 
                                        onClick={() => downloadQR(zone.id, zone.zone_name)}
                                    >
                                        <Download className="w-4 h-4 mr-2" />
                                        Save PNG
                                    </Button>
                                </div>
                            </CardContent>
                        </Card>
                    );
                })}
                
                {!loading && zones.length === 0 && (
                    <div className="col-span-full text-center py-16 bg-gray-50 rounded-lg border-2 border-dashed">
                        <QrCode className="w-12 h-12 text-gray-300 mx-auto mb-3" />
                        <h3 className="text-lg font-medium text-gray-900">No QR zones yet</h3>
                        <p className="text-gray-500">Create your first facility QR zone above.</p>
                    </div>
                )}
            </div>
        </div>
    );
}
