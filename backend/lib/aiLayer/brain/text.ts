/**
 * Words the brain's CODE says: confirmation cards, results of actions, refusals. The model never writes these, so it
 * cannot swap a number or claim something happened. English, Hindi and Hinglish, like backend/lib/aiLayer/language.ts.
 */
import type { Lang } from '../types';

type T = Record<Lang, string>;

export const BRAIN_TEXT = {
    confirm_tail: { en: 'Reply *Yes* to go ahead, or *Cancel*. To change something, just tell me.', hi: 'आगे बढ़ने के लिए *हाँ* लिखें, या *रद्द करें*। कुछ बदलना हो तो बता दीजिए।', hinglish: 'Aage badhne ke liye *Yes* likhiye, ya *Cancel*. Kuch badalna ho to bata dijiye.' },
    ticket_card: { en: 'Please check before I raise the ticket:\n📍 {property}{location}\n🔧 {description}{source}{photo}', hi: 'टिकट बनाने से पहले देख लीजिए:\n📍 {property}{location}\n🔧 {description}{source}{photo}', hinglish: 'Ticket banane se pehle check kar lijiye:\n📍 {property}{location}\n🔧 {description}{source}{photo}' },
    from_photo: { en: ' (written from your photo)', hi: ' (आपकी फ़ोटो से लिखा गया)', hinglish: ' (aapki photo se likha gaya)' },
    photo_line: { en: '\n📷 1 photo attached', hi: '\n📷 1 फ़ोटो जुड़ी है', hinglish: '\n📷 1 photo attached' },
    ticket_done: { en: '✅ Ticket {number} raised at {property}. Status: {status}{assignee}.{photo}', hi: '✅ टिकट {number} {property} में बन गया। स्थिति: {status}{assignee}।{photo}', hinglish: '✅ Ticket {number} {property} mein ban gaya. Status: {status}{assignee}.{photo}' },
    photo_attached: { en: ' Your photo is attached.', hi: ' आपकी फ़ोटो जोड़ दी गई है।', hinglish: ' Aapki photo attach ho gayi hai.' },
    photo_expired: { en: ' The photo had expired, so it was not attached. Please send it again if needed.', hi: ' फ़ोटो की समय-सीमा निकल गई थी, इसलिए नहीं जुड़ी। ज़रूरत हो तो फिर भेजें।', hinglish: ' Photo expire ho gayi thi, isliye attach nahi hui. Zaroorat ho to dobara bhejiye.' },
    photo_failed: { en: ' The photo could not be attached just now. Say "add the photo to that ticket" to try again.', hi: ' फ़ोटो अभी नहीं जुड़ पाई। फिर कोशिश के लिए "उस टिकट में फ़ोटो जोड़ो" लिखें।', hinglish: ' Photo abhi attach nahi ho payi. Dobara try ke liye "us ticket mein photo add karo" likhiye.' },
    already_has_photo: { en: 'Ticket {number} already has a photo, so nothing was changed. More photos can be added in the app.', hi: 'टिकट {number} में पहले से फ़ोटो है, इसलिए कुछ नहीं बदला। और फ़ोटो ऐप में जोड़ी जा सकती हैं।', hinglish: 'Ticket {number} mein pehle se photo hai, isliye kuch nahi badla. Aur photos app mein add ho sakti hain.' },
    add_photo_card: { en: 'Add your photo to ticket {number} ("{title}")?', hi: 'आपकी फ़ोटो टिकट {number} ("{title}") में जोड़ूँ?', hinglish: 'Aapki photo ticket {number} ("{title}") mein add karun?' },
    add_photo_done: { en: '✅ Photo added to ticket {number}.', hi: '✅ फ़ोटो टिकट {number} में जोड़ दी गई।', hinglish: '✅ Photo ticket {number} mein add ho gayi.' },
    task_file_card: { en: 'Attach your file to task {n}: "{title}"?', hi: 'आपकी फ़ाइल टास्क {n}: "{title}" में जोड़ूँ?', hinglish: 'Aapki file task {n}: "{title}" mein attach karun?' },
    task_file_done: { en: '✅ File attached to "{title}".', hi: '✅ फ़ाइल "{title}" में जोड़ दी गई।', hinglish: '✅ File "{title}" mein attach ho gayi.' },
    room_card: { en: 'Please check before I book:\n🏢 {room}, {property}\n🗓️ {date}, {start} to {end}{purpose}', hi: 'बुक करने से पहले देख लीजिए:\n🏢 {room}, {property}\n🗓️ {date}, {start} से {end}{purpose}', hinglish: 'Book karne se pehle check kar lijiye:\n🏢 {room}, {property}\n🗓️ {date}, {start} se {end}{purpose}' },
    room_done: { en: '✅ Booked {room} at {property} on {date}, {start} to {end}.', hi: '✅ {room}, {property} में {date} को {start} से {end} तक बुक हो गया।', hinglish: '✅ {room}, {property} mein {date} ko {start} se {end} tak book ho gaya.' },
    room_taken: { en: 'That slot was just taken, so nothing was booked. Ask me what is free and I will check again.', hi: 'वह समय अभी-अभी बुक हो गया, इसलिए कुछ बुक नहीं हुआ। पूछिए क्या खाली है, मैं फिर देख लूँगा।', hinglish: 'Woh slot abhi book ho gaya, isliye kuch book nahi hua. Poochiye kya free hai, main phir check kar lunga.' },
    room_credits: { en: 'There are not enough booking credits for that slot, so nothing was booked.', hi: 'उस समय के लिए बुकिंग क्रेडिट पूरे नहीं हैं, इसलिए कुछ बुक नहीं हुआ।', hinglish: 'Us slot ke liye booking credits kam hain, isliye kuch book nahi hua.' },
    remember_card: { en: 'Shall I remember this for next time?\n🧠 {label}: {value}', hi: 'क्या मैं यह अगली बार के लिए याद रखूँ?\n🧠 {label}: {value}', hinglish: 'Kya main yeh agli baar ke liye yaad rakhun?\n🧠 {label}: {value}' },
    remember_done: { en: '✅ Remembered. Say "forget that" any time.', hi: '✅ याद रख लिया। कभी भी "यह भूल जाओ" कह सकते हैं।', hinglish: '✅ Yaad rakh liya. Kabhi bhi "forget that" keh sakte hain.' },
    forget_card: { en: 'Forget what I remember about you: {what}?', hi: 'आपके बारे में जो याद है वह भूल जाऊँ: {what}?', hinglish: 'Aapke baare mein jo yaad hai woh bhool jaun: {what}?' },
    forget_done: { en: '✅ Forgotten ({count}).', hi: '✅ भुला दिया ({count})।', hinglish: '✅ Bhula diya ({count}).' },
    everything: { en: 'everything', hi: 'सब कुछ', hinglish: 'sab kuch' },
    memory_none: { en: "I don't have anything remembered about you.", hi: 'मुझे आपके बारे में कुछ याद नहीं है।', hinglish: 'Mujhe aapke baare mein kuch yaad nahi hai.' },
    memory_head: { en: 'What I remember about you:', hi: 'आपके बारे में मुझे यह याद है:', hinglish: 'Aapke baare mein mujhe yeh yaad hai:' },
    cancelled: { en: 'Cancelled. Nothing was changed.', hi: 'रद्द कर दिया। कुछ नहीं बदला।', hinglish: 'Cancel kar diya. Kuch nahi badla.' },
    expired: { en: 'That request had expired, so nothing was done. Please tell me again what you need.', hi: 'वह अनुरोध पुराना हो गया था, इसलिए कुछ नहीं हुआ। कृपया फिर बताइए।', hinglish: 'Woh request purani ho gayi thi, isliye kuch nahi hua. Please phir bataiye.' },
    access_changed: { en: 'Your access changed since I asked, so nothing was done. Please ask again.', hi: 'मेरे पूछने के बाद आपका एक्सेस बदल गया, इसलिए कुछ नहीं हुआ। कृपया फिर पूछिए।', hinglish: 'Mere poochne ke baad aapka access badal gaya, isliye kuch nahi hua. Please phir poochiye.' },
    already_done: { en: 'That was already done.', hi: 'वह पहले ही हो चुका है।', hinglish: 'Woh pehle hi ho chuka hai.' },
    shadow_write: { en: '🧪 Test mode: this action is being trialled in chat, so nothing was changed. Please do it in the app for now.', hi: '🧪 टेस्ट मोड: यह काम चैट में अभी परखा जा रहा है, इसलिए कुछ नहीं बदला। फ़िलहाल ऐप में कर लीजिए।', hinglish: '🧪 Test mode: yeh kaam chat mein abhi trial par hai, isliye kuch nahi badla. Abhi ke liye app mein kar lijiye.' },
    failed: { en: "Sorry, that didn't work. Nothing was changed. Please try again or use the app.", hi: 'माफ़ कीजिए, यह नहीं हुआ। कुछ नहीं बदला। फिर कोशिश करें या ऐप इस्तेमाल करें।', hinglish: 'Sorry, yeh nahi hua. Kuch nahi badla. Phir try kijiye ya app use kijiye.' },
    daily_limit: { en: "You've reached today's limit for actions in chat. You can still use the app screens.", hi: 'आज चैट से काम करने की सीमा पूरी हो गई है। आप ऐप की स्क्रीन इस्तेमाल कर सकते हैं।', hinglish: 'Aaj chat se actions ki limit poori ho gayi. Aap app screens use kar sakte hain.' },
    rate_limited: { en: "You've sent a lot of messages. Please wait a few minutes and try again.", hi: 'आपने बहुत संदेश भेजे हैं। कुछ मिनट रुककर फिर कोशिश करें।', hinglish: 'Aapne bahut messages bheje hain. Kuch minute ruk kar phir try kijiye.' },
    handoff_human: { en: "I'm not getting this right, so let's stop here. Please use the app, or contact your property team.", hi: 'मैं इसे ठीक से समझ नहीं पा रहा, इसलिए यहीं रुकते हैं। कृपया ऐप इस्तेमाल करें या अपनी प्रॉपर्टी टीम से बात करें।', hinglish: 'Main ise theek se samajh nahi pa raha, isliye yahin rukte hain. Please app use kijiye ya apni property team se baat kijiye.' },
    // The person asked for a human, or the model could not help and passed them on. Nobody is alerted by this chat, so it
    // says so plainly and says where to go; it never pretends a person is joining.
    handoff_asked: { en: "I can't do that from this chat, and I can't connect you to a person here. Please contact your property team, or use the app.", hi: 'मैं यह इस चैट से नहीं कर सकता, और यहाँ से आपको किसी व्यक्ति से जोड़ भी नहीं सकता। कृपया अपनी प्रॉपर्टी टीम से बात करें या ऐप इस्तेमाल करें।', hinglish: 'Main yeh is chat se nahi kar sakta, aur yahan se aapko kisi person se connect bhi nahi kar sakta. Please apni property team se baat kijiye ya app use kijiye.' },
    tasks_elsewhere: { en: 'Tasks are handled by the Task Manager. Open Task Manager in the app, or send this on WhatsApp.', hi: 'टास्क Task Manager में होते हैं। ऐप में Task Manager खोलें या यह WhatsApp पर भेजें।', hinglish: 'Tasks Task Manager mein hote hain. App mein Task Manager kholiye ya yeh WhatsApp par bhejiye.' },
    // Tasks in the brain (owner 2026-11-15). Cards and results are built by code from the Task Manager's own answers.
    task_create_card: { en: 'Please check before I add {count}:\n👤 For: {who}\n🗓️ {date}\n{titles}{note}', hi: 'जोड़ने से पहले देख लीजिए ({count}):\n👤 किसके लिए: {who}\n🗓️ {date}\n{titles}{note}', hinglish: 'Add karne se pehle check kar lijiye ({count}):\n👤 Kiske liye: {who}\n🗓️ {date}\n{titles}{note}' },
    task_complete_card: { en: 'Mark {count} as done?\n{titles}{note}', hi: '{count} पूरा मार्क करूँ?\n{titles}{note}', hinglish: '{count} done mark karun?\n{titles}{note}' },
    task_handover_card: { en: 'Give this task to {who}?\n{titles}{note}', hi: 'यह टास्क {who} को दे दूँ?\n{titles}{note}', hinglish: 'Yeh task {who} ko de dun?\n{titles}{note}' },
    task_remind_card: { en: 'Send a reminder about {count}?\n{titles}', hi: '{count} के बारे में रिमाइंडर भेजूँ?\n{titles}', hinglish: '{count} ke baare mein reminder bhejun?\n{titles}' },
    task_note_line: { en: '\n📝 Note: {note}', hi: '\n📝 नोट: {note}', hinglish: '\n📝 Note: {note}' },
    task_you: { en: 'you', hi: 'आप', hinglish: 'aap' },
    task_one: { en: '1 task', hi: '1 टास्क', hinglish: '1 task' },
    task_many: { en: '{n} tasks', hi: '{n} टास्क', hinglish: '{n} tasks' },
    task_added: { en: '✅ Added {done} for {who}.', hi: '✅ {who} के लिए {done} जोड़ दिए।', hinglish: '✅ {who} ke liye {done} add ho gaye.' },
    task_completed: { en: '✅ Marked {done} as done.', hi: '✅ {done} पूरे मार्क कर दिए।', hinglish: '✅ {done} done mark ho gaye.' },
    task_handed: { en: '✅ Gave the task to {who}.', hi: '✅ टास्क {who} को दे दिया।', hinglish: '✅ Task {who} ko de diya.' },
    task_reminded: { en: '✅ Reminder sent to {who}.', hi: '✅ {who} को रिमाइंडर भेज दिया।', hinglish: '✅ {who} ko reminder bhej diya.' },
    task_none_done: { en: 'Nothing was changed.', hi: 'कुछ नहीं बदला।', hinglish: 'Kuch nahi badla.' },
    task_failed_line: { en: '\n⚠️ Not done: {label} ({why})', hi: '\n⚠️ नहीं हुआ: {label} ({why})', hinglish: '\n⚠️ Nahi hua: {label} ({why})' },
    task_not_reminded: { en: 'No reminder was sent.', hi: 'कोई रिमाइंडर नहीं भेजा गया।', hinglish: 'Koi reminder nahi bheja gaya.' },
    task_handover_failed: { en: 'The task was not given to {who}: {why}', hi: 'टास्क {who} को नहीं दिया गया: {why}', hinglish: 'Task {who} ko nahi diya gaya: {why}' },
    nothing_enabled: { en: 'Nothing is switched on for your role yet. Please ask your admin.', hi: 'आपकी भूमिका के लिए अभी कुछ चालू नहीं है। कृपया अपने एडमिन से पूछें।', hinglish: 'Aapke role ke liye abhi kuch on nahi hai. Please apne admin se poochiye.' },
    down: { en: "I couldn't work that out right now. Please try again in a minute, or use the app.", hi: 'मैं अभी यह नहीं कर पाया। एक मिनट बाद फिर कोशिश करें या ऐप इस्तेमाल करें।', hinglish: 'Main abhi yeh nahi kar paya. Ek minute baad phir try kijiye ya app use kijiye.' },
    ungrounded: { en: "I couldn't confirm that from your records, so I won't guess. Please ask about one thing at a time, for example your tickets, your properties or a meeting room.", hi: 'मैं आपके रिकॉर्ड से इसकी पुष्टि नहीं कर पाया, इसलिए अंदाज़ा नहीं लगाऊँगा। कृपया एक बार में एक चीज़ पूछें, जैसे आपके टिकट, आपकी प्रॉपर्टी या मीटिंग रूम।', hinglish: 'Main aapke records se iski pushti nahi kar paya, isliye andaaza nahi lagaunga. Please ek baar mein ek cheez poochiye, jaise aapke tickets, aapki properties ya meeting room.' },
    photo_ack: { en: 'Got your photo.', hi: 'आपकी फ़ोटो मिल गई।', hinglish: 'Aapki photo mil gayi.' },
    pick: { en: 'Reply with the number.', hi: 'नंबर लिखकर भेजें।', hinglish: 'Number likh kar bhejiye.' },
    // 2026-11-18: the waiting card and closed topics (the owner's chat about the LAN wire ticket).
    card_waiting: { en: 'Your earlier request is still waiting. Reply *Yes* to go ahead, or *Cancel* to drop it.', hi: 'आपका पिछला अनुरोध अभी बाकी है। आगे बढ़ने के लिए *हाँ* लिखें, या छोड़ने के लिए *रद्द करें*।', hinglish: 'Aapki pichli request abhi baaki hai. Aage badhne ke liye *Yes* likhiye, ya chhodne ke liye *Cancel*.' },
    card_again: { en: 'Just to be sure, this is the request that is waiting:', hi: 'पक्का करने के लिए, यह अनुरोध बाकी है:', hinglish: 'Pakka karne ke liye, yeh request baaki hai:' },
    closed_done: { en: 'Okay, I have dropped that. Nothing was raised or changed.', hi: 'ठीक है, मैंने वह छोड़ दिया। कुछ नहीं बना और कुछ नहीं बदला।', hinglish: 'Theek hai, maine woh chhod diya. Kuch nahi bana aur kuch nahi badla.' },
    pick_range: { en: 'Please reply with a number from 1 to {n}.', hi: 'कृपया 1 से {n} तक का नंबर भेजें।', hinglish: 'Please 1 se {n} tak ka number bhejiye.' },
    pick_one: { en: 'Please reply with 1.', hi: 'कृपया 1 भेजें।', hinglish: 'Please 1 bhejiye.' },
    photo_replaced: { en: '📷 Using your new photo (it replaces the earlier one).', hi: '📷 आपकी नई फ़ोटो लगाई है (पुरानी की जगह)।', hinglish: '📷 Aapki nayi photo lagayi hai (purani ki jagah).' },
} satisfies Record<string, T>;

export type BrainTextKey = keyof typeof BRAIN_TEXT;

export function bt(key: BrainTextKey, lang: Lang, values: Record<string, string | number> = {}): string {
    return BRAIN_TEXT[key][lang].replace(/\{(\w+)\}/g, (_, k: string) => (k in values ? String(values[k]) : ''));
}

/** Labels of the remembered facts, shown on cards and in "what do you know about me". */
export const MEMORY_LABELS: Record<string, T> = {
    default_property: { en: 'Your usual property', hi: 'आपकी सामान्य प्रॉपर्टी', hinglish: 'Aapki usual property' },
    usual_location: { en: 'Your usual floor or cabin', hi: 'आपकी सामान्य मंज़िल या केबिन', hinglish: 'Aapka usual floor ya cabin' },
    preferred_room: { en: 'Your preferred meeting room', hi: 'आपका पसंदीदा मीटिंग रूम', hinglish: 'Aapka preferred meeting room' },
    preferred_language: { en: 'Language you prefer', hi: 'आपकी पसंदीदा भाषा', hinglish: 'Aapki preferred language' },
    preferred_name: { en: 'What to call you', hi: 'आपको क्या कहकर बुलाऊँ', hinglish: 'Aapko kya bulaun' },
};
