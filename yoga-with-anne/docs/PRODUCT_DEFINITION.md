# Yoga Business Website and Booking System

**Status:** Product definition draft based on owner discussions, 6 October 2026.

## Product Direction

A configurable website and booking system for independent yoga teachers and small yoga businesses. Each business receives a separate application installation and database. The businesses do not share customer, booking, media, or settings data. One maintained codebase is used to deliver improvements to each installation.

The first installation is for one teacher-owner, usually the only person operating the business. This is not a multi-tenant SaaS application.

## Users and Permissions

### Platform Super Admin

The product operator and web developer configures each business's website, including:

- Pages, reusable page sections, primary and secondary menus, and homepage composition.
- Permanent service and class-style pages, descriptions, and imagery.
- Site appearance, branding, and shared site settings.
- Integrations and deployment-level configuration.
- Optional product features, including class passes and multi-date drop-in discounts, each disabled by default.

### Teacher-owner

The teacher-owner operates the yoga business and can:

- Create and manage classes, blocks, bundles, workshops, and retreats.
- Save offerings as drafts or publish them. Published offerings enter their appropriate public listings automatically.
- Manage bookings, student contact details, attendance, cancellations, and revenue.
- Set offering prices, manage pricing, issue refunds, and record offline payments, subject to the business's configured payment options.
- Add a booking from a phone or message for one class date or for a whole block or bundle.

The teacher-owner does not manage website pages, menus, homepage structure, themes, integrations, or deployment configuration. Class-style pages are maintained by the Super Admin; teachers choose an existing style when creating an offering and request additions when needed.

Super Admin authentication is per installation. There is no central identity service across teacher sites.

## Offerings and Booking Rules

| Offering | First-version behavior |
| --- | --- |
| Drop-in class | Customer books one scheduled class date at the standard drop-in price. |
| Class block | One booking covers a defined set of dates at one total price. |
| Multi-block bundle | One purchase covers two or more blocks at one bundle price. |
| Workshop | One-off or date-span event sold at one stated price per person. The event description contains the itinerary. Multiple attendee places may be purchased together. |
| Retreat | One date-span event sold at one stated price per person. The event description contains the itinerary; no daily session times are implied. Multiple attendee places may be purchased together. |
| Private session or party workshop | Enquiry/contact option only; no online time-slot booking in the first version. |

For group workshop and retreat bookings, one person pays for the order and provides contact details; the payer separately supplies a name for each attendee. The number of places purchased must be deducted from event capacity. A retreat may use the same daily start/end time throughout or explicit times for each date; this schedule is descriptive and does not split the retreat into separately bookable sessions. Multi-attendee booking for drop-ins, blocks, and bundles is deferred; a regular class customer sees a one-person booking flow.

Teacher-entered bookings must support individual class dates, whole blocks/bundles, and event groups. Payment can be recorded as pay-at-class, cash, bank transfer, complimentary, or already paid, as appropriate. Manual bookings must reserve the same capacity as online bookings.

Class passes and automatic multi-date drop-in discounts are per-installation options, both off by default. Most teachers use the standard drop-in price, with blocks and bundles as the combined-price offers. If Super Admin enables class passes, customers buy credits and book each class separately. Turning pass sales off hides new purchases while preserving credits customers already own.

## Publication and Discovery

Public block summaries show the actual included weekdays and recurring time, first and last class dates, calendar-week duration, total price, and location. They do not present an inferred single weekday or per-class estimate as the headline price.

- Publication state applies consistently to individual scheduled classes, recurring series, blocks, bundles, workshops, and retreats. Creation presents separate **Save draft** and **Publish** actions; the teacher-owner can publish without Super Admin approval.
- Only published, current offerings can be booked or shown as available publicly.
- Publication controls visibility; on-sale, retirement, full, finished, and cancelled states control availability. A published offering with bookings cannot be returned to draft, preserving customer detail links. Use the existing on-sale or retirement controls to stop future sales.
- Current published offerings appear on the relevant public listings. The homepage prominently features upcoming offerings ordered by their next start date.
- When an offering has no future dates, remove it from public current-offering listings and booking. Keep the offering, booking, payment, and attendance history in admin.
- Super Admin determines permanent pages, page structure, homepage sections, and navigation. The teacher's current offerings populate the relevant sections without the teacher editing menus.

## Website Editing and Appearance

Use a constrained, section-based page editor rather than a free-form drag-and-drop builder. Super Admin can create pages from reusable templates, edit text/images/buttons, add or remove prepared sections, reorder sections, and place pages in the primary header or secondary footer navigation. The editor supports up to 12 ordered prepared sections; empty section slots are omitted from the published page.

