# Donation reminder messages

All 30 exact message bodies. `{name}` becomes the donor’s name; `{user}` becomes their name and Telegram handle when available.

## Private DM reminders — 15 variants

The original six DM variants are retained, followed by nine additions.

1. Ahoy {name}! 🏴‍☠️ PzP keeps sailing thanks to supporters like you. If you're able, a small donation this month keeps the crew going 💛
2. Hey {name} 🙏 just a friendly nudge — even ₹200 a month makes a real difference for PzP. Every bit helps keep things running!
3. {name}, the treasury could use a little wind in its sails ⛵ if you can chip in this month, we'd be hugely grateful. 🏴‍☠️
4. Hi {name}! 💛 your past support means a lot. A quick donation whenever you can keeps PzP afloat — no pressure, just gratitude.
5. {name} 🏴‍☠️ keeping PzP alive is a team effort. If this month allows, consider tossing a coin in the chest — thank you!
6. Hey {name} ⚓ a small monthly contribution goes a long way for PzP. Whenever you're ready, the crew appreciates you!
7. Ahoy {name} 🌊 a gentle reminder that your support helps cover PzP's running costs. If you can contribute, thank you for being part of the crew!
8. {name}, thanks for being here 💛 if you're able to support PzP again, you can make a donation in Sentinel whenever it suits you. No pressure.
9. Hey {name}! 🏴‍☠️ A little support from the crew keeps our shared ship moving. If now is a good time to chip in, we'd appreciate it.
10. Hi {name} ⚓ just checking in with your donation reminder. Any contribution you're comfortable with helps PzP keep going. Thank you!
11. {name} 💛 your support helps keep PzP's services running for everyone. If you have room to contribute, the donation page is ready in Sentinel.
12. Ahoy {name}! ⛵ If you'd like to add a little wind to PzP's sails, here's your gentle nudge. Give when you can, and thank you either way.
13. Hey {name} 🙌 a quick reminder about supporting PzP. Small contributions add up across the crew, and we're grateful for whatever you can manage.
14. {name}, a friendly wave from the crew 🌊 if a donation fits your plans, you can chip in through Sentinel. Thanks for helping keep PzP afloat!
15. Hi {name}! 🏴‍☠️ Your scheduled reminder is here. If you're in a position to contribute to PzP, we'd be grateful. It's always your choice. 💛

### Shared DM footer

First reminder:

> This is your first reminder — want these more or less often, or off? Set your preference anytime in your Profile → Donation reminders.

Later reminders:

> Change how often you get these in your Profile → Donation reminders.

These footers appear in italics after a blank line.

## Monthly group reminders — 15 variants

Every group reminder ends with a blank line and `#monthly`. Variant 1 retains the existing message; the updated bot starts with variant 2 to move away from that fixed wording.

1. 🏴‍☠️ Friendly monthly support reminder for {user} — we haven't received your expected monthly contribution yet. If autopay didn't go through, you can check it in Sentinel. No pressure, and thank you for keeping PzP sailing!
2. Ahoy {user}! ⚓ Your monthly contribution hasn't appeared in Sentinel yet. If you use autopay, it may be worth checking. Thank you for supporting PzP whenever you can. 💛
3. 🌊 A gentle monthly nudge for {user} — we're still waiting for your expected contribution to show up. You can review your payment in Sentinel whenever convenient. No pressure!
4. {user} 🏴‍☠️ a quick check-in from the crew: this monthly contribution isn't recorded yet. If you were expecting an automatic payment, please take a look in Sentinel. Thanks for your support!
5. 💛 Monthly reminder for {user}: we haven't seen your expected payment come through yet. A quick check in Sentinel can help if autopay missed it. Give when you can, and thank you!
6. Ahoy {user} ⛵ your expected monthly support hasn't reached the treasury yet. If you'd like to check the payment or contribute manually, Sentinel is ready. Always grateful, never any pressure.
7. ⚓ Friendly heads-up for {user} — your monthly contribution is still unrecorded. If autopay was meant to handle it, you can check the status in Sentinel. Thank you for being part of the PzP crew!
8. {user}, a little wave from PzP 🌊 we haven't recorded your expected monthly support yet. When you have a moment, you can review it in Sentinel. Your support is appreciated. 💛
9. 🏴‍☠️ Monthly check-in for {user}: the expected contribution hasn't shown up yet. If an automatic payment didn't complete, Sentinel is there to help you check. No rush, and thank you!
10. Hey {user}! 🙌 A gentle reminder that your monthly payment hasn't appeared in our records yet. You can take a look in Sentinel whenever it suits you. Thanks for helping PzP keep going!
11. 💛 A friendly treasury nudge for {user} — your expected monthly contribution hasn't been recorded. If you're using autopay, please check that it went through. No pressure; the crew appreciates you!
12. {user} ⚓ we're checking in because your expected monthly donation hasn't shown up in Sentinel. You can review your payment there when convenient. Thank you for keeping PzP afloat!
13. Ahoy {user}! 🏴‍☠️ It's time for a gentle monthly reminder: we haven't received the expected contribution yet. Check Sentinel if autopay needs attention, and contribute only if you're able. 💛
14. ⛵ Monthly support check for {user} — your expected payment is still missing from our records. A look in Sentinel may help you spot an autopay issue. Thank you for sailing with PzP!
15. {user}, here's your friendly monthly reminder 🌊 the expected contribution hasn't appeared yet. If you'd like to review it, open Sentinel whenever you're ready. No pressure, and thanks from the crew!

## Rotation

DM and group messages rotate independently. The bot saves channel and donor history in PostgreSQL, reserving variants atomically with each reminder claim. It skips a donor’s previous variant if the channel rotation lands on it. History survives restarts. The existing schedule and paid-month suppression remain in place.

Deployment requires the additive Prisma schema update before restarting the bot (`npm run db:push`; already included in `upgrade.sh`).
