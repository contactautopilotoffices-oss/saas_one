import type { Metadata } from 'next';
import VendorInvoiceUpload from '@/frontend/components/invoices/VendorInvoiceUpload';

// The link token is the credential: keep it out of referrers, search indexes and caches.
export const metadata: Metadata = {
    title: 'Upload invoice',
    robots: { index: false, follow: false },
    referrer: 'no-referrer',
};

export default async function VendorInvoicePage({ params }: { params: Promise<{ token: string }> }) {
    const { token } = await params;
    return <VendorInvoiceUpload token={token} />;
}
