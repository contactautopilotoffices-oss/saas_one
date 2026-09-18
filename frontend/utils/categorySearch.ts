import React from 'react';

/**
 * HR Domain Synonyms & Keyword Dictionary
 * Maps common employee search terms to category concepts.
 */
const HR_SYNONYMS: Record<string, string[]> = {
    // Salary & Payroll
    salary: ['payroll', 'payslip', 'wages', 'compensation', 'stipend', 'ctc', 'payout', 'remuneration', 'pay'],
    pay: ['payroll', 'payslip', 'salary', 'wages', 'payout'],
    payslip: ['payroll', 'salary', 'pay', 'slip'],
    payroll: ['salary', 'payslip', 'pay', 'wages'],

    // Tax, PF & Benefits
    pf: ['epf', 'esi', 'esic', 'provident', 'taxation', 'deduction', 'form 16', 'tds', 'pension'],
    epf: ['pf', 'esi', 'esic', 'provident'],
    esi: ['esic', 'pf', 'epf', 'insurance', 'health'],
    esic: ['esi', 'pf', 'epf', 'insurance'],
    tax: ['tds', 'form 16', 'deduction', 'taxation', 'investment', 'pf'],
    form16: ['tax', 'tds', 'form 16'],

    // Leave & Attendance
    leave: ['attendance', 'absent', 'casual', 'sick', 'earned', 'holiday', 'vacation', 'lop', 'encashment'],
    attendance: ['leave', 'biometric', 'timing', 'overtime', 'shift', 'punch', 'wfh', 'present'],
    absent: ['leave', 'attendance', 'lop'],
    shift: ['timing', 'attendance', 'roster', 'schedule'],

    // Workplace & POSH
    harassment: ['posh', 'misconduct', 'behavioural', 'retaliation', 'bullying', 'abuse', 'discrimination', 'safety'],
    posh: ['harassment', 'sexual', 'misconduct', 'women', 'safety'],
    safety: ['environment', 'ergonomics', 'posh', 'harassment'],
    work: ['environment', 'conditions', 'workplace', 'atmosphere'],
    env: ['environment', 'conditions', 'workplace'],

    // Management & Hierarchy
    manager: ['supervisor', 'reporting', 'hod', 'lead', 'boss', 'management'],
    boss: ['manager', 'supervisor', 'reporting', 'hod'],
    supervisor: ['manager', 'reporting', 'hod'],
    director: ['senior', 'management', 'board', 'cxo', 'leadership'],

    // Resignation & Exit
    resignation: ['exit', 'fnf', 'relieving', 'resign', 'notice', 'separation', 'clearance'],
    exit: ['resignation', 'fnf', 'relieving', 'clearance'],
    fnf: ['resignation', 'exit', 'full and final', 'settlement'],
    resign: ['resignation', 'exit', 'notice'],

    // IT Assets & Equipment
    laptop: ['asset', 'hardware', 'system', 'it', 'sim', 'card', 'desk', 'equipment', 'computer'],
    it: ['asset', 'laptop', 'sim', 'email', 'software', 'hardware', 'tech', 'access'],
    asset: ['laptop', 'sim', 'hardware', 'it', 'equipment'],

    // Claims & Expenses
    reimbursement: ['claims', 'expense', 'bills', 'allowance', 'travel', 'conveyance', 'medical'],
    claim: ['reimbursement', 'expense', 'bills'],
    claims: ['reimbursement', 'expense', 'bills'],

    // Appraisal & Growth
    appraisal: ['increment', 'promotion', 'rating', 'hike', 'review', 'eval', 'performance'],
    increment: ['appraisal', 'promotion', 'hike', 'salary'],
    promotion: ['appraisal', 'increment', 'growth', 'designation']
};

/**
 * Super Strong Multi-Word Category Search Matcher.
 * Returns true if EVERY word token in `query` matches the category fields
 * either directly (substring) or via the HR synonyms dictionary.
 */
export function matchCategorySearch(cat: any, query: string): boolean {
    if (!query || !query.trim()) return true;

    // Normalize and split query into non-empty tokens
    const tokens = query.toLowerCase().trim().split(/\s+/).filter(Boolean);
    if (tokens.length === 0) return true;

    const categoryName = (cat.category_name || '').toLowerCase();
    const subCategory = (cat.sub_category_name || '').toLowerCase();
    const ticketType = (cat.ticket_type || '').replace(/_/g, ' ').toLowerCase();
    const ownerType = (cat.first_level_owner_type || '').replace(/_/g, ' ').toLowerCase();

    // SLA / TAT formatted strings
    const l1Sla = cat.l1_sla_days ? `tat ${cat.l1_sla_days}d ${cat.l1_sla_days} day ${cat.l1_sla_days} days` : '';
    const l2Sla = cat.l2_sla_days ? `${cat.l2_sla_days}d ${cat.l2_sla_days} day ${cat.l2_sla_days} days` : '';

    // Search blob combining all relevant text attributes
    const searchBlob = `${categoryName} ${subCategory} ${ticketType} ${ownerType} ${l1Sla} ${l2Sla}`.toLowerCase();

    // Check if every token matches
    return tokens.every(token => {
        // Direct substring check
        if (searchBlob.includes(token)) return true;

        // Synonym expansion check
        const synonyms = HR_SYNONYMS[token] || [];
        return synonyms.some(syn => searchBlob.includes(syn));
    });
}

/**
 * Highlight Matching Words in Category Text using pure React.createElement (.ts file compatible)
 */
export function HighlightedCategoryText({ text, query }: { text: string; query: string }): React.ReactElement | null {
    if (!text) return null;
    if (!query || !query.trim()) return React.createElement('span', null, text);

    const words = query.toLowerCase().trim().split(/\s+/).filter(w => w.length > 0);
    if (words.length === 0) return React.createElement('span', null, text);

    // Escape special characters for regex
    const escapedWords = words.map(w => w.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'));
    const regex = new RegExp(`(${escapedWords.join('|')})`, 'gi');

    const parts = text.split(regex);

    return React.createElement(
        'span',
        null,
        parts.map((part, index) => {
            const lowerPart = part.toLowerCase();
            const isMatch = words.some(w => lowerPart === w || (w.length >= 2 && lowerPart.includes(w)));
            return isMatch
                ? React.createElement(
                      'mark',
                      {
                          key: index,
                          className: 'bg-amber-200 dark:bg-amber-900/60 text-amber-950 dark:text-amber-200 rounded px-1 py-0.5 font-extrabold shadow-2xs'
                      },
                      part
                  )
                : React.createElement('span', { key: index }, part);
        })
    );
}
