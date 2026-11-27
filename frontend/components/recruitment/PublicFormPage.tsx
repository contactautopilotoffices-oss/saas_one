import { Building2 } from 'lucide-react';
import type { ReactNode } from 'react';
import { FormattedAnswer } from '@/frontend/components/hr-assistant/FormattedAnswer';

export function PublicFormPage({ company, title, children }: { company?: string; title: string; children: ReactNode }) {
    return <main className="rf">
        <link rel="stylesheet" href="/apply/assets/recruitment-forms.css" precedence="recruitment" />
        <div className="rf-bar"><div className="rf-brand"><span className="rf-mark"><Building2 size={18} aria-hidden /></span>{company || 'Recruitment'}</div><span>{title}</span></div>
        <div className="rf-content">{children}</div>
    </main>;
}

// HR supplies plain text, often pasted with WhatsApp-style headings and one role fact per line.
export function FormDocument({ text }: { text: string }) {
    const blocks: ReactNode[] = [];
    let prose: string[] = [];
    let facts: [string, string][] = [];
    function flushProse() {
        if (prose.length) blocks.push(<FormattedAnswer key={blocks.length} text={prose.join('\n')} />);
        prose = [];
    }
    function flushFacts() {
        if (facts.length) blocks.push(<dl className="rf-facts" key={blocks.length}>{facts.map(([label, value], i) =>
            <div key={i}><dt>{label}</dt><dd>{/^https?:\/\/[^\s]+$/i.test(value) ? <a href={value} target="_blank" rel="noopener noreferrer">{value}</a> : value}</dd></div>
        )}</dl>);
        facts = [];
    }
    for (const line of text.replace(/\r\n?/g, '\n').split('\n')) {
        const clean = line.trim();
        const heading = /^(?:#{1,6}\s+(.+)|(\*{1,2})([^*]+)\2)$/.exec(clean);
        const fact = /^([\p{L}][\p{L}\p{N} &()/'–-]{0,38}):\s+(.+)$/u.exec(clean);
        if (heading) {
            flushProse(); flushFacts();
            blocks.push(<h3 key={blocks.length}>{heading[1] || heading[3]}</h3>);
        } else if (fact) {
            flushProse(); facts.push([fact[1], fact[2]]);
        } else {
            flushFacts(); prose.push(line);
        }
    }
    flushProse(); flushFacts();
    return <div className="rf-document">{blocks}</div>;
}
