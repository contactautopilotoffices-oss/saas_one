const fs = require('fs');
const path = require('path');

function patchSoftService() {
    const filePath = path.join(__dirname, '..', 'frontend', 'components', 'dashboard', 'SoftServiceManagerDashboard.tsx');
    let content = fs.readFileSync(filePath, 'utf8');

    // 1. Tab sync
    content = content.replace(
        "['stock', 'scanner', 'checklist', 'guest_experience', 'settings', 'profile'].includes(tab)",
        "['stock', 'scanner', 'checklist', 'guest_experience', 'settings', 'profile', 'grievance'].includes(tab)"
    );

    // 2. Add My Grievances button
    const settingsButton = "                            <button\r\n                                onClick={() => handleTabChange('settings')}";
    const grievanceButton = `                            <button
                                onClick={() => handleTabChange('grievance')}
                                className={\`w-full flex items-center gap-2.5 px-3 py-2.5 rounded-xl transition-all duration-200 font-bold text-sm \${activeTab === 'grievance'
                                    ? 'bg-primary text-text-inverse shadow-sm'
                                    : 'text-text-secondary hover:bg-muted hover:text-text-primary'
                                    }\`}
                            >
                                <ShieldCheck className="w-4 h-4" />
                                <span className="flex-1 text-left">My Grievances</span>
                            </button>\r\n${settingsButton}`;

    if (content.includes(settingsButton)) {
        content = content.replace(settingsButton, grievanceButton);
        fs.writeFileSync(filePath, content, 'utf8');
        console.log('SoftServiceManagerDashboard patched successfully.');
    } else {
        // Fallback for LF
        const settingsButtonLF = "                            <button\n                                onClick={() => handleTabChange('settings')}";
        const grievanceButtonLF = `                            <button
                                onClick={() => handleTabChange('grievance')}
                                className={\`w-full flex items-center gap-2.5 px-3 py-2.5 rounded-xl transition-all duration-200 font-bold text-sm \${activeTab === 'grievance'
                                    ? 'bg-primary text-text-inverse shadow-sm'
                                    : 'text-text-secondary hover:bg-muted hover:text-text-primary'
                                    }\`}
                            >
                                <ShieldCheck className="w-4 h-4" />
                                <span className="flex-1 text-left">My Grievances</span>
                            </button>\n${settingsButtonLF}`;
        if (content.includes(settingsButtonLF)) {
            content = content.replace(settingsButtonLF, grievanceButtonLF);
            fs.writeFileSync(filePath, content, 'utf8');
            console.log('SoftServiceManagerDashboard patched successfully (LF).');
        } else {
            console.error('Settings button not found in SoftServiceManagerDashboard');
        }
    }
}

function patchProcurement() {
    const filePath = path.join(__dirname, '..', 'frontend', 'components', 'dashboard', 'ProcurementDashboard.tsx');
    let content = fs.readFileSync(filePath, 'utf8');

    // 1. Add imports if needed
    if (!content.includes("import HRTicketsContent from '@/frontend/components/hr/HRTicketsContent';")) {
        content = content.replace(
            "import NotificationBell from './NotificationBell';",
            "import NotificationBell from './NotificationBell';\r\nimport HRTicketsContent from '@/frontend/components/hr/HRTicketsContent';\r\nimport { ShieldCheck, Plus } from 'lucide-react';"
        );
    }

    // 2. Tab type definition
    content = content.replace(
        "type Tab = 'overview' | 'urgency-tracker' | 'task-sheet' | 'requests' | 'vendor_tickets' | 'monthly-requisitions' | 'monthly-feedback' | 'site-pricing' | 'history' | 'manage-items' | 'po-generator' | 'settings' | 'profile';",
        "type Tab = 'overview' | 'urgency-tracker' | 'task-sheet' | 'requests' | 'vendor_tickets' | 'monthly-requisitions' | 'monthly-feedback' | 'site-pricing' | 'history' | 'manage-items' | 'po-generator' | 'settings' | 'profile' | 'grievance';"
    );

    // 3. linkableTabs
    content = content.replace(
        "const linkableTabs = ['overview', 'urgency-tracker', 'task-sheet', 'requests', 'vendor_tickets', 'monthly-requisitions', 'monthly-feedback', 'history', 'manage-items', 'po-generator', 'settings', 'profile'];",
        "const linkableTabs = ['overview', 'urgency-tracker', 'task-sheet', 'requests', 'vendor_tickets', 'monthly-requisitions', 'monthly-feedback', 'history', 'manage-items', 'po-generator', 'settings', 'profile', 'grievance'];"
    );

    // 4. Add userOrgId state & resolve
    if (!content.includes('userOrgId')) {
        content = content.replace(
            "const [activeTab, setActiveTab] = useState<Tab>('overview');",
            "const [activeTab, setActiveTab] = useState<Tab>('overview');\r\n    const [userOrgId, setUserOrgId] = useState<string>('');"
        );

        content = content.replace(
            "setUser(user);",
            `setUser(user);
            if (user?.user_metadata?.organization_id) {
                setUserOrgId(user.user_metadata.organization_id);
            } else if (user?.id) {
                supabase.from('organization_memberships').select('organization_id').eq('user_id', user.id).limit(1).maybeSingle().then(({ data }) => {
                    if (data?.organization_id) setUserOrgId(data.organization_id);
                });
            }`
        );
    }

    // 5. Add grievance to System & Personal sidebar items
    content = content.replace(
        "{ id: 'settings', icon: Settings, label: 'Settings' },",
        "{ id: 'grievance', icon: ShieldCheck, label: 'My Grievances' },\r\n                                    { id: 'settings', icon: Settings, label: 'Settings' },"
    );

    // 6. Add Raise Grievance button in top header next to NotificationBell
    const notifBellTarget = "<NotificationBell />";
    const notifBellReplacement = `<button
                                onClick={() => {
                                    setActiveTab('grievance');
                                    const url = new URL(window.location.href);
                                    url.searchParams.set('tab', 'grievance');
                                    url.searchParams.set('action', 'create');
                                    window.history.pushState({}, '', url.toString());
                                }}
                                className="flex items-center gap-1.5 px-3 py-2 bg-[#587e85] hover:bg-[#48686e] text-white rounded-xl text-xs font-bold transition-all shadow-xs active:scale-95 shrink-0"
                                title="Raise HR Request / Grievance"
                            >
                                <Plus className="w-4 h-4" />
                                <span className="hidden sm:inline">Raise Grievance</span>
                            </button>
                            <NotificationBell />`;

    if (content.includes(notifBellTarget) && !content.includes('Raise Grievance')) {
        content = content.replace(notifBellTarget, notifBellReplacement);
    }

    // 7. Add grievance tab renderer in main
    const tabTarget = "{activeTab === 'profile' && (";
    const tabReplacement = `{activeTab === 'grievance' && (
                            <div className="py-2">
                                <HRTicketsContent orgId={user?.user_metadata?.organization_id || userOrgId || ''} />
                            </div>
                        )}
                        {activeTab === 'profile' && (`;

    if (content.includes(tabTarget) && !content.includes("{activeTab === 'grievance' && (")) {
        content = content.replace(tabTarget, tabReplacement);
    }

    fs.writeFileSync(filePath, content, 'utf8');
    console.log('ProcurementDashboard patched successfully.');
}

patchSoftService();
patchProcurement();
