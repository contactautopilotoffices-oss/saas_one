const fs = require('fs');
const path = require('path');

const dir = 'd:\\Projects\\saas_one\\frontend\\components\\dashboard';
const files = fs.readdirSync(dir).filter(f => f.endsWith('Dashboard.tsx'));
const skip = ['PropertyAdminDashboard.tsx', 'MstDashboard.tsx', 'OrgAdminDashboard.tsx', 'SecurityDashboard.tsx', 'SoftServiceManagerDashboard.tsx', 'StaffDashboard.tsx'];

files.forEach(file => {
    if (skip.includes(file)) return;

    let content = fs.readFileSync(path.join(dir, file), 'utf8');
    if (!content.includes('SignOutModal')) return;

    console.log(`Processing ${file}`);

    if (!content.includes('Feedback / Bug')) {
        const settingsRegex = /<button[^>]*>[\s\S]*?<Settings[\s\S]*?<\/button>/;
        const match = content.match(settingsRegex);
        
        if (match) {
            let baseClass = 'w-full flex items-center gap-3 px-4 py-2.5 rounded-xl transition-all duration-200 font-bold text-sm text-text-secondary hover:bg-primary/10 hover:text-primary group';
            const btnClassMatch = match[0].match(/className=\{`([^`]+)`\}/) || match[0].match(/className="([^"]+)"/);
            
            if (btnClassMatch) {
                baseClass = btnClassMatch[1].replace(/\$\{.*?\}/g, 'text-slate-400 hover:text-slate-600 hover:bg-slate-50').replace(/\s+/g, ' ');
                baseClass = baseClass.trim() + ' group';
            }
            
            let iconClass = 'w-4 h-4';
            const iconMatch = match[0].match(/<Settings className="([^"]+)"/);
            if (iconMatch) {
                iconClass = iconMatch[1];
            }

            const btnHTML = `
                    <button
                        onClick={() => setShowFeedbackModal(true)}
                        className="${baseClass}"
                    >
                        <MessageSquarePlus className="${iconClass} group-hover:scale-110 transition-transform" />
                        Feedback / Bug
                    </button>
`;
            content = content.replace(match[0], btnHTML + match[0]);
            console.log(`Injected Settings for ${file}`);
        } else {
            console.log(`Settings button not found for ${file}`);
        }

        fs.writeFileSync(path.join(dir, file), content);
    } else {
        console.log(`Already injected for ${file}`);
    }
});
