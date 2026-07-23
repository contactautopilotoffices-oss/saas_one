'use client';

import React, { useState } from 'react';
import FacilityQRDashboard from '@/frontend/components/facility-qr/FacilityQRDashboard';
import GuestRequestsPage from '@/app/(dashboard)/[orgId]/properties/[propertyId]/guest-requests/page';
import { Smartphone, QrCode } from 'lucide-react';
import { createClient } from '@/frontend/utils/supabase/client';

export default function GuestExperienceDashboard({ propertyId }: { propertyId: string }) {
    const [activeTab, setActiveTab] = useState<'requests' | 'qr_codes'>('requests');
    const [userRole, setUserRole] = useState<string>('');

    React.useEffect(() => {
        const fetchRole = async () => {
            const supabase = createClient();
            const { data: { user } } = await supabase.auth.getUser();
            if (user) {
                const { data } = await supabase.from('users').select('system_role').eq('id', user.id).single();
                if (data) setUserRole(data.system_role);
            }
        };
        fetchRole();
    }, []);

    const isStaffOrMst = userRole === 'STAFF_SOFTSERVICES' || userRole === 'MST';

    return (
        <div className="flex flex-col h-full bg-slate-50 relative">
            {/* Top Navigation Tabs */}
            <div className="border-b border-slate-200 bg-white px-4 sm:px-6 pt-4 flex gap-4 sm:gap-8 shadow-sm z-10 sticky top-0 overflow-x-auto no-scrollbar whitespace-nowrap">
                <button 
                    onClick={() => setActiveTab('requests')}
                    className={`flex items-center gap-2 pb-3 border-b-2 font-bold transition-all duration-200 ${
                        activeTab === 'requests' 
                        ? 'border-primary text-primary' 
                        : 'border-transparent text-slate-500 hover:text-slate-800'
                    }`}
                >
                    <Smartphone className="w-4 h-4" />
                    Client Support
                </button>
                {!isStaffOrMst && (
                    <button 
                        onClick={() => setActiveTab('qr_codes')}
                        className={`flex items-center gap-2 pb-3 border-b-2 font-bold transition-all duration-200 ${
                            activeTab === 'qr_codes' 
                            ? 'border-primary text-primary' 
                            : 'border-transparent text-slate-500 hover:text-slate-800'
                        }`}
                    >
                        <QrCode className="w-4 h-4" />
                        Facility QR Codes
                    </button>
                )}
            </div>
            
            <div className="flex-1 overflow-y-auto">
                {activeTab === 'requests' && <GuestRequestsPage propertyId={propertyId} />}
                {activeTab === 'qr_codes' && (
                    <div className="py-6">
                        <FacilityQRDashboard propertyId={propertyId} />
                    </div>
                )}
            </div>
        </div>
    );
}
