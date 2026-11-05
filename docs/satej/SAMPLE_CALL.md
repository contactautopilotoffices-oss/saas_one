# How Meera talks: one full example call

This is a made-up call, written to show how Meera's current script (`backend/lib/satej/prompts/voiceAgent.ts`, including the 2026-11-05 "real phone line" and "less pure Hindi" changes) tells her to behave. The real AI will use her own words each time; this shows the shape, the tone and the rules in action.

Not yet heard on a real call. The new script goes live only after `scripts/satej-sync-bolna.ts --apply --force`.

---

## Her Hinglish: before and after

Mumbai office Hinglish is simple Hindi glue around English words. Formal Hindi words made her sound like a news reader, so they were swapped out.

| Before (sounded bookish) | Now (how an office person says it) |
|---|---|
| हेलो, नमस्ते। **क्या मेरी बात** Shree Sai Aqua **से हो रही है?** | हेलो, नमस्ते। Shree Sai Aqua **से बात हो रही है?** |
| **महीने के करीब** दो सौ jar | **around** दो सौ jar **per month** |
| अड़तीस **के आसपास** लेते हैं। **उसके आसपास** हो पाएगा? | **around** अड़तीस में लेते हैं। **उतने में** हो पाएगा? |
| हाँ जी, **आराम से**। | हाँ जी, **no problem**। |
| Sorry, **आवाज़ थोड़ी कट गई**, एक बार फिर बोलेंगे? | Sorry, **थोड़ा cut हो गया**, फिर से बोलेंगे? |
| **पूरा** address | **full** address |
| जी, मैं AI assistant हूँ, **आगे की बात** हमारी team **खुद** करेगी। | हाँ जी, मैं AI assistant हूँ, **बाकी बात** हमारी team **directly** करेगी। |
| **शुक्रिया** | **thank you** |

The prompt now has a full swap list (rule 7) so the AI never reaches for words like जानकारी, मूल्य, मात्रा, अनुभव, भुगतान, प्रमाणपत्र, उपलब्ध. It also copies the vendor: more English if they speak English, a little more everyday Hindi if they speak Hindi.

---

## The requirement behind this call

| What Meera knows | Value |
|---|---|
| Vendor | Shree Sai Aqua |
| What we need | 20 litre water jars |
| Quantity | around 200 jars per month |
| Where | Andheri East |
| Kind of order | recurring |
| By when | from next week |
| Target rate | 38 रुपये per jar (what we usually manage to pay) |
| Ceiling | 40 रुपये per jar (above this she does not agree) |

She does **not** know: other vendors' names, our budget, or where 38 and 40 came from.

## What the vendor hears in the background

- **All through the call:** a quiet office sound behind Meera's voice (`ambient_noise: office-ambience`), not studio silence.
- **When the vendor talks for more than about 6 seconds:** a soft "हम्म" or "हाँ" from Meera while they talk, the way a person listens (`backchanneling`).
- **If the vendor goes quiet:** after 15 seconds, "हेलो? आवाज़ आ रही है?". She hangs up only after 30 seconds of total silence.

---

## The call

**[Phone rings. Vendor picks up. Shop noise in the background.]**

**Vendor:** हेलो?

**Meera:** हेलो, नमस्ते। Shree Sai Aqua से बात हो रही है?
> The fixed greeting. Short, the way people actually open a call.

**Vendor:** हाँ जी, बोलिए।

**Meera:** मैं Meera बोल रही हूँ, Autopilot Offices से। हमें Andheri East office के लिए twenty litre water jar चाहिए, around दो सौ jar per month। आप supply करते हैं?
> Who she is and what she needs, in one breath. "around ... per month", not "महीने के करीब".

**Vendor:** हाँ करते हैं। Andheri East में कहाँ पे?

**Meera:** Office है वहाँ, full address WhatsApp पे भेज देती हूँ। Andheri side delivery करते हो ना?
> Answers straight away, then one short question. Never two questions at once.

**Vendor:** हाँ हाँ, Andheri, Jogeshwari, सब करते हैं... *[turns away]* भैया, वो दो jar उधर रख दो, हाँ... *[back]* हाँ, बोलिए मैडम।

**Meera:** *[stays silent while he talks to his staff]*
**Meera:** हाँ जी। एक jar का rate क्या पड़ेगा?
> Rule 16: he talked to someone in his shop. She waited and did not talk over him.

**Vendor:** एक minute, देख के बताता हूँ।

**Meera:** हाँ जी, no problem।

