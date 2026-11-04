/**
 * Language handling. Replies are built by code from these templates (plan gap S20): the AI never writes the wording of a
 * confirmation or an answer, so it can't swap a number or invent a fact. Supported: English, Hindi (Devanagari) and
 * Hinglish (Hindi in Roman letters). Marathi is out of scope (owner 2026-11-03).
 */
import type { Lang } from './types';
import type { Period } from './dates';

const DEVANAGARI = /[ऀ-ॿ]/;
const HINGLISH_WORDS = new Set([
    'hai', 'hain', 'kya', 'kitne', 'kitna', 'kitni', 'aaj', 'kal', 'nahi', 'nahin', 'mera', 'mere', 'meri', 'bana', 'bane',
    'dikhao', 'batao', 'karo', 'kar', 'ho', 'gaya', 'gayi', 'wala', 'wali', 'haan', 'ji', 'hua', 'hui', 'raha', 'rahi',
    'kaam', 'abhi', 'sab', 'mein', 'ka', 'ki', 'ke', 'ko', 'se', 'aur', 'bhai', 'theek', 'chahiye', 'kaunsa', 'kaha', 'kahan',
]);

export function detectLang(text: string): Lang {
    if (DEVANAGARI.test(text)) return 'hi';
    const words = text.toLowerCase().match(/[a-z]+/g) || [];
    const hits = words.filter(w => HINGLISH_WORDS.has(w)).length;
    return hits >= 1 && hits / Math.max(words.length, 1) >= 0.15 ? 'hinglish' : 'en';
}

type T = Record<Lang, string>;

