# Implementation Plan

**Status:** In progress. This plan tracks implementation against [PRODUCT_DEFINITION.md](./PRODUCT_DEFINITION.md).

## Recommendation

Evolve the current application rather than replace it. Preserve and extend the tested pricing, payment, capacity, and booking domain logic. Simplify the teacher-facing workflow and build missing publishing, event, and site-setup capabilities around those existing services.

Continue in tested, additive slices. Each deployment has its own database; schema changes must preserve existing bookings and payment history.

## Existing Foundation

- Drop-in classes, blocks, multi-block bundles, date-span workshops/retreats, waitlists, online checkout, attendance, manual bookings, and offline payment records are implemented.
- Block and bundle checkout creates bookings for every date inside a transaction. Existing integration tests cover block lifecycle, bundle checkout, duplicate bookings, non-refundability, and last-seat races.
- Manual bookings support individual class dates, whole blocks/bundles, and named Workshop/Retreat groups with offline payment. Capacity is checked atomically across the full enrollment.
- All public offering types now have separate draft/published status; existing records migrate as published. Drafts are hidden from listings, direct class links, quote/checkout, sitemap and manual class choices.
- Workshops and retreats are date spans represented by one internal inventory occurrence. They are excluded from ordinary class schedules; attendee names and per-person capacity/price are recorded separately from payer details.
- Explicit Super Admin and Teacher-owner roles and route/action guards exist, including safe team handoff checks.
- Appearance has per-installation palettes and accent color. Theme preview and systematic phone-width checks are gaps.
- Baseline after role and optional-pricing slices: 53 unit tests, 55 integration checks, and 28 browser E2E checks pass. Browser coverage includes mobile draft creation, event checkout, and pricing feature toggles; it does not yet cover the complete set of mobile teacher-admin workflows.

## Delivery Sequence

### 0. Baseline and Protection

- Record expected behavior for normal drop-in booking, block and bundle checkout, waitlists, manual bookings, offline payments, cancellations, and Stripe refunds.
- Confirm migrations are additive and rerunnable; preserve order, payment, booking, audit, and customer data.
- Expand test fixtures around the product's published offerings and capacity rules before modifying those rules.
- Keep integration/e2e test databases and Next build output isolated from the active development server. The integration runner now uses a temporary database, a dedicated `.next-integration` directory, and an available port; preserve this isolation.

**Exit checks:** baseline unit tests pass; existing block/bundle integration tests pass; a documented safe test command does not disrupt the running app or use live payment services.

### 1. Roles and Teacher Workspace

- Define only two product capabilities: Platform Super Admin and Teacher-owner. Map or migrate existing roles without accidentally granting broader permissions.
- Keep website structure, pages, menus, theme, class-style content, user administration, and integration settings Super Admin-only.
- Make the teacher navigation task-focused: dashboard, offerings/schedule, bookings/students, and business operations.
- Give the teacher access to offering prices, booking revenue, refunds, attendance, cancellations, and offline payments as agreed.
- Audit permissions in every server action as well as hiding Super Admin links in the UI.

**Exit checks:** tests cover each role on both page access and mutation actions; teacher can complete daily tasks without entering Super Admin setup areas.

### 2. Offering Lifecycle and Creation

- Separate publication state (`draft` / `published`) from operational availability (`on sale`, full, finished, cancelled). Do not overload the existing `active` field.
- Apply the same lifecycle to individual scheduled classes, recurring series, blocks, bundles, workshops, and retreats. Creation presents separate Save draft and Publish actions. Draft items must not appear publicly or be purchasable, including through class-detail URLs and APIs.
- Keep publication separate from availability. Prevent returning an offering to draft once bookings exist; use on-sale/retirement controls to stop new sales without breaking customer detail links.
- Workshop and retreat creation now uses a start/end date span and one whole-event inventory slot. Put itinerary details in the description; do not invent daily session times or include the event slot in weekly class schedules.
- Allow teachers to publish their own offerings. Published current offerings appear on the relevant public listing and are ordered by upcoming start date; the homepage features the next upcoming published items.
- Once no future dates remain, hide an item from current public listings and booking while retaining its history in admin.
- Allow offering photos to be uploaded or selected inline. Keep existing media validation, resizing, and alt-text requirements.

