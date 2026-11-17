/** Fetch a template file endpoint and trigger a browser download. */
export async function downloadTemplateFromUrl(url: string, fallbackFilename: string): Promise<void> {
    const res = await fetch(url);
    if (!res.ok) {
        let message = 'Failed to download template';
        try {
            const data = await res.json();
            if (data?.error) message = data.error;
        } catch {
            const text = await res.text().catch(() => '');
            if (text) message = text;
        }
        throw new Error(message);
    }

    const disposition = res.headers.get('Content-Disposition') || '';
    const match = disposition.match(/filename="?([^"]+)"?/i);
    const filename = match?.[1] || fallbackFilename;

    const blob = await res.blob();
    const objectUrl = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = objectUrl;
    link.download = filename;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    URL.revokeObjectURL(objectUrl);
}

/** Trigger a browser download for a generated CSV string. */
export function downloadCsvContent(csv: string, filename: string): void {
    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
    const objectUrl = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = objectUrl;
    link.download = filename;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    URL.revokeObjectURL(objectUrl);
}

