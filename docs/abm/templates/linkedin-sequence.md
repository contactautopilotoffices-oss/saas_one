# LinkedIn sequence, Oppora

Campaign 15491, `ABM_Andheri`.
https://app.oppora.ai/campaigns-v2/15491/overview

Status: draft. Needs a LinkedIn account connected in Oppora before it can send.

Settings: 20 leads per day, stop tracking on reply, Do Not Contact list
respected.

Variables use single braces. `{first_name}` and `{company}` must never carry a
fallback value.

## Step 1, day 0, view profile

Step id 5566. Opens the lead's profile from the campaign's LinkedIn account.
They may see the visit, which is the point. No message.

## Step 2, day 1, connection request with note

Step id 5567. Max 300 characters.

```
Hi {first_name}, I run managed private offices in Andheri East. Reaching out because {company} is the kind of team we usually host. Happy to connect either way.
```

## Step 3, day 3, pitch message

Step id 5568. Delivered only to first degree connections, so this only fires
once the invite is accepted.

```
Thanks for connecting, {first_name}.

Quick context on what we do: we run fully managed private offices in Andheri East. Furnished, with internet, housekeeping and maintenance all handled, on flexible terms.

If {company} is thinking about a move, an expansion, or getting out of a coworking space in the next few months, I can share a couple of options with pricing. Worth a look?
```

## Step 4, day 7, follow-up nudge

Step id 5569. Sent in the same conversation thread.

```
Hi {first_name}, just following up on my note about managed offices in Andheri East. Should I send across a couple of options with pricing, or is now not the right time for {company}?
```

## Note

These send from a real personal LinkedIn profile, not a company page. Read the
copy before launching and change anything that does not sound like you.
