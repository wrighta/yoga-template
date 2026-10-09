/**
 * Idempotent seed. Safe to run repeatedly:
 *  - creates settings, products, rules, FAQs, templates, policies, content once;
 *  - tops up future occurrences so the schedule always shows ~8 weeks ahead;
 *  - creates the owner admin if none exists (credentials from ADMIN_EMAIL/ADMIN_PASSWORD).
 * Never sends emails or touches payment providers.
 */
import { get, all, run, nowIso } from "@/db";
import { migrate } from "./migrate";
import { hashPassword } from "@/lib/auth";
import { generateOccurrences } from "@/lib/tz";
import { setSetting, DEFAULT_SETTINGS } from "@/lib/settings";
import { setContent } from "@/lib/content";

const VENUE = {
  name: "Ballyowen Castle Community Centre",
  address: "Ballyowen Lane, Lucan, Co. Dublin",
  postcode: "K78 N263",
  map_url: "https://maps.google.com/?q=Ballyowen+Castle+Community+Centre,+Lucan,+K78+N263",
  // Parking / access / directions are owner-verified facts, NOT seeded defaults.
  // Launch Readiness privately prompts Anne to confirm and fill them in.
  parking_notes: null as string | null,
  access_notes: null as string | null,
  directions: null as string | null,
};

const FAQS: [string, string][] = [
  ["Is the class suitable for complete beginners?", "Yes - very much so. The class is designed so you can start exactly where you are. Every movement has an easier and a stronger option, and Anne will help you find what suits your body on the day."],
  ["Am I too old, or not flexible enough?", "Not at all. The classes especially welcome people in their 60s, 70s and beyond, and nobody is asked to twist into a pretzel. Gentle, adaptable movement is the whole idea - flexibility is not a requirement, it's a result over time if you want it."],
  ["What should I bring?", "Comfortable clothes you can move in, and a yoga mat if you have one. Warm socks for the relaxation at the end are a nice touch."],
  ["Can I book more than one date?", "Yes. On the Classes & Schedule page you can tick as many dates as you like and pay for them all in one go. When you book 2–4 different dates in one transaction, the multi-date rate applies automatically."],
  ["What happens if a class is full?", "You can join the waitlist in one tap. If a place opens up, we'll email you with a time-limited offer to claim it - first in the queue gets first refusal."],
  ["Can I pay in person?", "Yes. You can choose to pay at the class when you book online, or just message Anne on WhatsApp and she'll add you to the list. Card, cash and bank transfer all work."],
  ["How do passes and memberships work?", "A class pass gives you a set number of credits that you use whenever you like before the pass expires. The monthly and annual memberships cover all regular weekly classes while they're active. You'll always see the best-value option for what you've selected before you pay."],
  ["What if I need to cancel?", "You can cancel yourself from your booking confirmation or your account area up to 24 hours before the class for a refund or a returned pass credit. Within 24 hours, contact Anne - life happens, and she'll always try to be fair."],
  ["Where is the venue and is parking available?", "We meet at Ballyowen Castle Community Centre, Ballyowen Lane, Lucan (K78 N263). Parking and access details are on the Contact page and on every class page."],
  ["Who should I contact if I have an injury or health concern?", "Message Anne before your first class - the number is on the Contact page. She can suggest how to adapt the practice for you. Classes are not a substitute for medical care - please follow your doctor's advice about what's appropriate for you."],
];

