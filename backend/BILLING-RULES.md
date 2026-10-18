# ProWorld Academy — Billing rules (v2026-10-18)

The machine-readable version is `billing-rules.json`; the backend page carries the same rules in its `BILLING` constant and shows them under **Players & billing → Billing rules**, with the break calendar and a proration calculator.

## The rules

1. **Everyone bills on the 1st.** Every monthly plan is charged on the 1st of the month, for that month, to the card on file. One date for all families.
2. **Mid-month start → prorated to the 1st.** A player who starts on the 13th pays, at sign-up, only the remaining training days of that month; from the next 1st, the full price.
   `charge = monthly price × remaining training days ÷ weekdays in the month` (rounded to the dollar).
3. **Break weeks are not program weeks.** Thanksgiving week, winter break, spring break and summer are skipped. A month touched by a break is billed `monthly price × training days in the month ÷ weekdays in the month`. June and July have no regular tuition. Camps in break weeks are separate purchases.
4. **Families are told before a break month.** On the 25th of the month before, the family gets the exact amount and why (template below).
5. **Late.** Due on the 1st. Not paid by the **5th** → **$50 late fee** on the 6th. Not paid by the **10th** → training pauses until paid. Not paid by the **15th** → enrollment cancelled and the spot released; coming back means paying the balance (fee included) and re-enrolling, prorated from the return date. Card retries and "update your card" reminders run automatically in between.
6. **Cancel or change any time before the 1st.** From the family account or the front desk; it takes effect at the end of the month already billed (no refund of that month). Plan changes are prorated the same way as a start.
7. **One-time items are charged when booked**, never on the 1st: drop-ins, flex packs, lesson packages, private lessons (paid in advance, 12-hour cancellation), camps, court reservations, weekly plans (per week booked). Unbooked attendance is charged at the drop-in rate; late pick-up is $30 per 30 minutes.

## Training-day calendar 2026–27 (School District of Palm Beach County)

Terms: **Fall 2026** Aug 10 – Dec 18 · **Spring 2027** Jan 5 – May 27.
Breaks: Thanksgiving Nov 23–27 · Winter Dec 21 – Jan 4 · Spring Mar 22–26 · Summer May 28 – Aug 8.
Single school holidays (Labor Day, Sep 21, Oct 12, Nov 3, Veterans Day, MLK Day, Presidents' Day, Mar 10, Mar 29) are regular training days unless added to `closed_days`.

| Month | Training days | Billed | Example: Afterschool 3 days ($980) |
|---|---|---|---|
| Oct 2026 | 22 of 22 | full | $980 |
| Nov 2026 | 16 of 21 | 76% — Thanksgiving week off | $747 |
| Dec 2026 | 14 of 23 | 61% — last training day Dec 18 | $597 |
| Jan 2027 | 19 of 21 | 90% — first training day Jan 5 | $887 |
| Feb 2027 | 20 of 20 | full | $980 |
| Mar 2027 | 18 of 23 | 78% — spring break off | $767 |
| Apr 2027 | 22 of 22 | full | $980 |
| May 2027 | 19 of 21 | 90% — last training day May 27 | $887 |
| Jun–Jul 2027 | 0 | no tuition — summer camps separate | $0 |
| Aug 2027 | set when the 2027–28 school calendar is published | | |

Worked examples (Afterschool 3 days, $980): start Oct 13 → $624 today (14 of 22 training days), then $747 on Nov 1, $597 on Dec 1, $887 on Jan 1, $980 on Feb 1. Start Dec 13 → first session Dec 14, $213 today, then $887 on Jan 1.

## Messages to families

**Break-month notice** (email + text, the 25th before the month)
> Subject: {{Month}} tuition for {{player}} — prorated for {{break}}
> Hi {{parent}}, the academy pauses for {{break}} ({{break dates}}), so {{player}}'s {{Month}} tuition is **${{amount}}** instead of ${{full price}} ({{training days}} of {{weekdays}} training days). It will be charged to your card on file on {{Month}} 1. Want {{player}} on court that week? {{camp name}} is open for booking separately: {{camp link}}. Questions: reply to this email or call the front desk at +1 (561) 403-0008. — ProWorld Academy

**Welcome / first charge** (email, at sign-up)
> {{player}} is enrolled in {{program}}, {{plan}}. Today's charge: **${{amount}}** — {{Month}} tuition for {{training days}} of {{weekdays}} training days. From {{next 1st}}, ${{monthly price}} on the 1st of every month (prorated in months with a school break). Manage your card or plan any time: {{portal link}}.

**Payment failed** (email + text, the 1st and each retry)
> We couldn't charge your card on file for {{player}}'s {{Month}} tuition (${{amount}}). Please update your card here: {{portal link}}. We'll retry automatically; after the 5th a $50 late fee applies.

**Late fee** (the 6th)
> {{player}}'s {{Month}} tuition (${{amount}}) is still unpaid, so a $50 late fee has been added. Pay or update your card here: {{portal link}}. Training pauses on the 10th if the balance is still open.

**Training paused** (the 10th)
> {{player}}'s training is paused until {{Month}} tuition and the late fee are paid (${{balance}}). Pay here: {{portal link}} — the spot is released on the 15th.

**Enrollment cancelled** (the 15th)
> {{player}}'s enrollment in {{program}} has been cancelled for non-payment and the spot released. To come back, pay the balance (${{balance}}) and re-enroll — the front desk will prorate from the return date.

## How Stripe implements it (phase 2)

- Monthly plan = Stripe subscription anchored to the 1st (`billing_cycle_anchor_config.day_of_month = 1`, no automatic proration). The first partial month is a one-time invoice item computed with rule 2 and charged at sign-up.
- Break months: on the 25th a scheduled function adds a credit line ("Winter break credit — Dec 21–31") to the family's upcoming invoice and sends the break-month notice. Months with no training days pause collection.
- Late policy: on the 6th a one-off "Late fee" invoice is charged; on the 10th the player is flagged on hold (attendance shows it); on the 15th the subscription is cancelled and the spot released.
- Families update cards, see receipts and cancel through the Stripe Customer Portal; the front desk sees everything on the Players & billing tab.
