# A&T Fence Restoration — SMS Workflow Messages

All messages are sent by "Amy" (VA's sales name). Delays are measured from when the customer enters that stage, unless noted otherwise.

**Quiet hours enforced on all delayed messages:** 6:00 AM – 10:00 PM CST only.

**Exit gate (proposal-driven stages):** The first message in Stages 5–8 waits until the customer has been off the proposal page for the specified minimum time before sending.

---

## Stage 1 — New Lead
*Triggered immediately when a new lead comes in.*

| # | Delay | Message |
|---|-------|---------|
| 1 | Immediately | Hey {first_name}, this is Amy with A&T's Pressure Washing & Fence Restoration. We just received your inquiry, thanks for reaching out to us! You likely saw us on an ad or in one of the home-improvement magazines. While we're working on your quote are there any questions you have for us or any more information you would like to add for us to create your quote? |
| 2 | 1 minute | Btw, this is a fence we just finished up nearby! *(+ before/after photo attached)* |
| 3 | 24 hours | Hey {first_name}, just checking back in! We really do want to make sure we give y'all the best estimate we can. Anything specific about your fence we should know about? |

---

## Stage 1b — New Build
*Triggered when the address is a new construction and Google Earth doesn't have imagery yet.*

| # | Delay | Message |
|---|-------|---------|
| 1 | Immediately | Hi {first_name}! We were checking out your address to measure your fence line through Google Earth and it looks like your home might be a newer build, it hasn't been fully updated on the map yet! No worries though. We have two easy options: you can send us a few photos of your fence so we can estimate from those, or we can do a quick free in-person measurement. Which one works better for you? |
| 2 | 24 hours | Hey {first_name}! Just circling back on this! We just need either some fence photos or to schedule a quick free visit so we can get your estimate put together. Which works best for you? |
| 3 | Day 2 | Hey {first_name}! Quick follow-up on your fence estimate. If snapping a few photos is easier, just send them right here in this text thread and we'll get your quote put together from those. Super easy! |
| 4 | Day 4 | Hi {first_name}, this is Amy! I know getting photos together can be a hassle so if you'd rather just have us swing by for a free 5-minute measurement, we're happy to do that too. Just let us know what works best for y'all! |
| 5 | Day 7 | Hey {first_name}, just one last follow-up from me! We'd really love to get your fence looking beautiful. Whenever you're ready, just send us some photos or let us know about scheduling a quick visit. We're here for you! - Amy |

---

## Stage 2 — Asking for Address / ZIP
*Triggered when we don't have the customer's address and need it to measure.*

| # | Delay | Message |
|---|-------|---------|
| 1 | Immediately | Hey {first_name}! So to get your free estimate put together, we actually measure your fence line through Google Earth. It's the only way we can get y'all an honest price since everything goes by square footage. We just need your home address and ZIP code to get that done. And I promise we won't just show up at your door, this is strictly for measuring! What's the best address for you? |
| 2 | 24 hours | Hey {first_name}, just circling back on this! We measure the fence through Google Earth so there's no site visit or anything like that. Just drop your address and ZIP and we'll have your estimate ready for you same day! |
| 3 | Day 2 | Hey {first_name}! Just wanted to check in one more time. We've got your estimate almost ready to go, we just need your address and ZIP to finish measuring. It literally takes us 5 minutes once we have it! |
| 4 | Day 4 | Hi {first_name}, this is Amy with A&T's. I know life gets busy so I just wanted to gently follow up! Whenever you get a chance, just text us your address and we'll get your free estimate right over to you. No rush at all! |
| 5 | Day 7 | Hey {first_name}, just one last little check-in from me! If you're still interested in getting your fence taken care of, we'd love to help. Just send your address whenever you're ready and we'll handle the rest. Wishing y'all all the best! - Amy |

---

## Stage 3 — Hot Lead (Send Proposal)
*Triggered when the VA approves the estimate. Proposal link sent immediately.*

| # | Delay | Message |
|---|-------|---------|
| 1 | Immediately | Hey {first_name}! Your personalized fence staining estimate is all ready for you! Check it out here: {proposal_link}. You can pick your package, color, and date all in one spot. Only takes a couple minutes! |

---

## Stage 4 — Proposal Sent (Follow-ups until opened)
*Follow-up sequence while the customer hasn't opened their proposal yet.*

| # | Delay | Message |
|---|-------|---------|
| 1 | 4 hours | Hey {first_name}! Just wanted to make sure your estimate came through alright. Here's the link again if you need it: {proposal_link}. And don't hesitate to reach out if you have any questions, we're happy to help y'all out! |
| 2 | Day 2 | Hey {first_name}, your fence estimate is still sitting here waiting on you! Honestly, most of our customers are surprised at how affordable a full restoration ends up being. Take a look when you get a chance: {proposal_link} |
| 3 | Day 4 | Hey {first_name}, good news, we've still got availability on the schedule for your area! Your estimate is ready whenever you are: {proposal_link} |
| 4 | Day 5 | Hey {first_name}! Still thinking it over? Totally get it! If you have any questions about the packages or what's included, just reply and I'm happy to walk you through it. We would love to take care of y'all! |
| 5 | Day 6 | Hey {first_name}, last little check-in from me! Your estimate is still right here whenever you're ready: {proposal_link}, Amy |
| 6 | Day 8 | Hey {first_name}! I know I've been reaching out a lot but I just don't want you to miss out. Your personalized estimate is still saved and ready for you: {proposal_link}. If you have any questions at all, I'm right here! - Amy |

---

## Stage 5 — No Package Selection
*Customer opened the proposal but didn't pick a package.*
*First message sends 20 minutes after customer leaves the proposal page.*

| # | Delay | Message |
|---|-------|---------|
| 1 | 20 min after leaving page | Hey {first_name}! I noticed you took a look at your estimate, that's awesome! A lot of our customers end up going with the Signature package because it includes a deeper clean, premium stain with more color options, and a longer-lasting finish. It's honestly the best bang for your buck! Need a hand deciding? Just holler and I'll walk y'all through it! |
| 2 | Day 1 | Just a heads up, our schedule tends to fill up pretty quick around your area! If you want to grab your spot, you can pick your package right here: {proposal_link} |
| 3 | Day 3 | We just wrapped up a fence near you and oh my goodness, it turned out so beautiful. Here's what some of your neighbors have been saying: {review_link}. Ready to get yours looking that good? {proposal_link} |
| 4 | Day 5 | Hey {first_name}, your estimate is still here for you but I'd hate for you to lose your spot. Is there anything I can answer to help you decide? I'm happy to help! |
| 5 | Day 6 | Hey {first_name}, is there anything at all I can help you with? I'm right here if you need me! |

---

## Stage 6 — Package Selected, No Color Chosen
*Customer picked a package but hasn't chosen a stain color yet.*
*First message sends 20 minutes after customer leaves the proposal page.*

### Entry Package
| # | Delay | Message |
|---|-------|---------|
| 1 | 20 min after leaving page | Great choice on the Entry package, {first_name}! Now let's get your stain color picked out. The Entry package comes in {entry_color_name}. I have attached an image of what it looks like below. Do you like this color or did you have something else in mind? Just let us know and we'll make sure you get exactly what you're looking for! *(+ Entry color chart attached)* |

### Signature Package
| # | Delay | Message |
|---|-------|---------|
| 1 | 20 min after leaving page | Oh I love that you went with the Signature package, {first_name}! Now let's pick your stain color. I have attached an image of the color options below. These are the most popular ones: {color_1} and {color_2}. Do you like any of these or do you have another color in mind? Just let us know, we want to make sure y'all get exactly what you're looking for! *(+ Signature color chart attached)* |

### Legacy Package
| # | Delay | Message |
|---|-------|---------|
| 1 | 20 min after leaving page | Excellent choice going with the Legacy package, {first_name}! You get access to our full premium color lineup. I have attached an image of all the color options below. Our most popular ones are {color_1} and {color_2}. Do you like any of these or did you have another color in mind? We want to make sure you get exactly the look you're going for! *(+ Legacy color chart attached)* |

### Shared follow-ups (all packages)
| # | Delay | Message |
|---|-------|---------|
| 2 | 4 hours | Hey {first_name}! Having trouble picking a color? I totally get it, there are some beautiful options! Just reply with your fence material like wood, cedar, or pine and we'll tell you what looks best on it! |
| 3 | Day 2 | Hey {first_name}! Once you pick your color we can get you right on the schedule. Which one are you leaning toward? I'm happy to help if you're stuck! |

---

## Stage 7 — No Date Selected
*Customer picked a color but hasn't chosen a service date yet.*
*First message sends 15 minutes after customer leaves the proposal page.*

| # | Delay | Message |
|---|-------|---------|
| 1 | 15 min after leaving page | Hey {first_name}! I see you picked your color, love it! You just haven't grabbed a date yet. We've got openings in your area next week if you want to snag one before they're gone! {proposal_link} |
| 2 | 4 hours | Quick reminder, scheduling only takes about 30 seconds! Pick a day that works for you right here: {proposal_link}. If none of the available dates work for you, just let us know and we'll see what we can do! |
| 3 | Day 2 | Heads up {first_name}, our {month} slots are filling up fast around your area. You might want to get your date locked in so you're not stuck waiting weeks! {proposal_link} |
| 4 | Day 4 | Hey {first_name}, this is Amy with A&T's Fence Staining. I just wanted to personally reach out and make sure we get you taken care of. Is there a certain timeframe that works best for y'all? If the dates you saw didn't work, just let me know and we'll figure something out! |
| 5 | Day 6 | Hey {first_name}! Did you have another date in mind that wasn't showing as available? We can sometimes work around the schedule if you let us know what works for y'all. Just reply with a date or timeframe and I'll see what I can do! |
| 6 | Day 7 | Hey {first_name}, just one more check-in from me! We'd really love to get your fence looking amazing. If there's anything holding you back, whether it's the dates, timing, or anything else, I'm here to help figure it out. - Amy |

---

## Stage 8 — Date Selected, No Deposit
*Customer picked a date but hasn't paid the $50 deposit to confirm the booking.*
*First message sends 15 minutes after customer leaves the proposal page.*

| # | Delay | Message |
|---|-------|---------|
| 1 | 15 min after leaving page | Awesome, {first_name}! Your date is set for {date}! To get it locked in, we just need a $50 deposit that goes right toward your total. Only takes a minute: {stripe_link}. Just so you know, your spot isn't officially confirmed until the deposit comes through! |
| 2 | 6 hours | Hey {first_name}! Just a quick reminder, your {date} appointment isn't locked in yet until that $50 deposit is completed. We would love to get you accommodated: {stripe_link} |
| 3 | Day 1 | We're holding your {date} slot for you but we can't hang onto it for too much longer. You can take care of your deposit right here: {stripe_link} |
| 4 | Day 2 | Hey {first_name}, just checking in, is there anything holding you up on the deposit? Whether it's timing, questions about the process, or anything else, I'm happy to help! Your {date} slot is still available: {stripe_link} |
| 5 | Day 3 | Hey {first_name}, this is Amy. Last check-in from me on this! Your {date} date is still unconfirmed and I just wanted to see how we can help. Is there anything we could do better or any questions about the deposit? We really want to make sure we get y'all taken care of. Just reply and let me know! - Amy |

---

## Stage 9 — Deposit Paid (Booking Confirmed)
*Triggered immediately when the $50 deposit is received.*

| # | Delay | Message |
|---|-------|---------|
| 1 | Immediately | You're all set, {first_name}! Your fence staining is officially confirmed for {date}! Our crew will be out there between 8 and 9 AM. We'll shoot you a text that morning to let you know we're on the way. If you need anything at all before then, don't be a stranger! |
| 2 | 6 PM the day before the job | Hey {first_name}! Just a friendly reminder, our crew will be at {address} tomorrow for your fence staining! Just make sure that gate is accessible and we'll handle everything from there. We can't wait to get y'all taken care of! |

---

## Stage 10 — Additional Service Price
*VA manually sends a custom price for any add-on services. Only the follow-up is automated.*

| # | Delay | Message |
|---|-------|---------|
| *(VA sends price manually)* | — | — |
| 1 | 24 hours | Hey {first_name}! Just checking back in on that additional service quote we sent over. Got any questions or are you ready to go ahead and add it on? Happy to help either way! |

---

## Stage 11 — Job Complete
*Triggered when the job is marked complete.*

| # | Delay | Message |
|---|-------|---------|
| 1 | Immediately | Hey {first_name}! I sure hope you are loving that new fence! If our crew did a good job for y'all, it would mean the absolute world to us if you could leave a quick Google review. Only takes about 30 seconds: {review_link} |
| 2 | Day 3 | Hey {first_name}! If any of your neighbors or friends ask about your fence, we would be so grateful for the referral! Anyone who books through you gets {referral_bonus}. Just reply REFER and I'll get you your personal link! - Amy |

---

## Stage 12 — Cold Lead Nurture
*Long-term follow-up sequence for leads who went cold and never booked.*

| # | Delay | Message |
|---|-------|---------|
| 1 | Week 2 (14 days) | Hey {first_name}! This is Amy with A&T's Fence Staining. Just wanted to check in on you and see if there's anything I can help with or any questions about your estimate? We're still here for y'all! |
| 2 | Month 1 (30 days) | Hey {first_name}! {season} is actually one of the best times to get a fence stained here in Houston. The wood soaks up the stain so much better and it lasts longer too. Your estimate is still on file whenever you're ready: {proposal_link} |
| 3 | Month 2 (60 days) | Hey {first_name}! We just finished up a fence in your area and oh my goodness, the transformation was just beautiful. Here's what one of your neighbors had to say: {review_link}. Your estimate is still here whenever you're ready: {proposal_link} |
| 4 | Month 3 (90 days) | Hey {first_name}! This is Amy with A&T's. We've got a little something special going on this month, {incentive}. Your estimate is still on file if you'd like to take advantage: {proposal_link} |
| 5 | Month 4 (120 days) | Hey {first_name}! Just thinking about you and wanted to check in. How's that fence holding up? Whenever you're ready to get it taken care of, I'm right here for you! - Amy |
| 6 | Month 6 (180 days) | Hey {first_name}, this is Amy with A&T's. I don't want to keep bothering you so this'll be my last little message. If you ever decide you're ready to get that fence looking beautiful again, we would just love to help. Your estimate will always be on file for you. Wishing y'all all the best! - Amy |

---

## Stage 13 — Past Customer Nurture
*Re-engagement sequence for customers who already had their fence done.*

| # | Delay | Message |
|---|-------|---------|
| 1 | Month 1 (30 days) | Hey {first_name}! Hope you're still just loving that fence! Quick little reminder, if you refer a friend or neighbor and they book with us, y'all both get {referral_bonus}! Just reply REFER and I'll send you your personal link. - Amy |
| 2 | Month 3 (90 days) | Hey {first_name}! This is Amy with A&T's, just checking in on you! How's that fence looking? Houston weather can really do a number on stain so just holler if you ever need a touch up! |
| 3 | Month 11 (~330 days) | Hey {first_name}! Can you believe it's been almost a year since we stained your fence? Most fences here in Houston need a fresh coat every 2 to 3 years to stay nice and protected. Want us to take a look and get you a renewal estimate? - Amy |
| 4 | Month 12 (~360 days) | Hey {first_name}! Just following up on that renewal estimate. We're booking out fast this season and I'd hate for you to miss out on a good spot. Want me to pull up your file? - Amy |
| 5 | Month 23 (~690 days) | Hey {first_name}! It's been about 2 years since we did your fence, and that's right around when most Houston fences start showing a little wear. Want us to get you a fresh estimate put together? We've still got all your info on file! - Amy |
| 6 | Month 24 (~720 days) | Hey {first_name}! Just making sure you saw my last message about your fence renewal. Let me know if you'd like us to put together an updated estimate for you, we'd love to take care of y'all again! - Amy |

---

## Summary: How Sending Works

| Stage | First Message Timing | Exit Gate | Goes Through Queue? |
|-------|---------------------|-----------|---------------------|
| New Lead | Immediately | — | No (fires instantly) |
| New Build | Immediately | — | No (fires instantly) |
| Asking Address | Immediately | — | No (fires instantly) |
| Hot Lead | Immediately | — | No (fires instantly) |
| Proposal Sent | 4 hours | — | Yes |
| No Package Selection | 20 min after leaving page | 20 min | Yes |
| Package Selected | 20 min after leaving page | 20 min | Yes |
| No Date Selected | 15 min after leaving page | 15 min | Yes |
| Date Selected | 15 min after leaving page | 15 min | Yes |
| Deposit Paid | Immediately | — | No (fires instantly) |
| Additional Service | N/A (VA manual) | — | N/A |
| Job Complete | Immediately | — | No |
| Cold Nurture | Week 2 | — | Yes |
| Past Customer | Month 1 | — | Yes |

**Queue rules:**
- All queued messages respect quiet hours: only delivered 6:00 AM – 10:00 PM CST
- Stages 5–8 (proposal-driven) have a per-stage exit gate — the first message won't send until the customer has been off the proposal page for that minimum time
- If a lead advances to the next stage before a queued message sends, those pending messages are automatically cancelled
