/** Match whole greetings so requests such as "hi, AC is broken" still become tickets. */
export function isGreetingMessage(text: string): boolean {
    const normalized = text.toLowerCase().replace(/[^\p{L}\p{N}\s]/gu, ' ').replace(/\s+/g, ' ').trim();
    return /^(?:hi+|hey+|hello|helo|heelo|hallo|hello there|hi there|hey there|good morning|good afternoon|good evening|greetings|namaste|namaskar|salaam|assalamualaikum)$/.test(normalized);
}

/** AiSensy may send message/text as a string or a nested WhatsApp object. */
export function extractMessageText(dataObj: any, body: any): string {
    const candidates = [
        dataObj?.message, dataObj?.text, dataObj?.caption,
        dataObj?.messageText, dataObj?.message_text, dataObj?.body, dataObj?.content,
        dataObj?.message?.text?.body, dataObj?.message?.text,
        dataObj?.message?.body, dataObj?.message?.caption, dataObj?.text?.body,
        dataObj?.messages?.[0]?.text?.body, dataObj?.messages?.[0]?.caption,
        body?.message, body?.text, body?.message?.text?.body,
        body?.message?.text, body?.text?.body,
    ];
    return candidates.find(value => typeof value === 'string' && value.trim()) || '';
}
