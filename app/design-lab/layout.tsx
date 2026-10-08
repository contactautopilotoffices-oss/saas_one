import type { Metadata } from 'next';
import { Inter, Geist, Manrope, Plus_Jakarta_Sans } from 'next/font/google';

/**
 * Design Lab: a side-by-side preview of six candidate UI directions for the FMS web app.
 * Presentation only. Every font a design needs is loaded here so switching designs never
 * waits on a font request.
 */

const inter = Inter({ subsets: ['latin'], weight: ['400', '500', '600', '700'], variable: '--font-lab-inter', display: 'swap' });
const geist = Geist({ subsets: ['latin'], weight: ['400', '500', '600', '700'], variable: '--font-lab-geist', display: 'swap' });
const manrope = Manrope({ subsets: ['latin'], weight: ['500', '600', '700', '800'], variable: '--font-lab-manrope', display: 'swap' });
const jakarta = Plus_Jakarta_Sans({ subsets: ['latin'], weight: ['400', '500', '600', '700', '800'], variable: '--font-lab-jakarta', display: 'swap' });

export const metadata: Metadata = {
    title: 'Design Lab | Autopilot',
    description: 'Compare six UI design directions for the facility management web app.',
};

export default function DesignLabLayout({ children }: { children: React.ReactNode }) {
    return (
        <div className={`${inter.variable} ${geist.variable} ${manrope.variable} ${jakarta.variable}`}>
            {children}
        </div>
    );
}
