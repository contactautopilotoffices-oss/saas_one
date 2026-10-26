/** Exa web search. Returns pages with their text so the discovery step can read vendors off them. */

import { satejConfig } from '../config';
import { mockExaSearch } from './mocks';

export interface ExaPage {
    url: string;
    title: string;
    text: string;
}

export async function exaSearch(query: string, numResults = satejConfig.exaResultsPerQuery): Promise<ExaPage[]> {
    if (satejConfig.mockMode) return mockExaSearch(query);

    const res = await fetch('https://api.exa.ai/search', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'x-api-key': satejConfig.exaApiKey },
        body: JSON.stringify({
            query,
            type: 'auto',
            numResults,
            userLocation: 'IN',
            contents: { text: { maxCharacters: 9000 } },
        }),
    });
    if (!res.ok) throw new Error(`Exa ${res.status}: ${(await res.text()).slice(0, 300)}`);
    const data = await res.json();
    return (data.results ?? []).map((r: { url?: string; title?: string; text?: string }) => ({
        url: String(r.url ?? ''),
        title: String(r.title ?? ''),
        text: String(r.text ?? ''),
    }));
}
