import AccountsWorkspace from '@/frontend/components/layout/AccountsWorkspace';

export default function PettyCashWorkspaceLayout({ children }: { children: React.ReactNode }) {
    return <AccountsWorkspace>{children}</AccountsWorkspace>;
}
