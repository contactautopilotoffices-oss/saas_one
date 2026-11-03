import { redirect } from 'next/navigation';

// Invoice Control lives as a tab of the Payment Tracker; this path only forwards old links.
export default async function AccountsInvoicesPage({ params, searchParams }: { params: Promise<{ orgId: string }>; searchParams: Promise<Record<string, string | string[] | undefined>> }) {
    const { orgId } = await params;
    const sp = await searchParams;
    const invoice = typeof sp.invoice === 'string' ? `&invoice=${encodeURIComponent(sp.invoice)}` : '';
    redirect(`/${orgId}/accounts?tab=invoices${invoice}`);
}
