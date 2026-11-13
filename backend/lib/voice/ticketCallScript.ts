/**
 * What the automatic phone call says when a ticket is assigned to someone.
 *
 * Each property picks its call language (properties.call_language). The surrounding sentences are
 * spoken in that language, but the ticket title is always spoken in English, because titles are
 * typed in English and a local voice reading English words sounds wrong.
 *
 * A script is a list of segments, each with its own language, so the call can switch voice
 * between the local sentence and the English title.
 */

export type CallLanguage = 'en' | 'hi' | 'mr' | 'kn';

export const CALL_LANGUAGES: { id: CallLanguage; label: string }[] = [
    { id: 'en', label: 'English' },
    { id: 'hi', label: 'Hindi' },
    { id: 'mr', label: 'Marathi' },
    { id: 'kn', label: 'Kannada' },
];

export interface VoiceSegment {
    /** Language this piece is spoken in. */
    lang: CallLanguage;
    text: string;
}

export function normalizeCallLanguage(raw: unknown): CallLanguage {
    return raw === 'hi' || raw === 'mr' || raw === 'kn' ? raw : 'en';
}

const PRIORITY_WORDS: Record<CallLanguage, Record<string, string>> = {
    en: { low: 'low', medium: 'medium', high: 'high', urgent: 'urgent', critical: 'critical' },
    hi: { low: 'कम', medium: 'मध्यम', high: 'ज़्यादा', urgent: 'बहुत ज़रूरी', critical: 'बहुत ज़रूरी' },
    mr: { low: 'कमी', medium: 'मध्यम', high: 'जास्त', urgent: 'अतिशय तातडीचे', critical: 'अतिशय तातडीचे' },
    kn: { low: 'ಕಡಿಮೆ', medium: 'ಮಧ್ಯಮ', high: 'ಹೆಚ್ಚು', urgent: 'ತುರ್ತು', critical: 'ತುರ್ತು' },
};

interface Phrases {
    intro: (name: string, property: string) => string;
    priority: (word: string) => string;
    repeat: string;
}

// {name} arrives with a leading space (or empty when unknown). {name} and {property} are spoken as typed (usually English letters); every voice used reads those.
const PHRASES: Record<CallLanguage, Phrases> = {
    en: {
        intro: (n, p) => `Hello${n}. You have been assigned a new ticket at ${p}. The ticket is:`,
        priority: w => `Priority is ${w}. Please open the app and attend to it right away. Once again, the ticket is:`,
        repeat: 'Thank you.',
    },
    hi: {
        intro: (n, p) => `नमस्ते${n}। ${p} पर आपको एक नया टिकट दिया गया है। टिकट है:`,
        priority: w => `प्राथमिकता ${w} है। कृपया ऐप खोलें और तुरंत काम शुरू करें। फिर से बताते हैं, टिकट है:`,
        repeat: 'धन्यवाद।',
    },
    mr: {
        intro: (n, p) => `नमस्कार${n}. ${p} येथे तुम्हाला एक नवीन तिकीट देण्यात आले आहे. तिकीट आहे:`,
        priority: w => `प्राधान्य ${w} आहे. कृपया ॲप उघडा आणि लगेच काम सुरू करा. पुन्हा एकदा, तिकीट आहे:`,
        repeat: 'धन्यवाद.',
    },
    kn: {
        intro: (n, p) => `ನಮಸ್ಕಾರ${n}. ${p} ನಲ್ಲಿ ನಿಮಗೆ ಹೊಸ ಟಿಕೆಟ್ ನೀಡಲಾಗಿದೆ. ಟಿಕೆಟ್:`,
        priority: w => `ಆದ್ಯತೆ ${w}. ದಯವಿಟ್ಟು ಆ್ಯಪ್ ತೆರೆಯಿರಿ ಮತ್ತು ತಕ್ಷಣ ಕೆಲಸ ಪ್ರಾರಂಭಿಸಿ. ಮತ್ತೊಮ್ಮೆ, ಟಿಕೆಟ್:`,
        repeat: 'ಧನ್ಯವಾದಗಳು.',
    },
};

/** Keeps the call short and the answer link small: long titles are cut at a word boundary. */
function shortTitle(title: string, max = 140): string {
    const clean = (title || '').replace(/\s+/g, ' ').trim() || 'Service request';
    if (clean.length <= max) return clean;
    const cut = clean.slice(0, max);
    return cut.slice(0, cut.lastIndexOf(' ') > 40 ? cut.lastIndexOf(' ') : max);
}

export function buildTicketAssignedScript(input: {
    language: CallLanguage;
    assigneeName?: string | null;
    propertyName?: string | null;
    title: string;
    priority?: string | null;
}): VoiceSegment[] {
    const lang = input.language;
    const phrases = PHRASES[lang];
    // First name only: it is what people answer to, and it keeps the call short.
    const firstName = (input.assigneeName || '').trim().split(/\s+/)[0] || '';
    const name = firstName ? ` ${firstName}` : '';
    const property = (input.propertyName || '').trim() || 'your site';
    const priorityKey = (input.priority || 'medium').toLowerCase();
    const priorityWord = PRIORITY_WORDS[lang][priorityKey] || PRIORITY_WORDS[lang].medium;
    const title = shortTitle(input.title);

    return [
        { lang, text: phrases.intro(name, property).replace(/\s+/g, ' ') },
        { lang: 'en', text: `${title}.` },
        { lang, text: phrases.priority(priorityWord) },
        { lang: 'en', text: `${title}.` },
        { lang, text: phrases.repeat },
    ];
}

/** Plain text of a script, for call logs and providers that take a single string. */
export function scriptToText(segments: VoiceSegment[]): string {
    return segments.map(s => s.text).join(' ');
}
