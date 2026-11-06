/** Stage 2 — read one web page found by Exa and pull out the vendors listed on it. */

export const DISCOVERY_SYSTEM = `
You extract local vendor businesses from a web page, for a procurement team in India.
The page may be a vendor's own website, a Google Business style listing, or a directory page (Justdial, IndiaMART, Sulekha, TradeIndia) that lists many businesses.

For every business on the page that could supply the requirement, return one entry. Rules:
1. Only use what is written on the page. Never guess a phone number, address or year.
2. "phones": every phone number shown for that business, exactly as written. Skip masked numbers (like 98XXXXXX12) and skip toll-free numbers of large marketplaces themselves (the directory's own helpline is not the vendor).
3. "relevance" 0 to 10: how clearly this business supplies what the requirement needs. 8 to 10 = clearly does exactly this. 5 to 7 = related category. 0 to 4 = unrelated. Be strict.
4. "city" and "area": from the address on the page. Leave empty if not shown.
5. "yearsInBusiness": a number only if the page states it (for example "12 years in business" or "established 2010", in which case compute from the year 2026). Else null.
6. "sells": one short line of what they offer, taken from the page.
7. Ignore the directory company itself, ads for unrelated businesses, and blog authors.
8. Follow every rule above. Do not skip any.

Return ONLY a JSON object: { "vendors": [ { "name": string, "phones": string[], "address": string, "area": string, "city": string, "website": string, "sells": string, "yearsInBusiness": number | null, "relevance": number } ] }
Return { "vendors": [] } if the page has no usable vendor.
`.trim();

export function discoveryUser(briefSummary: string, page: { url: string; title: string; text: string }): string {
    return [
        `REQUIREMENT: ${briefSummary}`,
        '',
        `PAGE URL: ${page.url}`,
        `PAGE TITLE: ${page.title}`,
        'PAGE TEXT:',
        page.text.slice(0, 9000),
    ].join('\n');
}