Each installation has its own appearance settings. Super Admin chooses a curated palette, optionally sets a brand accent, and configures the business logo and imagery. Color roles for body text and surfaces remain controlled so customization preserves legibility. Provide a preview before saving.

## Mobile and Accessibility

Mobile responsiveness is a release requirement for public pages, booking and payment, and teacher admin workflows. Use layouts that remain usable at narrow phone widths; test representative phones and desktop sizes. Verify keyboard operation, labels, contrast, and non-overlapping content with automated accessibility checks and browser tests.

## Keep, Simplify, Defer, Build

### Keep

- Server-side capacity checks, payment/order integrity, idempotent payment processing, audit history, and tested booking/cancellation behavior.
- Separate per-installation data and settings.
- Existing drop-in, class block, bundle, workshop, manual booking, and offline payment domain logic where it satisfies these requirements.
- Current per-installation theme foundation, expanded with preview and appropriate setup controls.

### Simplify

- Teacher navigation and daily workflow: focus on current offerings, bookings, attendance, and students.
- Offering creation: hide recurring-series internals and advanced operational settings unless needed.
- Pricing surfaces: remove multi-date discounts and keep class passes unavailable by default.
- Role model: make the distinction explicit between Platform Super Admin and Teacher-owner, and enforce it in both pages and server actions.

### Defer

- Class passes and credit redemption.
- Multi-attendee bookings for drop-ins, class blocks, and bundles.
- Private-session calendars and online appointment scheduling.
- Retreat deposits, accommodation/meal choices, and other package options.
- Free-form visual page layout editing.

### Build or Adapt

- Draft/published lifecycle for offerings.
- Retreat as a clear full-price, multi-date offering and event quantity booking with named attendees.
- Manual enrollment in an entire block or bundle, including offline payment and capacity reservation.
- Super Admin page, homepage-section, and menu management.
- Inline offering image upload/selection.
- Offering listings and homepage features driven by publication status and future dates.
- Mobile-focused admin and checkout improvements, with full-flow mobile tests.

## Recommended Delivery Sequence

1. **Baseline and safeguards:** establish a reliable test/build baseline; inventory current behavior and critical business rules. Preserve and extend booking/payment tests before touching domain logic.
2. **Teacher workflow:** simplify the teacher-facing dashboard and offering management; add draft/publish; expose current versus finished offerings clearly; support manual class, block, and bundle booking with offline payment.
3. **Event bookings:** support workshops and multi-day retreats, group quantity, attendee names, full-price checkout, and capacity accounting. Test overselling, payment failure, duplicate requests, cancellation, and refunds.
4. **Super Admin site setup:** add reusable page templates/sections, primary and secondary menu management, homepage composition, per-install branding preview, and inline media workflows.
5. **Mobile release checks:** test representative public and admin flows at phone and desktop widths, including booking, manual booking, image upload, page editing, and accessibility.
6. **Optional features:** revisit class passes and other deferred capabilities after the core product is stable.

## Open Policy Decisions

Resolve these before implementing affected checkout and cancellation behavior:

- None currently identified for the agreed first-version scope.

## Confirmed Booking Policies

- A missed class in a block or bundle is not refundable; explain before purchase that the price covers the whole block, using clear and friendly wording.
- If a teacher cancels one date within a paid block or bundle, the teacher can choose a make-up date or a partial refund for that cancellation.
- If a teacher cancels a whole workshop or retreat, the teacher chooses whether to refund the paid order or transfer it to a replacement date.
- **Implemented:** after a whole-event cancellation, the teacher can transfer the payer's group booking to a future published event of the same type, update attendee names, and settle any difference through a recorded offline payment or tracked refund; do not silently charge a stored payment method.
- Event customer-cancellation terms are selected per event. The usual policy is no refund; if the teacher allows a substitute attendee, they arrange that outside the automated refund flow.
- Default customer-facing event wording: "Bookings are non-refundable. If you can no longer attend, contact the teacher; a substitute may be arranged at their discretion. If the teacher cancels, they will offer a refund or transfer your booking to a replacement date." Super Admin can edit this wording per event.
- A manual group event booking records a name for each attendee and contact/payment details for the payer.
- Teachers can correct attendee names after booking without a separate attendee-name change history.

## Audit Notes

This is a product-fit audit, not a full code-quality or security review. The current application has meaningful automated pricing and booking tests, but the available browser tests only verify a mobile menu at 390px rather than complete mobile booking and admin journeys. The workspace copy has no Git metadata, so its change history and worktree state could not be checked. No application code was changed while preparing this definition.