const EMAIL_TEMPLATES: { key: string; subject: string; heading: string; body: string }[] = [
  {
    key: "booking_confirmation",
    subject: "Your {{business_name}} booking is confirmed",
    heading: "You're booked in, {{customer_name}} 🧡",
    body: `<p style="margin:0 0 16px;">Here are your class details:</p>{{class_details_html}}
<p style="margin:0 0 16px;"><strong>What to bring:</strong> {{what_to_bring}}</p>
<p style="margin:0 0 8px;"><strong>Total paid:</strong> {{total}}</p>
<p style="margin:0 0 16px;">You can view, cancel or add to your booking any time here: <a href="{{booking_url}}" style="color:#2f4a3c;">{{booking_url}}</a></p>
<p style="margin:0;">See you on the mat!</p>`,
  },
  {
    key: "booking_cancelled",
    subject: "Your booking has been cancelled",
    heading: "Booking cancelled",
    body: `<p style="margin:0 0 16px;">Hi {{customer_name}}, your booking for <strong>{{class_title}}</strong> has been cancelled.</p>{{credit_note}}{{refund_note}}
<p style="margin:0;">If this wasn't expected, just reply to this email.</p>`,
  },
  {
    key: "class_reminder",
    subject: "See you soon - {{class_title}}",
    heading: "Your class is coming up",
    body: `<p style="margin:0 0 16px;">Hi {{customer_name}}, a gentle reminder that <strong>{{class_title}}</strong> is on <strong>{{class_when}}</strong>.</p>
<p style="margin:0 0 16px;">{{venue_details}}</p>
<p style="margin:0;">Bring comfortable clothes and water. If you can't make it, no fuss - just let Anne know on {{contact_phone}}.</p>`,
  },
  {
    key: "class_changed",
    subject: "Change to your {{business_name}} class",
    heading: "A class update for you",
    body: `<p style="margin:0 0 16px;">Hi {{customer_name}}, there's a change to <strong>{{class_title}}</strong> ({{class_when}}):</p>
<p style="margin:0 0 16px;"><strong>{{change_message}}</strong></p>
<p style="margin:0;">Questions? Message Anne on {{contact_phone}}.</p>`,
  },
  {
    key: "waitlist_confirmation",
    subject: "You're on the waitlist for {{class_title}}",
    heading: "You're on the list",
    body: `<p style="margin:0 0 16px;">Hi {{customer_name}}, you're on the waitlist for <strong>{{class_title}}</strong>. If a place opens up, we'll email you straight away with a time-limited offer.</p>
<p style="margin:0;">No payment is taken while you wait.</p>`,
  },
  {
    key: "waitlist_offer",
    subject: "A place just opened up - {{class_title}}",
    heading: "Good news - a place opened up!",
    body: `<p style="margin:0 0 16px;">Hi {{customer_name}}, a spot in <strong>{{class_title}}</strong> has just become available and you're first in the queue.</p>
<p style="margin:0 0 16px;"><a href="{{claim_url}}" style="display:inline-block;background:#2f4a3c;color:#ffffff;padding:12px 24px;border-radius:999px;text-decoration:none;font-weight:600;">Claim my place</a></p>
<p style="margin:0;">This offer is held for you for the next {{expiry_hours}} hours, then it passes to the next person on the list.</p>`,
  },
  {
    key: "pass_low",
    subject: "Your {{business_name}} class pass",
    heading: "Your pass update",
    body: `<p style="margin:0 0 16px;">Hi {{customer_name}}, {{pass_message}}</p>
<p style="margin:0;">You can top up any time on the <a href="{{prices_url}}" style="color:#2f4a3c;">prices page</a>.</p>`,
  },
  {
    key: "membership_started",
    subject: "Welcome to your {{business_name}} membership",
    heading: "Welcome aboard, {{customer_name}}",
    body: `<p style="margin:0 0 16px;">Your <strong>{{membership_name}}</strong> is now active and covers all regular weekly classes.</p>
<p style="margin:0 0 16px;"><strong>Renews:</strong> {{renewal_date}} - you can cancel any time before then from your account area.</p>
<p style="margin:0;">Just book the dates you want to attend and your membership is applied automatically.</p>`,
  },
  {
    key: "membership_payment_failed",
    subject: "Action needed: your membership payment",
    heading: "Your payment didn't go through",
    body: `<p style="margin:0 0 16px;">Hi {{customer_name}}, the latest payment for your {{membership_name}} didn't go through, so the membership is paused for now.</p>
<p style="margin:0;">You can update your payment details via your account area or reply to this email and Anne will help.</p>`,
  },
  {
    key: "magic_login",
    subject: "Your {{business_name}} sign-in link",
    heading: "Your sign-in link",
    body: `<p style="margin:0 0 16px;">Hi there, here's your link to view your bookings, passes and membership:</p>
<p style="margin:0 0 16px;"><a href="{{login_url}}" style="color:#2f4a3c;font-weight:600;">Sign in to my account</a></p>
<p style="margin:0;">The link works once and expires in 15 minutes. If you didn't request it, you can safely ignore this email.</p>`,
  },
  {
    key: "contact_ack",
    subject: "Thanks for getting in touch - {{business_name}}",
    heading: "Thanks for your message",
    body: `<p style="margin:0 0 16px;">Hi {{customer_name}}, thanks for reaching out. Anne will get back to you as soon as she can - usually within a day.</p>
<p style="margin:0;">For anything urgent, WhatsApp is fastest: {{contact_phone}}.</p>`,
  },
];

