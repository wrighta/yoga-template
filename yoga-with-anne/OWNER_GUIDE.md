# Owner Guide - running Yoga with Anne

Welcome! This is the only document you need for day-to-day running. Everything happens in your **admin area** at `yourwebsite.ie/admin` (sign in with the email and password you set up - see "Signing in" below). Nothing here requires a developer.

---

## Every week

### The two admin pages for classes
- **Schedule** - what's coming up. Defaults to showing your **blocks** (what most teachers sell); a toggle switches to **individual classes**. Cancelled and past classes are hidden - use the "Show cancelled & past" link when you need them.
- **Create classes** - everything you create, in one place: blocks, workshops, bundles, recurring schedules, and single classes. Choose **Save draft** to keep an offering private, or **Publish** when it is ready for the website. Drafts stay visible in your admin schedule but are not listed or bookable publicly.

### See what's coming
Open **Dashboard** after signing in. It shows the next class, how many places are booked, tonight's register link, recent bookings, revenue this month, and any pass expiring soon.

### Print tonight's register
**Schedule** → switch to **Individual classes** → find the class → **Manage** → **Print register**. It prints names, phone numbers, a paid column and a tick box. Keep paper copies safe and shred them after a few weeks.

### Take attendance
**Schedule** → **Individual classes** → **Manage** the class → in the register table press **Attended** or **No-show** for each person. This keeps "Earlier bookings" accurate in people's accounts.

### Emergency contact list
Every class register now has a **"Copy all phone numbers"** button - one click copies every attendee's mobile so you can paste them into a WhatsApp group or text when a class has to move. The **Export CSV** beside it includes phones too. Students must give a mobile number when they book online or join a waitlist, so you can always reach them.

### Add someone who texts/WhatsApp'd you
**Bookings** → **Add a booking (phone / WhatsApp)**: pick one class date, enter their details, choose how they're paying (cash, transfer, complimentary), and save. For a term enrollment, use **Add a whole block or bundle** instead; one entry books them into every date. The booking is only added if every date has space. They get a normal confirmation email. Choose **Pay at class** to record cash due at the next class, or record a transfer/previous payment.

For a Workshop or Retreat group, use **Add a Workshop or Retreat group**: enter the payer's contact details and one attendee name per line. The system reserves every place together and prevents adding a group larger than the remaining capacity. For date-span events, put the itinerary in the event description; the public page shows the start and end dates.

### Transfer a cancelled Workshop or Retreat booking
Cancel the event from its class-management page first. Then open **Bookings**, find the cancelled group booking, and choose **Transfer group to another workshop/retreat**. Select a future published event of the same type and confirm the attendee names. If the replacement costs more, record the extra cash/transfer payment only after it has been received. If it costs less, use **Refund difference** on the booking row; Stripe refunds require Stripe to be connected, and the balance stays visible until recorded. No stored card is charged for a transfer.

---

## Appearance (your colours)

**Appearance** in the admin menu lets you match the website to your own branding: pick one of seven curated colour palettes, including Forest & Tangerine and Pine & Coral, and optionally add a custom accent for buttons, links and highlights. Use **Preview homepage** to see unsaved colours on the real homepage in a new tab; this does not change the live site. Press **Save colours** when ready. Curated palettes keep every page readable.

## Photos

**Photos** stores the image library. You can upload there, or use **Browse and upload photo** inside an image picker to upload and select in one step. Images are resized automatically; keep each photo under 4 MB and add alt text describing it. Until photos are added, the site uses a palette-colored illustration.

## The schedule

### Add a new weekly class series
**Schedule** → **Create a recurring series**: give it a title, tick the days (Tue/Thu are pre-ticked), set times, choose how far ahead to generate classes, set capacity, a special price if needed, and **skip dates** for holidays (e.g. `2026-10-27, 2026-10-29`). Choose **Save draft** or **Publish schedule**. Future dates generated for a draft series stay hidden until the series is published.

### Keep the calendar full
**Schedule** → **Recurring series** → open your series → **Fill the calendar forward**: pick a date range and press Generate. Dates that already exist are never duplicated.

