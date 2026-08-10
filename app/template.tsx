'use client';

import PageTransition from '@/frontend/components/ui/PageTransition';
import NumberInputWheelGuard from '@/frontend/components/ui/NumberInputWheelGuard';

export default function Template({ children }: { children: React.ReactNode }) {
    return (
        <>
            <NumberInputWheelGuard />
            <PageTransition>{children}</PageTransition>
        </>
    );
}
