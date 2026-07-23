'use client';

import React, { useState } from 'react';
import { useRouter, useParams } from 'next/navigation';
import { CalendarView } from '@/frontend/components/crm';
import { CRMEvent } from '@/frontend/types/crm';
import { CrmTour, calendarSteps } from '@/frontend/components/crm/onboarding';

export default function CalendarPage() {
    const [selectedEvent, setSelectedEvent] = useState<CRMEvent | null>(null);
    const router = useRouter();
    const params = useParams();
    const orgId = params.orgId as string;

    const handleEventClick = (event: CRMEvent) => {
        setSelectedEvent(event);
    };

    return (
        <>
            <CalendarView onEventClick={handleEventClick} />
            <CrmTour
                tourId="crm-calendar"
                steps={calendarSteps}
                onComplete={() => router.push(`/${orgId}/crm`)}
            />
        </>
    );
}