### Change a series safely
The series controls only affect **future** dates it generates - existing classes and bookings are never rewritten. Retire a series (stops generating new dates) or duplicate it if you want a variation for a new term.

### Change or cancel one date
**Schedule** → **Manage** that date. You can rename it, move the time, change capacity, add a note students will see (e.g. "bring a blanket tonight"), or a private note only you can see. Changes affect **that date only** - the rest of the series keeps its own settings.

**Cancelling a class** emails everyone booked and cancels their places automatically; you then arrange refunds/credits from the **Bookings** page.

### Holidays / breaks
Either cancel individual dates as above, or use **Settings** to turn off checkout and add a homepage announcement ("Back Tuesday 6 January!") while you're away.

---

## Blocks & bundles (sell a term of classes in one click)

**Schedule → Class blocks**: a block sells a set of weekly dates for **one price** - the student clicks once, pays once, and is booked into every date.

- **Create a block**: pick the weekly series, name it (students see this name), choose first/last class date, which evenings it covers (e.g. Tuesdays only, or Tue+Thu), and the price for the whole block. Choose **Save draft** or **Publish block**. A published block appears on the public classes page.
- **Re-advertise later**: if the block doesn't fill, change the first date and drop the price - e.g. an 8-week block becomes a "6-week block, €60". Earlier buyers keep their original places and price; only new buyers see the new offer.
- **Bundles (multi-save)**: combine two or more blocks under one bulk price - e.g. Tue block €80 + Thu block €80 → "Full programme" €150. Choose **Save draft** or **Publish bundle**; every included block must be published before its bundle can be published. Buying the bundle books every date of both blocks. Blocks stay separately bookable too.
- Block and bundle bookings are **non-refundable** (the terms are shown to students before they pay). You can still cancel on a student's behalf from their booking - the money is then flagged for refund as usual.

The public block card summarizes its start/end dates, duration, all weekly meeting days, time, location, and total block price. For retreats, the event form defaults to one shared start/end time for each day. Turn on **Different start and end times each day** to enter a separate time range for every date; the public event detail displays that schedule while the retreat remains one bookable event.

## Money and pricing

### Change a price
**Pricing** → **Standard drop-in price** (the default per-class price) or edit any pass/membership on the same page. Changes apply to new bookings instantly; past orders keep the price they paid.

### Optional multi-date discount
**Settings** → **Multi-date drop-in discount enabled** controls whether booking 2–4 separate dates gets an automatic lower per-class rate. It is off by default; when enabled, **Pricing** → **Multi-date discount rule** controls the price. Use the pricing simulator before changing the rule.

### Optional class passes
Class passes are off by default. **Settings** → **Class passes enabled** turns them on for this site. When enabled, **Pricing** → **+ Create a new pass or membership** lets you set the name, price, credits, and validity. Customers buy credits and book each class date separately. Existing credits remain usable while new pass sales are disabled.

### Create a membership
**Settings** → **Memberships enabled** controls whether memberships appear for this site. When enabled, use **Pricing** → **+ Create a new pass or membership** to configure them.

### Coupon codes
**Pricing** → **Coupon codes**: percent-off or euro-off, optional usage limit. Customers enter the code at checkout; discounts never stack - the system always gives whichever single option is cheapest for the customer and shows what it applied.

### Refunds
**Bookings** → find the booking → **Refund** next to their Stripe payment (only when Stripe is connected; refunds go back to their card). For offline payments just record a note. Cancelled online bookings are flagged so you don't miss them.

---

## Waitlist

When a class is full, people can join the waitlist (no payment taken). If someone cancels, **the first person is emailed automatically** with a claim link that expires after the hours you set (default 2). **Waitlist** shows every queue and lets you nudge the next place manually.

---

## Your website content

**Content** edits the words on the live site: homepage headline, service heading and supporting text, About page, FAQs, testimonials, and legal pages. Its **Homepage layout** controls let a Super Admin hide or reorder prepared sections. **Hero buttons** controls let you change each button's label, destination (including a published custom page), or visibility. Service modules also link to published custom pages.