**Exit checks:** draft privacy, publish/unpublish, date ordering, automatic expiry, direct-route access, and image selection have focused unit/integration/browser tests.

### 3. Booking and Capacity Workflows

- Add manual whole-block and whole-bundle enrollment. In one transaction, verify capacity for every included date, create the order/items/bookings, and record the offline payment method. A failed date check must leave no partial booking.
- Online group quantity and named attendee records are implemented for workshops and retreats only. The payer supplies contact/payment details; capacity decreases by the number of attendees for the whole event. A booking stores one payer record, seat count, and attendee-name records.
- Keep multi-attendee drop-in, block, and bundle booking out of this release.
- Event capacity holds and duplicate-booking protections use the same transactional booking path. Coverage verifies attendee-count pricing, capacity holds, payment fulfillment, and oversized groups being rejected.
- For block/bundle purchases, preserve the agreed rule that missed sessions are non-refundable. If the teacher cancels one date, provide a teacher-selected make-up or partial-refund path.
- For teacher-cancelled workshops/retreats, let the teacher refund or transfer the order. Event customer-cancellation terms are editable per event; default terms state non-refundability and that substitute attendees are arranged at teacher discretion.
- **Implemented:** after a Workshop/Retreat is cancelled, transfer the whole payer booking/group to a future published event of the same type with an atomic capacity check. Keep the original order, allow attendee-name updates, record higher-price differences as explicit offline payments, and track lower-price refunds until settled against the original payment.
- **Implemented:** retreat setup accepts either one start/end time shared by each day or explicit start/end times for every calendar date. Public event details list that schedule; booking and capacity remain one date-span event slot.
- Keep refunds tied to payment/order records and test Stripe and offline/manual paths separately. Stripe refund actions now fail closed unless a valid PaymentIntent can actually be refunded.

**Exit checks:** one-person and group checkout, capacity accounting, payment retries, payment failure, cancellations, refund balance limits, event transfers, and manual enrollment are covered without overbooking or partial database state.

### 4. Super Admin Site Setup

- **Implemented:** create, edit, publish and return custom pages to draft; configure title, slug, introduction, hero, and up to 12 ordered prepared sections with text, selected images, and internal-link buttons.
- **Implemented:** manage primary header/mobile and secondary footer menus, including placement, order, active state, and links to custom pages. Draft-page links are hidden; changing a page slug updates linked URLs; deleting a page removes its linked menu items.
- **Implemented:** Super Admin can show/hide and reorder the existing prepared homepage sections per installation.
- **Implemented:** Super Admin-only draft-page preview and an unsaved theme preview of the real homepage; both preview routes are noindex and leave public settings unchanged.
- Manage permanent service/class-style pages separately from time-sensitive offerings.
- Keep curated palettes, optional brand accent, logo, and media. Check text contrast and responsive layout when adding an appearance preview.
- Retain offering descriptions/images and permanent service-page content as distinct data so temporary offerings do not become permanent pages by accident.

**Exit checks:** role protection, page/menu persistence, homepage section visibility/order, and page/theme previews pass integration and browser coverage. Broader phone/desktop checks remain open.

### 5. Mobile and Accessibility Release Gate

- Test public home, current offerings, schedule, event detail, group checkout, and confirmation at narrow phone, standard phone, tablet, and desktop widths.
- Test teacher dashboard, create/edit/publish offering, manual block booking, booking management, image upload, and Super Admin page/menu editor on mobile.
- Check no horizontal overflow, clipped copy, overlapping controls, inaccessible touch targets, or layout shifts when optional content is present.
- Run keyboard and automated accessibility checks on representative templates and checkout steps.

