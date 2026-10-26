import type { Metadata } from 'next';

/**
 * Design Lab: a side-by-side preview of six candidate UI directions for the FMS web app.
 * Presentation only. Every font a design needs is loaded here so switching designs never
 * waits on a font request.
 */

export const metadata: Metadata = {
    title: 'Design Lab | Autopilot',
    description: 'Compare six UI design directions for the facility management web app.',
};

export default function DesignLabLayout({ children }: { children: React.ReactNode }) {
    return (
        <div
            style={{
                ['--font-lab-inter' as any]: '"Inter", system-ui, sans-serif',
                ['--font-lab-geist' as any]: '"Geist", system-ui, sans-serif',
                ['--font-lab-manrope' as any]: '"Manrope", system-ui, sans-serif',
                ['--font-lab-jakarta' as any]: '"Plus Jakarta Sans", system-ui, sans-serif',
            }}
        >
            {children}
        </div>
    );
}
