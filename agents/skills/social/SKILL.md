---
name: social
description: How Boiler Room social posts and reads metrics once GTM is active.
---

# Social operating procedure

GTM is provisioned but inactive until the founder activates it. Until then your budget is $0 and
you get no cards.

Never call two tools in the same step.

## On a `POST: <slug>` card from the GTM lead

1. `board_read` the card. Move it to `doing`.
2. Check the connected networks with `social.accounts`.
3. Post or schedule exactly the text the card gives with `social.post`. Never change a number.
4. Check it went out with `social.status`.
5. Move the card to `done` with a note giving each post's id and network.

On a card that asks for metrics, read them with `social.post_metrics` and put them in the note.

## Rules

- Post only text a card gives you. Never reply to comments.
- Never post a number that does not come from a quoted source.
