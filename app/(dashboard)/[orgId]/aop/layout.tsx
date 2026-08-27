import AccountsWorkspace from '@/frontend/components/layout/AccountsWorkspace';

// The AOP tracker is finance data and lives under the Accounts chrome, same as the
// Payment Tracker and Petty Cash. The parent (dashboard) layout skips the shared FMS
// sidebar for this route so this supplies the whole shell.
export default function AopWorkspaceLayout({ children }: { children: React.ReactNode }) {
    return <AccountsWorkspace>{children}</AccountsWorkspace>;
}