**Pages & menus** is a Super Admin setup area. It creates custom pages from prepared sections and controls which links appear in the header/mobile menu or footer. Save a page as a draft to keep it private; publish it when ready. Draft page links stay hidden from the public menus.

- **Testimonials** only appear on the site once you've published them - only ever add real ones, with the person's permission (there's a consent note field).
- **About page**: write your own biography. Add qualifications only when they're real and you're happy to display them - the section stays hidden while empty.
- **Legal pages** (privacy, cookies, booking terms, website terms) start as clearly-marked drafts that are hidden from the public. Edit them, have them checked, then press **Publish live**. The booking terms are the ones customers accept at checkout.

### Announcement bar & going quiet
**Settings** → **Homepage announcement** shows a bar across the top of every page (great for "Christmas break - back Jan 6!"). Leave it empty to hide it.
- **Turn off checkout** pauses new online bookings but keeps the site visible.
- **Maintenance mode** replaces the public site with a short notice (admin stays available).

---

## Emails

**Messages** shows every email the system sent (or, before you connect an email provider, *would* have sent - they're safely captured there instead). Confirmation, reminders, cancellations, waitlist offers and receipts all live here. There's nothing to send manually: reminders go out automatically before class (timing in **Settings**), or press **Run reminders & jobs now** on the Dashboard to fire them immediately.

To send real email, connect a Resend account (see `DEPLOYMENT.md`) - templates stay editable here.

---

## Customers & privacy

**Customers** lists everyone who has booked or subscribed, with their bookings, passes and membership status. From a customer's page you can add or remove pass credits (a reason is required and audited).

If someone asks you to delete their data (**GDPR** - you must comply within 30 days): open their page → **Anonymise this customer** (type ANONYMISE to confirm). Their name, phone, email and consent are erased; only anonymous history for your accounts remains. To hand someone their data, export the CSVs from **Customers** / **Bookings** and email them.

Marketing consent: only people who ticked the box are on the newsletter export; everyone else can still be contacted about classes they booked.

---

## Launch readiness

**Launch readiness** (in the admin menu) is a live checklist of everything the website needs before - and after - go-live: payment setup, email, legal pages, photos, contact details, backups, and more. Green means done, amber means worth doing, red means fix before launch. Each item links straight to the screen that fixes it. Check it once before launch, then occasionally.

## If something goes wrong

- **Download a backup**: Admin → **Launch readiness** → "Download backup now". Keep the file somewhere safe (email it to yourself).
- Restoring from a backup is a job for your developer or host - never a casual click.

## Settings reference

| Setting | What it does |
| --- | --- |
| Business name, phone, WhatsApp greeting | Shown across the site and in emails |
| Cancellation cutoff (hours) | How close to class a student can still self-cancel for a refund/credit |
| Checkout hold (minutes) | How long someone's places are reserved while paying |
| Class reminder (hours before) | When reminder emails go out |
| Waitlist offer expiry (hours) | How long a freed place is held for the first person in the queue |
| Standard drop-in price | Default price for any class without its own override |
| Change password | Please do this after your very first login |
| Class types / Venues / Instructors | Full editing of what you teach, where you teach it, and who teaches - including photos and accessibility notes |
| Class passes enabled (Settings) | Off by default. On: customers can buy class credits and book dates separately. Per-install choice. |
| Multi-date discount enabled (Settings) | Off by default. On: separate class dates can receive an automatic per-class rate. Per-install choice. |
| Memberships enabled (Settings) | Off by default. On: monthly/annual memberships appear on the Prices page. Per-install choice. |
| Appearance | Seven curated colour palettes + custom accent colour, applied site-wide after preview and save |

---

## If something looks wrong

- A booking is missing? Check **Bookings** (search by name/email) - it may be a pending checkout that timed out; places re-release automatically after 10 minutes.
- The site says "checkout paused"? That's the **checkout enabled** toggle in Settings.
- Anything else: `QA_REPORT.md` (for the technically minded) or your developer.
