import AccountsWorkspace from '@/frontend/components/layout/AccountsWorkspace';

export default function AccountsWorkspaceLayout({ children }: { children: React.ReactNode }) {
    return <AccountsWorkspace>{children}</AccountsWorkspace>;
}
