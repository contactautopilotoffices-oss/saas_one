# WhatsApp templates, AiSensy

AiSensy can only send templates Meta has approved. Create the template first,
then an API campaign that points at it, then set that campaign Live. The Make
scenarios call the campaign by name, not the template.

Both templates use two quick reply buttons:

- `Yes, share options`
- `Not right now`

## andheri_intro

Category Marketing, language English.

Variables: `{{1}}` first name, `{{2}}` company. Sample values for approval:
`Rahul` and `Acme Tech`.

```
Hi {{1}}, I'm reaching out from Autopilot Offices.

We run fully managed private offices in Andheri East: furnished, internet, housekeeping and maintenance all handled, on flexible terms.

If {{2}} is planning to move, expand or get out of a coworking space in the next few months, I'd be happy to share a few options.
```

Sent by Make scenario 1, hourly, to HOT and WARM leads with a phone number and
an empty WhatsApp status.

## andheri_followup

Category Marketing, language English.

Variables: `{{1}}` first name only. Sample value `Rahul`.

```
Hi {{1}}, just following up on my last message about managed offices in Andheri East. Should I send a couple of options with pricing, or is now not the right time?
```

Sent by Make scenario 2, daily at 11:00, to leads whose intro went out at least
six days ago who have not replied and have no follow-up status yet.

## On wording and location

The copy names Andheri East because that is the building being pitched. The
targets themselves can be anywhere in Mumbai, since the point is to find
companies who would want an office in Andheri, not companies already there.

Each campaign records which office it pitched in the sheet's `Target_Office`
column, so the same machinery works for Powai or BKC by swapping the copy and
creating new AiSensy templates for that location.
