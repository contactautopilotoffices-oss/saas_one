# Message library

Four personas, four channels. The persona is set at intake from the job title
and stored in `abm_leads.persona`.

| Persona | Titles that map to it | What they actually care about |
|---|---|---|
| `founder` | Founder, Co-founder, CEO, MD, Director, Chairman | growth, speed, not being locked in |
| `admin` | Admin Head, Facilities, Office Manager, Operations | the daily burden: housekeeping, vendors, repairs |
| `hr` | HR Head, People, Talent, Culture | commute, hiring, how the office looks to candidates |
| `finance` | CFO, Finance Head, Controller, Accounts | capex versus opex, deposit, predictable monthly cost |

---

## WhatsApp, via AiSensy

WhatsApp is not free text. Meta has to approve a fixed template, and the only
thing that changes per lead is the numbered variables. So personalisation is
done by passing a persona-specific clause into `{{3}}`, not by writing a new
message each time. Three templates cover the whole 14 days.

Meta rejects templates with two variables touching each other, so every
variable has fixed words on both sides. Do not reword these without checking
that.

### Template 1: `abm_intro_v1`  (Day 2)

Category Marketing, language English.

```
Hi {{1}}, this is Veer from Autopilot Offices.

We run fully managed private offices in Andheri East. Furnished and ready to move into, with internet, housekeeping and maintenance all handled, on flexible terms.

I am reaching out because {{2}} is {{3}}.

Would it help if I shared two or three options with pricing?
```

Buttons: `Yes, share options` and `Not right now`

| Variable | Source | Example |
|---|---|---|
| `{{1}}` | `first_name` | Pranesh |
| `{{2}}` | `company` | Brandscapes Worldwide |
| `{{3}}` | `why_now`, written per lead at intake | hiring across several roles right now |

Sample values for Meta approval: `Rahul`, `Acme Tech`, `hiring across several roles right now`.

**Writing `{{3}}`.** It has to read naturally after "is". Keep it under about
12 words, lower case, no full stop. Good ones by persona:

- founder: `hiring across several roles right now`, `growing quickly after a recent raise`, `still working out of a coworking space`
- admin: `managing its office upkeep in house at the moment`, `running three separate vendor contracts for one floor`
- hr: `hiring in Andheri and competing on commute`, `bringing people back to office more days a week`
- finance: `carrying a large security deposit on its current space`, `paying for more square feet than it uses`

### Template 2: `abm_followup_v1`  (Day 8)

```
Hi {{1}}, following up on my note about managed offices in Andheri East.

If the timing is not right I will leave it there. If it is, I can send a short list of options for {{2}} with pricing and availability.
```

Buttons: `Send me options` and `Not right now`

### Template 3: `abm_final_v1`  (Day 14)

```
Hi {{1}}, last note from me on this.

If {{2}} starts looking at office space later this year, keep us in mind. We are in Andheri East, fully managed, flexible terms. I will stop messaging here.
```

Buttons: `Keep me posted` and `Remove me`

`Remove me` writes the lead to the DNC list and they are never contacted again
on any channel.

---

## LinkedIn, via Oppora

Free text, so this is where real personalisation happens. Variables use single
braces. Never put a fallback on `{first_name}` or `{company}`.

### Day 1, connection request (max 300 characters)

**founder**
```
Hi {first_name}, I run managed private offices in Andheri East. Reaching out because {company} is the kind of team we usually host. No pitch, happy to connect either way.
```

**admin**
```
Hi {first_name}, I work with admin and facilities teams in Andheri East on fully managed office space. Thought it was worth connecting given what you handle at {company}.
```

**hr**
```
Hi {first_name}, I run managed offices in Andheri East and spend a lot of time on what makes an office work for the people in it. Would be good to connect with someone doing that at {company}.
```

**finance**
```
Hi {first_name}, I run managed private offices in Andheri East, mostly for teams who would rather not tie up capital in a deposit and a fit-out. Happy to connect.
```

### Day 3 to 5, first message, only after they accept

**founder**
```
Thanks for connecting, {first_name}.

Quick context: we run fully managed private offices in Andheri East. Furnished, internet, housekeeping and maintenance handled, on terms that flex as headcount moves.

The reason I reached out is that {company} looks like it is in a growth patch, and that is usually when a fixed lease becomes the thing holding you back rather than the thing protecting you.

If a move, an expansion or an exit from coworking is anywhere on the horizon, I can send two or three options with real pricing. Worth a look?
```

**admin**
```
Thanks for connecting, {first_name}.

We run fully managed private offices in Andheri East. The reason I mention it is that "managed" means something specific here: housekeeping, maintenance, internet, security and the vendor chasing that goes with them all sit with us, not with you.

Most admin heads I speak to are running five or six separate contracts for one floor. If that sounds like {company}, I can show you what the same space looks like as a single monthly invoice.
```

**hr**
```
Thanks for connecting, {first_name}.

We run fully managed private offices in Andheri East, and the part that tends to matter most to HR is the bit nobody puts in a brochure: the commute, whether the space makes a candidate say yes, and whether people actually want to come in.

Andheri East works for a lot of teams on that first point, being close to the metro and the highway both.

If {company} is hiring or rethinking office days, happy to show you two or three options.
```

**finance**
```
Thanks for connecting, {first_name}.

We run fully managed private offices in Andheri East. The reason I am reaching out to you rather than to ops is that the case is mostly a financial one.

A conventional lease means a large deposit, a fit-out spend and a long commitment. We are a single monthly figure that covers rent, furniture, internet, housekeeping and maintenance, with terms that flex.

If {company} is anywhere near a renewal or a move, I can put the two side by side on a page. Useful?
```

### Day 8, follow-up (all personas)

```
Hi {first_name}, following up on my note.

If office space is not on the table for {company} right now, say so and I will leave it. If it might be in the next few months, I will send a short list with pricing so you have it when you need it.
```

### Day 14, final (all personas)

```
Hi {first_name}, I will stop here so I am not cluttering your inbox.

If {company} looks at space in Andheri East later on, we are easy to find. Good luck with the rest of the year.
```

---

## Day 4 to 6, the call

Pulled from `v_abm_call_list`. Anyone who replied is at the top, then HOT
leads on day 4 to 6. `call_opener` is written per lead at intake.

**Opening**

> Hi {first_name}, Veer here from Autopilot Offices. Is this a bad moment?
>
> I sent you a note on WhatsApp about managed offices in Andheri East. Reason I called rather than kept typing: it takes two minutes to work out whether this is even relevant to you.

**The three questions.** Same three the bot asks, so nothing is asked twice.

1. How many seats would you be looking at?
2. When would you be looking to move?
3. Which area works best for your team?

**If it is relevant:** book the site visit on the call. Do not offer to email
first. "I will hold a slot for Thursday at 11, does that work?"

**If it is not:** ask whether to check back in a few months, then mark the
outcome. If they say no outright, that is a DNC, not a "later".

---

## When a lead replies

The bot asks the same three questions, in one message, on whichever channel
they replied on:

```
Great. Three quick things so I send you the right options and not a brochure:

1. How many seats?
2. When are you looking to move?
3. Which area suits your team best?
```

Answers land in `q_seats`, `q_move_date` and `q_preferred_area`, and the lead
moves to the call list for a BD associate.

---

## Rules that apply to every message

1. Never message anyone on the DNC list. The database blocks this, but do not
   work around it manually either.
2. "Not interested" is permanent and applies across all channels.
3. One reply stops every other channel for that person.
4. Nobody gets more than three WhatsApp messages or four LinkedIn touches in
   the 14 days.
5. If no reply by day 14, stop and park for 60 days.