**Release gate:** all critical journeys pass on phone and desktop, and no known severe accessibility or mobile usability defect remains.

### 6. Deferred Features

- Further class-pass lifecycle changes beyond the existing credit model. Pass purchases and multi-date drop-in discounts are now per-installation Super Admin options, both off by default; already-owned pass credits remain usable.
- Multi-attendee booking for regular classes, blocks, and bundles.
- Online private-session calendars, retreat deposits, accommodation/meal options, and free-form page layout editing.

## Decisions Still Needed Before Coding

No product decisions remain open for the agreed first-version scope. Confirm the exact payment collection/refund interaction for event transfers during implementation design; the product rule is that the teacher can adjust attendees and settle any difference explicitly, without silently charging a stored payment method. Attendee-name corrections do not require a separate change history.

## Scope Guard

Do not rewrite the booking engine, add a multi-tenant business database, or build a drag-and-drop page editor as part of this work. Revisit those only if implementation evidence shows the existing domain cannot safely support the agreed workflows.

## Progress

- **Completed:** safe integration test isolation using a temporary database, dedicated build directory, and dynamically selected port.
- **Completed:** additive publication-status migration; existing records remain published by default.
- **Completed:** separate Save draft / Publish actions for blocks, workshops, recurring schedules, and single classes; saved drafts can later be published from admin.
- **Completed:** draft filtering and booking rejection for individual classes, recurring series, blocks, bundles, weekly-hours summaries, manual-booking choices, and sitemap entries. Booked offerings cannot be hidden as drafts; stop sales using availability controls.
- **Completed:** manual whole-block/bundle enrollment with atomic capacity checks, offline payment records, and a teacher-facing Bookings form.
- **Completed:** Workshop/Retreat date-span creation, one whole-event inventory slot, per-person online pricing, group capacity holds, named attendees, and event-specific public details.
- **Completed:** manual Workshop/Retreat group enrollment with payer contact, attendee names, offline payment, and capacity checks.
- **Safe handoff:** create and verify a separate Super Admin from Settings → Team, then change Anne's existing account to Teacher-owner. The current owner remains Super Admin until this explicit step.
- **Completed:** explicit Super Admin and Teacher-owner roles, guarded account handoff, and per-install class-pass/multi-date toggles (default off).
- **Completed:** Super Admin custom page and primary/footer menu management, including prepared section ordering, draft/public visibility, linked menu maintenance, and mobile-menu display.
- **Completed:** transfer canceled Workshop/Retreat group bookings to future published events of the same type, update attendee names, reserve capacity atomically, record explicit offline price increases, and settle price-difference refunds through the original payment ledger.
- **Completed:** Super Admin homepage section visibility and ordering for the existing prepared sections.
- **Completed:** authenticated, noindex preview for draft pages and unsaved homepage palette/accent choices; previews do not write live settings.
- **Completed:** configurable homepage hero button labels, destinations, and visibility; service-section heading/copy and contrasting background; service modules can link to published custom pages.
- **Completed:** media can be uploaded directly within an image picker; Photos upload control is visibly clickable. Fallback illustrations use palette variables, with two additional forest/orange and pine/coral palettes.
- **Completed:** Create Classes options are closed accordions without numbering. Em dashes were replaced with regular hyphens in project text.
- **Completed:** remove generated weekly hours/drop-in price from the homepage hero, remove What to expect number badges, simplify Classes intro, and combine blocks/bundles in a responsive auto-fit grid with accurate weekdays, time, date range, duration, total price, location, and remaining capacity.
- **Verified:** 53 unit tests, 57 integration checks, and 33 browser E2E checks pass. Migrations 011, 012, and 013 are applied to the active local database.
- **Next:** finish broad mobile coverage and address remaining feedback not yet taken up (for example, independently configurable homepage hero imagery).