export const TEXT = {
    not_enabled: { en: "The AI assistant isn't turned on for your account. Please ask your admin.", hi: 'आपके खाते के लिए AI सहायक चालू नहीं है। कृपया अपने एडमिन से पूछें।', hinglish: 'Aapke account ke liye AI assistant on nahi hai. Apne admin se poochiye.' },
    rate_limited: { en: "You've sent a lot of messages. Please wait a few minutes and try again.", hi: 'आपने बहुत संदेश भेजे हैं। कुछ मिनट रुककर फिर कोशिश करें।', hinglish: 'Aapne bahut messages bheje hain. Kuch minute ruk kar phir try kijiye.' },
    daily_limit: { en: "You've reached today's limit for actions. You can still use the app screens.", hi: 'आज की सीमा पूरी हो गई है। आप ऐप की स्क्रीन इस्तेमाल कर सकते हैं।', hinglish: 'Aaj ki limit poori ho gayi hai. App ki screens use kar sakte hain.' },
    unknown: { en: "I can't help with that yet. I can: {abilities}.", hi: 'मैं अभी इसमें मदद नहीं कर सकता। मैं यह कर सकता हूँ: {abilities}।', hinglish: 'Isme abhi madad nahi kar sakta. Main ye kar sakta hoon: {abilities}.' },
    nothing_enabled: { en: "Nothing is switched on for your role yet. Please ask your admin.", hi: 'आपकी भूमिका के लिए अभी कुछ चालू नहीं है। कृपया अपने एडमिन से पूछें।', hinglish: 'Aapke role ke liye abhi kuch on nahi hai. Admin se poochiye.' },
    forbidden: { en: "I can't do that in chat. Approvals, payments, deletes and role changes happen in the app.", hi: 'यह चैट में नहीं हो सकता। अप्रूवल, पेमेंट, डिलीट और रोल बदलना ऐप में होता है।', hinglish: 'Ye chat mein nahi ho sakta. Approval, payment, delete aur role change app mein hote hain.' },
    out_of_scope: { en: 'You have access to {properties} only.', hi: 'आपके पास केवल {properties} का एक्सेस है।', hinglish: 'Aapke paas sirf {properties} ka access hai.' },
    ask_property: { en: 'Which building?', hi: 'कौन सी बिल्डिंग?', hinglish: 'Kaunsi building?' },
    ask_description: { en: 'What is the problem? Please describe it in a line.', hi: 'समस्या क्या है? एक लाइन में बताइए।', hinglish: 'Problem kya hai? Ek line mein bataiye.' },
    ask_location: { en: 'Where exactly? Floor, room or cabin. (Say "skip" if not needed.)', hi: 'ठीक कहाँ? मंज़िल, कमरा या केबिन। (ज़रूरत न हो तो "skip" लिखें।)', hinglish: 'Exactly kahan? Floor, room ya cabin. (Zaroorat na ho to "skip" likhiye.)' },
    confirm_ticket: { en: 'Please check before I raise the ticket:\n📍 {property}{location}\n🔧 {description}\nShall I raise it? Reply Yes / Change / Cancel', hi: 'टिकट बनाने से पहले देख लीजिए:\n📍 {property}{location}\n🔧 {description}\nबना दूँ? हाँ / बदलें / रद्द करें', hinglish: 'Ticket banane se pehle check kar lijiye:\n📍 {property}{location}\n🔧 {description}\nBana doon? Yes / Change / Cancel' },
    ticket_created: { en: '✅ Ticket {number} raised at {property}. Status: {status}{assignee}.', hi: '✅ टिकट {number} {property} में बन गया। स्थिति: {status}{assignee}।', hinglish: '✅ Ticket {number} {property} mein ban gaya. Status: {status}{assignee}.' },
    ticket_shadow: { en: '🧪 Test mode: ticket creation by chat is being trialled, so nothing was created. Your admin can see what would have been raised. Please raise it in the app for now.', hi: '🧪 टेस्ट मोड: चैट से टिकट बनाना अभी ट्रायल में है, इसलिए कुछ नहीं बना। अभी ऐप में टिकट बनाइए।', hinglish: '🧪 Test mode: chat se ticket banana abhi trial mein hai, isliye kuch nahi bana. Abhi app mein ticket raise kijiye.' },
    change_what: { en: 'Sure. Tell me what to change (building, place or problem).', hi: 'ठीक है। बताइए क्या बदलना है (बिल्डिंग, जगह या समस्या)।', hinglish: 'Theek hai. Bataiye kya badalna hai (building, jagah ya problem).' },
    cancelled: { en: 'Cancelled. Nothing was created.', hi: 'रद्द कर दिया। कुछ नहीं बना।', hinglish: 'Cancel kar diya. Kuch nahi bana.' },
    handoff: { en: "Let's stop here so we don't go round in circles. Please raise it in the app, or start again with all the details in one message.", hi: 'यहीं रुकते हैं। कृपया ऐप में बनाइए, या सारी जानकारी एक संदेश में फिर से भेजिए।', hinglish: 'Yahin rukte hain. App mein raise kijiye, ya saari details ek message mein phir bhejiye.' },
    already_done: { en: 'That ticket was already raised. Ask me "my open tickets" to see it.', hi: 'वह टिकट पहले ही बन चुका है।', hinglish: 'Woh ticket pehle hi ban chuka hai. "mere open tickets" poochiye.' },
    pick_number: { en: 'Reply with the number or the building name.', hi: 'नंबर या बिल्डिंग का नाम लिखें।', hinglish: 'Number ya building ka naam likhiye.' },
    failed: { en: "Sorry, that didn't work. Nothing was changed. Please try again or use the app.", hi: 'माफ़ कीजिए, यह नहीं हुआ। कुछ नहीं बदला। फिर कोशिश करें या ऐप इस्तेमाल करें।', hinglish: 'Sorry, ye nahi hua. Kuch nahi badla. Phir try kijiye ya app use kijiye.' },
    ai_down: { en: "I couldn't understand that right now. Please try again in a minute, or use the app.", hi: 'मैं अभी समझ नहीं पाया। एक मिनट बाद फिर कोशिश करें या ऐप इस्तेमाल करें।', hinglish: 'Abhi samajh nahi paaya. Ek minute baad try kijiye ya app use kijiye.' },
    tickets_count: { en: '{period}, {scope}: {total} tickets. {open} open, {closed} closed.{top}', hi: '{period}, {scope}: {total} टिकट। {open} खुले, {closed} बंद।{top}', hinglish: '{period}, {scope}: {total} tickets. {open} open, {closed} closed.{top}' },
    tickets_top: { en: ' Most: {category} ({count}).', hi: ' सबसे ज़्यादा: {category} ({count})।', hinglish: ' Sabse zyada: {category} ({count}).' },
    tickets_none: { en: '{period}, {scope}: no tickets.', hi: '{period}, {scope}: कोई टिकट नहीं।', hinglish: '{period}, {scope}: koi ticket nahi.' },
    tickets_list_head: { en: '{period}, {scope}: {shown} of {total} tickets', hi: '{period}, {scope}: {total} में से {shown} टिकट', hinglish: '{period}, {scope}: {total} mein se {shown} tickets' },
    readings_head: { en: '{period}, {property}:', hi: '{period}, {property}:', hinglish: '{period}, {property}:' },
    readings_logged: { en: '✅ {logged} of {active} active meters logged', hi: '✅ {active} में से {logged} मीटर की रीडिंग हो गई', hinglish: '✅ {active} mein se {logged} meters ki reading ho gayi' },
    readings_missing: { en: '⏳ Missing: {meters}', hi: '⏳ बाकी: {meters}', hinglish: '⏳ Baaki: {meters}' },
    readings_critical: { en: '🔴 Critical: {meters}', hi: '🔴 गंभीर: {meters}', hinglish: '🔴 Critical: {meters}' },
    readings_warning: { en: '⚠️ Warning: {meters}', hi: '⚠️ चेतावनी: {meters}', hinglish: '⚠️ Warning: {meters}' },
    readings_faulty: { en: '🛠️ Faulty meters: {meters}', hi: '🛠️ खराब मीटर: {meters}', hinglish: '🛠️ Kharab meters: {meters}' },
    readings_no_meters: { en: '{property}: no active electricity meters are set up.', hi: '{property}: कोई सक्रिय बिजली मीटर नहीं है।', hinglish: '{property}: koi active electricity meter set up nahi hai.' },
    consumption: { en: '{period}, {scope}: {units} units ({days} days with readings). Previous period: {prevUnits} units ({change}).', hi: '{period}, {scope}: {units} यूनिट ({days} दिन की रीडिंग)। पिछली अवधि: {prevUnits} यूनिट ({change})।', hinglish: '{period}, {scope}: {units} units ({days} din ki readings). Pichhla period: {prevUnits} units ({change}).' },
    consumption_none: { en: '{period}, {scope}: no readings recorded yet.', hi: '{period}, {scope}: अभी कोई रीडिंग दर्ज नहीं है।', hinglish: '{period}, {scope}: abhi koi reading record nahi hui.' },
    anomalies_note: { en: ' {n} suspicious readings were left out.', hi: ' {n} संदिग्ध रीडिंग छोड़ दी गईं।', hinglish: ' {n} suspicious readings chhod di gayi.' },
} satisfies Record<string, T>;