const POLICIES: { slug: string; title: string; body: string; requires: boolean }[] = [
  {
    slug: "privacy-notice",
    title: "Privacy Notice",
    requires: false,
    body: `> **DRAFT - needs owner/legal review before production.** This template is a starting point, not legal advice.

**Who we are.** Yoga with Anne ("we"), ${VENUE.name}, Lucan, Co. Dublin. Contact: hello@yogawithanne.ie.

**What we collect.** When you book, we collect your name, email address, phone number and booking details. We keep a record of payments (through our payment provider - we never see or store your card details). If you tick the newsletter box, we also record your marketing consent.

**Why.** To manage your bookings, passes and memberships, to contact you about classes you've booked, and - only with your consent - to send occasional updates.

**Who else sees your data.** Our payment processor (Stripe Payments Europe) and email provider process data on our behalf. Their details will be listed here before launch.

**How long we keep it.** Booking records are kept for 6 years for tax purposes; contact and consent records for as long as needed to honour your choices. You can ask us to delete or anonymise your data at any time.

**Your rights.** You can request a copy of your data, corrections, deletion, or object to marketing at any time: email hello@yogawithanne.ie. You can also complain to the Data Protection Commission (dataprotection.ie).`,
  },
  {
    slug: "cookie-notice",
    title: "Cookie Notice",
    requires: false,
    body: `> **DRAFT - needs owner/legal review before production.**

This site uses only strictly necessary cookies: an admin sign-in cookie and, if you sign in to view your bookings, a session cookie. We do not use advertising or analytics cookies, so you will not see a cookie banner. If that ever changes, this page will be updated first and consent will be requested before any non-essential cookies are set.`,
  },
  {
    slug: "booking-terms",
    title: "Booking & Cancellation Terms",
    requires: true,
    body: `> **DRAFT - needs owner/legal review before production.**

**Booking.** Your place is confirmed once payment (or an agreed offline arrangement) is complete. Prices are shown per class in euro and include any applicable taxes as configured by the business.

**Cancellations by you.** You can cancel up to 24 hours before a class from your booking confirmation email or account area. Cancelled places are refunded to the original payment method, or the pass credit is returned to your pass. Inside 24 hours, contact Anne - refunds are at her discretion.

**Cancellations by us.** If a class has to be cancelled, you'll be offered a transfer to another date or a full refund.

**Passes.** Pass credits are valid for the period shown at purchase and are non-transferable. Expired credits cannot be reinstated.

**Memberships.** Memberships renew automatically at the interval shown and clearly flagged at checkout. You can cancel any time before the renewal date; access continues to the end of the paid period.

**Health.** Yoga classes are not medical treatment. Please consult your doctor about any health concerns before participating, and let Anne know about injuries so options can be suggested.`,
  },
  {
    slug: "website-terms",
    title: "Website Terms",
    requires: false,
    body: `> **DRAFT - needs owner/legal review before production.**

This website is operated by Yoga with Anne. Content, imagery and class descriptions are for information only and may change. Bookings made through this site are governed by the Booking & Cancellation Terms above.`,
  },
];

