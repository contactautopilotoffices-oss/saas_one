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

/** Font stacks by family name; next/font is not used here (see the build fix on main). */
const FONT_VARS = {
    '--font-lab-inter': '"Inter", system-ui, sans-serif',
    '--font-lab-geist': '"Geist", system-ui, sans-serif',
    '--font-lab-manrope': '"Manrope", system-ui, sans-serif',
    '--font-lab-jakarta': '"Plus Jakarta Sans", system-ui, sans-serif',
    '--font-lab-playfair': '"Playfair Display", Georgia, "Times New Roman", serif',
    '--font-lab-sora': '"Sora", system-ui, sans-serif',
} as React.CSSProperties;

export default function DesignLabLayout({ children }: { children: React.ReactNode }) {
    return <div style={FONT_VARS}>{children}</div>;
}
