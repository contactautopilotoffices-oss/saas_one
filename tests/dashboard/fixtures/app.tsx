import React, { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import DashboardLayout from '../../../app/(dashboard)/layout';
import AccountsWorkspace from '../../../frontend/components/layout/AccountsWorkspace';
import { usePathname } from './navigation';
function Fixture() {
    const pathname = usePathname();
    return <DashboardLayout>{pathname.includes('/accounts') ? <AccountsWorkspace><h1 className="text-2xl font-bold mb-4">Payment Tracker — local fixture</h1><table className="w-full"><thead><tr><th>Purchase order</th><th>Vendor</th><th>Amount</th></tr></thead><tbody>{Array.from({length:50},(_,index)=><tr key={index} className="h-20 border-b border-border"><td>PO-{String(index+1).padStart(4,'0')}</td><td>Fixture supplier</td><td>₹150</td></tr>)}</tbody></table></AccountsWorkspace> : pathname.includes('/petty-cash') ? <h1 data-testid="petty-body">Petty Cash fixture body</h1> : <div data-testid="unused-page">Must not mount a second dashboard</div>}</DashboardLayout>;
}
createRoot(document.getElementById('root')!).render(<StrictMode><Fixture /></StrictMode>);