export type TextKey = keyof typeof TEXT;

export function t(key: TextKey, lang: Lang, values: Record<string, string | number> = {}): string {
    const template = TEXT[key][lang] ?? TEXT[key].en;
    return template.replace(/\{(\w+)\}/g, (_, k: string) => (k in values ? String(values[k]) : ''));
}

const PERIOD_LABEL: Record<Period, T> = {
    today: { en: 'Today', hi: 'आज', hinglish: 'Aaj' },
    yesterday: { en: 'Yesterday', hi: 'कल', hinglish: 'Kal' },
    this_week: { en: 'This week', hi: 'इस हफ़्ते', hinglish: 'Is hafte' },
    last_7_days: { en: 'Last 7 days', hi: 'पिछले 7 दिन', hinglish: 'Pichhle 7 din' },
    this_month: { en: 'This month', hi: 'इस महीने', hinglish: 'Is mahine' },
    last_month: { en: 'Last month', hi: 'पिछले महीने', hinglish: 'Pichhle mahine' },
};
export const periodLabel = (p: Period, lang: Lang) => PERIOD_LABEL[p][lang];

/** "Work Square Andheri" or "all 4 buildings". */
export function scopeLabel(names: string[], lang: Lang): string {
    if (names.length === 1) return names[0];
    return lang === 'en' ? `all ${names.length} buildings` : lang === 'hi' ? `सभी ${names.length} बिल्डिंग` : `sabhi ${names.length} buildings`;
}

export const YES = /^(y|yes|yeah|yep|ok|okay|confirm|haan|han|ha|haa|ji|ji haan|theek hai|thik hai|kar do|bana do|हाँ|हां|जी|ठीक है)[.! ]*$/i;
export const NO = /^(n|no|nope|cancel|stop|nahi|nahin|mat|rehne do|रद्द|नहीं|रद्द करें)[.! ]*$/i;
export const CHANGE = /^(change|edit|badlo|badlna|बदलें|बदलो)[.! ]*$/i;
export const SKIP = /^(skip|no|nahi|nahin|none|na|छोड़ें|नहीं)[.! ]*$/i;
