export default function HubBars({ values, label, color = '#5145e4' }: { values?: number[]; label: string; color?: string }) {
    if (!values?.length) return null;
    const peak = Math.max(1, ...values);
    return <span role="img" aria-label={`${label}: ${values.join(', ')}`} title={label} className="flex h-9 shrink-0 items-end gap-[3px]">
        {values.map((n, i) => <span key={i} className="w-1.5 rounded-full" style={{ height: Math.max(3, n / peak * 36), background: color, opacity: .42 + (i / values.length) * .58 }} />)}
    </span>;
}