const CONTENT: { page: string; key: string; value: unknown }[] = [
  { page: "home", key: "hero_heading", value: "Gentle yoga & meditation in Lucan" },
  { page: "home", key: "hero_sub", value: "Move at your own pace, breathe a little deeper and feel welcome from your very first class. All ages and all levels - especially beginners." },
  { page: "home", key: "what_to_expect", value: {
      intro: "Every class follows the same calm rhythm, so you always know what you're walking into.",
      items: [
        ["A calm welcome", "Arrive, settle in, and take a few minutes to arrive properly. No experience needed and nothing to prove."],
        ["Gentle movement", "Slow, careful sequences that build strength and ease. Every movement has options - you choose the version that suits your body today."],
        ["Breathing & meditation", "Simple breathing practices and a guided relaxation to finish. Most people say this is the part they come back for."],
        ["Time for questions", "Anne is happy to talk through anything before or after class, and to suggest adaptations for anything that doesn't feel right."],
      ] as string[][],
    } },
  { page: "home", key: "who_suits", value: {
      intro: "These classes are designed around real, ordinary bodies - not performers.",
      items: [
        ["Complete beginners", "Never done yoga before? You're exactly who these classes are for. Clear, unhurried instruction from the first minute."],
        ["Over-60s", "One of the warmest parts of our community. Movements are gentle, nothing is rushed, and every exercise has a version that works for you."],
        ["Returning after a break", "Been away from yoga for a while - a year, a decade, a baby? Come back at your own pace with no pressure to be where you used to be."],
        ["Anyone who'd like to slow down", "If your week is busy and your mind is busier, an hour of steady movement and quiet is a genuinely restorative reset."],
      ] as string[][],
    } },
  { page: "about", key: "bio", value: "Anne Wright teaches gentle yoga and meditation in Lucan. Her classes are built on a simple idea: people get the most from yoga when they feel safe, unhurried and free to work at their own pace. Sessions are friendly and practical - real movement for real bodies, with plenty of options so everyone can take part." },
  { page: "about", key: "approach", value: [
      "Small, steady classes where nobody is rushed or compared.",
      "Clear instruction with easier and stronger options for every movement.",
      "A warm, down-to-earth atmosphere - come as you are.",
      "Chairs and supports available whenever they're useful.",
    ] as string[] },
  { page: "about", key: "qualifications_note", value: "" }, // Owner adds real qualifications in admin; nothing invented here.
  { page: "prices", key: "intro", value: "Simple, honest pricing. Pay per class, book a few dates together, or use a pass or membership if you come regularly - the site always shows you the cheapest eligible option before you pay." },
  { page: "contact", key: "intro", value: "Questions about classes, accessibility or booking? Send a message below or WhatsApp Anne - she's happy to help." },
];