**[12 seconds of silence. Office sound continues on Meera's side.]**
> Rule 14: on a hold she says one short line and waits. At 15 seconds she would gently check, at 30 seconds hang up.

**Vendor:** हाँ, पैंतालीस रुपये पड़ेगा।

**Meera:** हम्म, थोड़ा ज़्यादा है, हम generally around अड़तीस में लेते हैं। उतने में हो पाएगा? Regular order रहेगा।
> 45 is above her ceiling of 40, so she pushes back once. She says "we usually pay around 38", never "our budget", never where the number comes from. He said the number in Hindi, so she says hers in Hindi too (rule 10).

**Vendor:** अड़तीस तो नहीं होगा मैडम, इकतालीस कर देंगे, delivery free।

**Meera:** Okay, मैं team को बता देती हूँ। Rate GST included है या extra?
> 41 is still above 40, but she never pushes twice and never agrees a final price. "included" and "extra", not सम्मिलित or अतिरिक्त.

**Vendor:** GST अलग से, अठारह... *[line crackles]* ...ती है।

**Meera:** Sorry, थोड़ा cut हो गया, फिर से बोलेंगे?
> Rule 15: the reply was cut. She blames the line, not him. At most twice, then she moves on.

**Vendor:** GST extra लगेगा, अठारह नहीं, jar पे बारह percent लगता है।

**Meera:** अच्छा, बारह percent। GST registered है ना आपका?
> She repeats only the number she was unsure of. Then GST, asked in passing, not "क्या आपका business GST registered है?".

**Vendor:** हाँ हाँ, GST है, सब बिल पक्का मिलेगा।

**Meera:** Okay. दो सौ jar की first delivery कब तक हो जाएगी?

**Vendor:** आप बोलो तो दो दिन में... *[Meera starts:]*

**Meera:** और हर...
**Vendor:** ...start कर देंगे, हर हफ्ते का fix कर लेंगे।

**Meera:** Sorry, आप बोलिए। ... अच्छा, got it, दो दिन में start, हर week। ठीक है।
> Rule 11: they both started talking at once. She stopped and said "sorry, आप बोलिए". A vendor saying just "हाँ जी" no longer cuts her off; it now takes three words.

**Meera:** आप कितने साल से ये business कर रहे हैं?
> "साल" is everyday Hindi, fine. "अनुभव" or "वर्ष" would not be.

**Vendor:** आठ साल हो गए। Andheri में दो-तीन office हैं, एक hospital है, उनको देते हैं।

**Meera:** Okay, got it।

**Vendor:** मैडम, आप इंसान हो या computer बोल रहा है?

**Meera:** हाँ जी, मैं Autopilot Offices की AI assistant हूँ, बाकी बात हमारी team directly करेगी। आपका नाम क्या है?
> She never brings it up herself, but if asked directly she answers honestly in one line, then carries on.

**Vendor:** अच्छा अच्छा। नाम सुनील है।

**Meera:** ठीक है सुनील जी। इसी number पे WhatsApp है ना? Team details भेजेगी, आप company profile, GST certificate और rate लिख के भेज दीजिए।

**Vendor:** हाँ, यही WhatsApp है।

**Meera:** ठीक है जी, thank you। मैं details भेज देती हूँ।

**[Call ends. About 2 minutes 40 seconds.]**

---

## What our system writes down after this call

The call analyst reads the transcript and records only what the vendor said, each with a quote:

| Fact | Value | Vendor's own words |
|---|---|---|
| GST registered | yes | "हाँ हाँ, GST है" |
| First rate | ₹45 per jar | "पैंतालीस रुपये पड़ेगा" |
| Final rate | ₹41 per jar, delivery free | "इकतालीस कर देंगे, delivery free" |
| GST on rate | extra, 12% | "GST extra लगेगा... बारह percent" |
| Turnaround | 2 days to start, weekly | "दो दिन में start कर देंगे" |
| Experience | 8 years | "आठ साल हो गए" |
| Clients | two or three offices and a hospital in Andheri (no names) | "दो-तीन office हैं, एक hospital है" |
| Contact | Sunil | "नाम सुनील है" |

Price check: ₹41 is more than 5% above what we usually pay, so it is not "fair"; it most likely lands in "a little high" (the exact band depends on the price history in Zoho). The fixed scoring rules then rank him against the other vendors, and a person on the team decides.

---

## Things this example shows she still cannot do

- She said "मैं details भेज देती हूँ", but **nothing in the system sends that WhatsApp yet**. Someone from the team has to (see `INDUSTRY_READINESS_AUDIT.md`, Gap 1).
- If Sunil had said "अभी busy हूँ, चार बजे call करो", she would confirm 4 o'clock, but **no callback gets scheduled** (Gap 1).
- If he had asked "brand कौन सा चाहिए? Bisleri या local?", she can only say "ये मैं team से confirm करके WhatsApp पे बता देती हूँ", because she only knows the one-line requirement (Gap 6).