export function seed(): void {
  migrate();
  const already = get(`SELECT key FROM settings WHERE key = 'seeded_at'`);
  const tz = DEFAULT_SETTINGS.timezone;

  // settings: first-run defaults only - NEVER overwrite values the owner has
  // already changed in admin (re-running the seed only tops up missing keys).
  for (const [k, v] of Object.entries(DEFAULT_SETTINGS)) {
    if (!get(`SELECT key FROM settings WHERE key = ?`, k)) setSetting(k, v);
  }
  const venueExists = get<{ id: number }>(`SELECT id FROM venues WHERE name = ?`, VENUE.name);
  let venueId: number;
  if (venueExists) {
    venueId = venueExists.id;
  } else {
    const r = run(
      `INSERT INTO venues (name, address, postcode, map_url, parking_notes, access_notes, directions) VALUES (?,?,?,?,?,?,?)`,
      VENUE.name, VENUE.address, VENUE.postcode, VENUE.map_url, VENUE.parking_notes, VENUE.access_notes, VENUE.directions
    );
    venueId = Number(r.lastInsertRowid);
  }
  setSetting("primary_venue_id", venueId);

  // instructor
  let instructor = get<{ id: number }>(`SELECT id FROM instructors WHERE name = 'Anne Wright'`);
  if (!instructor) {
    const r = run(`INSERT INTO instructors (name, bio) VALUES ('Anne Wright', 'Anne teaches gentle yoga and meditation in Lucan.')`);
    instructor = { id: Number(r.lastInsertRowid) };
  }

  // class type
  let classType = get<{ id: number }>(`SELECT id FROM class_types WHERE slug = 'gentle-yoga-meditation'`);
  if (!classType) {
    const r = run(
      `INSERT INTO class_types (name, slug, description, suitability, what_to_bring, accessibility_note, duration_minutes) VALUES (?,?,?,?,?,?,?)`,
      "Gentle Yoga & Meditation",
      "gentle-yoga-meditation",
      "A calm, carefully guided hour of gentle movement, simple breathing practices and a proper relaxation to finish. The pace is friendly and unhurried, with options throughout so you can make the class as gentle or as steady as suits you.",
      "All levels welcome, especially complete beginners and anyone who prefers a slower, kinder class. Every movement can be adapted, and Anne will help you find the version that works for your body.",
      "Comfortable clothes you can move in, and a yoga mat if you have one.",
      "Tell Anne about any injuries or health concerns before class so she can suggest suitable options. Classes are not a substitute for medical care.",
      60
    );
    classType = { id: Number(r.lastInsertRowid) };
  }

  // series + occurrences (top-up future schedule)
  let series = get<{ id: number }>(`SELECT id FROM class_series WHERE title = ?`, "Gentle Yoga & Meditation - Tue & Thu evenings");
  if (!series) {
    const r = run(
      `INSERT INTO class_series (title, class_type_id, venue_id, instructor_id, weekdays, start_time, end_time, capacity, booking_close_hours_before, waitlist_enabled) VALUES (?,?,?,?,?,?,?,?,?,?)`,
      "Gentle Yoga & Meditation - Tue & Thu evenings",
      classType.id, venueId, instructor.id,
      JSON.stringify([2, 4]), "19:30", "20:30", 12, 1, 1
    );
    series = { id: Number(r.lastInsertRowid) };
  }
  const today = new Date();
  const fmt = (d: Date) => d.toISOString().slice(0, 10);
  const from = fmt(new Date(today.getTime() + 86400_000));
  const to = fmt(new Date(today.getTime() + 56 * 86400_000));
  const slots = generateOccurrences({
    weekdays: [2, 4],
    startTime: "19:30",
    endTime: "20:30",
    fromDate: from,
    toDate: to,
    tz,
  });
  let created = 0;
  for (const s of slots) {
    const exists = get(`SELECT id FROM class_occurrences WHERE series_id = ? AND starts_at = ?`, series.id, s.startsAt);
    if (!exists) {
      run(
        `INSERT INTO class_occurrences (series_id, class_type_id, venue_id, instructor_id, title, starts_at, ends_at, capacity, waitlist_enabled, notes_admin)
         VALUES (?,?,?,?,?,?,?,?,?,?)`,
        series.id, classType.id, venueId, instructor.id, "Gentle Yoga & Meditation", s.startsAt, s.endsAt, 12, 1,
        "Sample date generated from the weekly series - replace with your real schedule any time."
      );
      created++;
    }
  }

  // products
  const products: [string, string, string, number, number | null, number | null, string, string | null, number][] = [
    ["drop_in", "Single class", "Pay-as-you-go drop-in for any regular class.", 1200, null, null, "all", null, 1],
    ["pass", "5-class flex pass", "Five class credits to use over 8 weeks - saves €10 vs drop-in.", 5000, 5, 8, "all", null, 2],
    ["pass", "10-class flex pass", "Ten class credits to use over 16 weeks - the best value for regulars.", 9500, 10, 16, "all", null, 3],
    ["pass", "New-student intro pass", "Three classes within 30 days - a gentle way to try it out. For first-time students only.", 3000, 3, 4, "new_customer", null, 4],
    ["membership", "Monthly membership", "All regular weekly classes, renewing monthly. Cancel any time before renewal.", 7500, null, null, "all", "monthly", 5],
    ["membership", "Annual membership", "All regular weekly classes for a full year - two months free vs monthly.", 72000, null, null, "all", "annual", 6],
  ];
  for (const [kind, name, description, price, credits, weeks, elig, recurrence, sort] of products) {
    const exists = get(`SELECT id FROM products WHERE name = ?`, name);
    if (!exists) {
      run(
        `INSERT INTO products (kind, name, description, price_cents, credits, validity_weeks, eligibility, recurrence, sort, is_default) VALUES (?,?,?,?,?,?,?,?,?,?)`,
        kind, name, description, price, credits, weeks, elig, recurrence, sort, kind === "drop_in" ? 1 : 0
      );
    }
  }
  if (!get(`SELECT id FROM discount_rules WHERE kind = 'multi_date'`)) {
    run(
      `INSERT INTO discount_rules (name, kind, min_distinct_dates, max_distinct_dates, per_class_cents, active) VALUES (?, 'multi_date', 2, 4, 1100, 1)`,
      "Multi-date rate (2–4 classes)"
    );
  }

  // homepage services (only if none exist - owner edits freely after)
  if (!all(`SELECT id FROM services LIMIT 1`)[0]) {
    const svc: [string, string, string, number][] = [
      ["Regular Classes", "Weekly gentle yoga & meditation - drop in to any class or book a block.", "/classes", 1],
      ["Workshops", "Longer, deeper sessions to reset, restore and go a bit further.", "/workshops", 2],
      ["Private Sessions", "One-to-one lessons, small groups and custom retreats, built around you.", "/enquire", 3],
    ];
    for (const [name, description, link, sort] of svc) {
      run(`INSERT INTO services (name, description, link, sort, active) VALUES (?,?,?,?,1)`, name, description, link, sort);
    }
  }

  // faqs, templates, policies, content
  for (let i = 0; i < FAQS.length; i++) {
    if (!get(`SELECT id FROM faqs WHERE question = ?`, FAQS[i][0])) {
      run(`INSERT INTO faqs (question, answer, sort) VALUES (?,?,?)`, FAQS[i][0], FAQS[i][1], i);
    }
  }
  for (const t of EMAIL_TEMPLATES) {
    if (!get(`SELECT id FROM email_templates WHERE key = ?`, t.key)) {
      run(`INSERT INTO email_templates (key, subject, heading, body_html) VALUES (?,?,?,?)`, t.key, t.subject, t.heading, t.body);
    }
  }
  // data-fixes for databases created by earlier seeds: neutralise unverified
  // venue claims and route phone numbers through the canonical variable.
  run(`UPDATE venues SET parking_notes = NULL WHERE parking_notes LIKE '%free parking%'`);
  run(`UPDATE venues SET access_notes = NULL WHERE access_notes LIKE '%Step-free%'`);
  run(`UPDATE venues SET directions = NULL WHERE directions LIKE '%just off the N4%'`);
  run(`UPDATE class_types SET suitability = replace(suitability, 'Chairs and supports are available; every movement can be adapted.', 'Every movement can be adapted, and Anne will help you find the version that works for your body.') WHERE suitability LIKE '%Chairs and supports%'`);
  run(`UPDATE class_types SET what_to_bring = 'Comfortable clothes you can move in, and a yoga mat if you have one.' WHERE what_to_bring LIKE '%borrow%'`);
  run(`UPDATE class_types SET accessibility_note = 'Tell Anne about any injuries or health concerns before class so she can suggest suitable options. Classes are not a substitute for medical care.' WHERE accessibility_note LIKE '%Chairs, blocks%'`);
  run(`UPDATE email_templates SET body_html = replace(body_html, '087 763 9701', '{{contact_phone}}') WHERE body_html LIKE '%087 763 9701%'`);
  run(`UPDATE faqs SET answer = 'We meet at Ballyowen Castle Community Centre, Ballyowen Lane, Lucan (K78 N263). Parking and access details are on the Contact page and on every class page.' WHERE question LIKE 'Where is the venue%'`);
  run(`UPDATE faqs SET answer = 'Message Anne before your first class - the number is on the Contact page. She can suggest how to adapt the practice for you. Classes are not a substitute for medical care - please follow your doctor''s advice about what''s appropriate for you.' WHERE question LIKE 'Who should I contact%'`);

  // one-time data fix for databases created before the escaping convention:
  // class_details is generated HTML, so it uses the `_html` raw-variable form.
  run(`UPDATE email_templates SET body_html = replace(body_html, '{{class_details}}', '{{class_details_html}}') WHERE key = 'booking_confirmation'`);
  for (const p of POLICIES) {
    if (!get(`SELECT id FROM policies WHERE slug = ?`, p.slug)) {
      run(`INSERT INTO policies (slug, title, body_md, version, status, requires_acceptance) VALUES (?,?,?,1,'draft',?)`,
        p.slug, p.title, p.body, p.requires ? 1 : 0);
    }
  }
  for (const c of CONTENT) {
    if (!get(`SELECT id FROM content_blocks WHERE page = ? AND key = ?`, c.page, c.key)) {
      setContent(c.page, c.key, c.value as never);
    }
  }

  // owner admin
  if (!get(`SELECT id FROM admins LIMIT 1`)) {
    const email = process.env.ADMIN_EMAIL || "anne@yogawithanne.ie";
    const password = process.env.ADMIN_PASSWORD || "change-me-immediately";
    run(`INSERT INTO admins (email, name, role, password_hash) VALUES (?,?, 'super_admin', ?)`, email, "Anne Wright", hashPassword(password));
    console.log(`  Owner admin created: ${email} / ${password}  (change the password after first login)`);
  }

  if (!already) {
    setSetting("seeded_at", nowIso());
    console.log(`Seeded: ${created} upcoming class dates (${from} → ${to}), products, FAQs, templates, policies, content.`);
  } else {
    console.log(`Seed topped up: ${created} new future class dates.`);
  }
}

const isDirectRun = process.argv[1] && import.meta.url.endsWith(process.argv[1].split("/").pop()!);
if (isDirectRun) {
  seed();
}
