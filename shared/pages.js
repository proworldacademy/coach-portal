// PROWORLD — the one list of every page the team uses.
// Read by the Dashboard (/index.html), the page strip (shared/menu.js) and the sign-in (shared/pwauth.js).
// Add or change a page here, nowhere else. A page's `id` is what the access list stores for each person.
//
// status:  here = part of this site · live = in daily use · proto = clickable prototype · plan = written plan
//          page = reference page · report = a dated report · archive = kept for the record
// opens:   site = on this site, with your PROWORLD sign-in · claude = a page hosted on claude.ai (needs a Claude account)
//          link = a page that lives elsewhere (its own address and key); an owner saves its link once on the Dashboard and it is
//          kept in the database (pageLinks/<id>), never in this public file
// file:    a page copied onto this site: the locked file p/data/<file>.bin, opened at /p?id=<id> (hash = the view it opens at)
// with:    a page that comes with another one (no tick box of its own): whoever has that page has this one too
// section: tools = what we use every day · proto = prototypes & plans · library = playbooks, pages & reports
(function () {
  "use strict";
  const PAGES = [
    // ── Tools — in daily use ──
    { id: "mkt", section: "tools", name: "Marketing Command Center", short: "Marketing", color: "", status: "here", opens: "site", menu: true, url: "/marketing", owner: "Marketing",
      desc: "Home with this week's numbers and posts, the two-week plan to approve, Meta ads, and the reports the Sunday and Monday runs post. The idea banks, archive and brief live in its Library." },
    { id: "coach-portal", section: "tools", name: "Coach Portal · Player Assessments", short: "Coach Portal", color: "mint", status: "here", opens: "site", menu: true, url: "/portal", owner: "Coaches · Directors",
      desc: "Every player's quarterly assessment (tennis, fitness, mental, summary), monthly and camp reports, videos, the journal and the follow-up checklist, with the branded PDF for parents." },
    { id: "tryouts", section: "tools", name: "Try-outs", short: "Try-outs", color: "mint", status: "here", opens: "site", menu: true, url: "/portal#/tryouts", owner: "Front desk · Coaches",
      desc: "Every try-out from the first call to the decision: date and time, the parent, what we saw, the group offered." },
    { id: "coach-board", section: "tools", name: "Coach Board", short: "Coach Board", color: "cyan", status: "here", opens: "site", menu: true, url: "/portal#/board", with: "coach-portal", owner: "Directors · Coaches",
      desc: "Rosters by coach, players with no coach yet, try-outs, the Proworld Standard and the quarter commit — from Monday every morning, with a log of every change. Comes with the Coach Portal." },
    { id: "desk-live", section: "tools", name: "Front Desk · Daily Attendance", short: "Attendance", color: "cyan", status: "live", opens: "link", owner: "Front desk",
      desc: "Today's expected players by session from Monday and the roster, what needs fixing, and the Play by Point check-in compare. Refreshes every 5 minutes. Its own page, opened with a saved link." },
    { id: "directors-live", section: "tools", name: "Directors Dashboard", short: "Directors", color: "cyan", status: "live", opens: "link", owner: "Directors",
      desc: "The roster by director, group and coach, family-contact coverage and the overnight Monday check. Refreshes every 5 minutes. Its own page, opened with a saved link." },
    // ── Prototypes & plans ──
    { id: "be-owner", section: "proto", name: "Backend · Owner view", color: "cyan", status: "proto", opens: "site", url: "/p?id=be-owner", file: "backend", hash: "owner", owner: "Operations",
      desc: "The full backend we are building: front desk, enrollment, court control, attendance, players & billing, privates, books with revenue by class. Demo data only." },
    { id: "be-desk", section: "proto", name: "Backend · Front desk", color: "cyan", status: "proto", opens: "site", url: "/p?id=be-desk", file: "backend", hash: "desk", owner: "Front desk",
      desc: "Today's sessions, walk-ins, enrollment, court bookings, attendance reconciliation and billing exceptions." },
    { id: "be-coach", section: "proto", name: "Backend · Coach view", color: "cyan", status: "proto", opens: "site", url: "/p?id=be-coach", file: "backend", hash: "coach", owner: "Coaches",
      desc: "Attendance by court, private lessons that charge the family automatically, and court availability." },
    { id: "be-parent", section: "proto", name: "Player & family portal", color: "mint", status: "proto", opens: "site", url: "/p?id=be-parent", file: "backend", hash: "parent", owner: "Families",
      desc: "Pick a program and pay online, see enrollment and schedule, book a court. The family side of the backend." },
    { id: "pipeline", section: "proto", name: "Player Pipeline Playbook", color: "orchid", status: "plan", opens: "site", url: "/p?id=pipeline", file: "pipeline", owner: "Marketing · Leadership",
      desc: "Our own Meta ads, fast follow-up and trial offers for tennis and soccer: what we copy, what we already have, the four-week build, the offer, the targets and the next steps (Oct 9, 2026)." },
    { id: "player-system", section: "proto", name: "Player System · team briefing", color: "gray", status: "plan", opens: "site", url: "/p?id=player-system", file: "player-system", owner: "Leadership",
      desc: "Sept 7, 2026: how a lead becomes a player — Pipedrive → Monday → the Motherboard sheet → JustCall → the AI layer → the directors — what is live and what is not yet." },
    { id: "ops", section: "proto", name: "Ops Autopilot · the plan", color: "gray", status: "plan", opens: "site", url: "/p?id=ops", file: "ops", owner: "Operations",
      desc: "Aug 23, 2026, living document: four phases to automate the attendance cross-check, renewals and the accounting prep, with who does what." },
    // ── Playbooks, pages & reports ──
    { id: "thanksgiving", section: "library", name: "Thanksgiving Camp Pricing", color: "orchid", status: "report", opens: "site", url: "/p?id=thanksgiving", file: "thanksgiving", owner: "Marketing · Leadership",
      desc: "Oct 14, 2026 — Thanksgiving week prices against the local camps and academies, per day: where we sit, the drop-in edge, and the price questions to settle before publishing." },
    { id: "sunday-preview", section: "library", name: "Sunday Plan Preview", color: "", status: "report", opens: "site", url: "/p?id=sunday-preview", file: "sunday-preview", owner: "Marketing",
      desc: "Oct 14, 2026 — what the Sunday Oct 18 run builds: the two weeks Oct 18–31, post by post, with the notes to fix before approving." },
    { id: "leads", section: "library", name: "How Leads Reach You", color: "orchid", status: "page", opens: "site", url: "/p?id=leads", file: "leads", owner: "Front desk · Marketing",
      desc: "For the front desk: how the concierge handles website, text, WhatsApp and Instagram messages, when a lead is handed over, and the rule that a human reply stops the AI." },
    { id: "soccer", section: "library", name: "Soccer, Simplified", color: "", status: "page", opens: "site", url: "/p?id=soccer", file: "soccer", owner: "Marketing · Families",
      desc: "The soccer clinic program page: ages 5–12, Tuesday / Thursday / Saturday, monthly prices, add-ons and the family FAQ." },
    { id: "ads-audit", section: "library", name: "Fall 2026 Ads Audit", color: "orchid", status: "report", opens: "site", url: "/p?id=ads-audit", file: "ads-audit", owner: "Marketing",
      desc: "Aug 24, 2026 — the Fall Program Meta campaign, Aug 11–23: spend, leads, cost per lead, tennis vs soccer, placements, who saw it, and the fixes." },
    { id: "inbox-audit", section: "library", name: "Instagram Inbox Audit", color: "orchid", status: "report", opens: "site", url: "/p?id=inbox-audit", file: "inbox-audit", owner: "Marketing · Front desk",
      desc: "Sept 1, 2026 — 120 Instagram DM threads checked against Pipedrive: the unanswered enquiries, the families, and the lesson that no DM had become a lead." },
    { id: "attendance", section: "library", name: "Daily Attendance Check", color: "cyan", status: "report", opens: "site", url: "/p?id=attendance", file: "attendance", owner: "Front desk",
      desc: "Aug 28, 2026 — one day of the parallel run: the coaches' court lists matched against Play by Point, the conflicts and the unpaid balances." },
    { id: "alo", section: "library", name: "The Alo Playbook", color: "gray", status: "report", opens: "site", url: "/p?id=alo", file: "alo", owner: "Leadership",
      desc: "Aug 27, 2026 — strategy memo: how Alo built a lifestyle brand, and the case for a tennis lifestyle brand built from the academy." },
    { id: "cult", section: "library", name: "The Cult Engine", color: "gray", status: "report", opens: "site", url: "/p?id=cult", file: "cult", owner: "Leadership · Marketing",
      desc: "Aug 28, 2026 — community and social strategy 2026 → 2028: serialized academy content and the rooms the algorithm can't touch." },
    { id: "launch", section: "library", name: "The Proworld Launch File", color: "gray", status: "report", opens: "site", url: "/p?id=launch", file: "launch", owner: "Leadership",
      desc: "Aug 27, 2026 — five exercises: the investor autopsy, the existing customer, a $0 launch sequence, the competitive blind-spot map and the path to first revenue." },
    { id: "tennis-tryout", section: "library", name: "Tennis Section Try-Out", color: "gray", status: "archive", opens: "site", url: "/p?id=tennis-tryout", file: "tennis-tryout", owner: "Leadership",
      desc: "The five ways a coach could fill the Tennis part of the quarterly (A–E). Decided Oct 8, 2026: option C is live in the Coach Portal." }
  ];
  const SECTIONS = [
    { id: "tools", label: "Tools — in daily use", color: "" },
    { id: "proto", label: "Prototypes & plans", color: "cyan" },
    { id: "library", label: "Playbooks, pages & reports", color: "orchid" }
  ];
  // Outside tools with their own logins. Shown to owners and administrators on the Dashboard.
  const OUTSIDE = [
    { name: "proworldacademy.com", url: "https://proworldacademy.com" },
    { name: "Instagram", url: "https://www.instagram.com/proworldacademy/" },
    { name: "Meta Ads Manager", url: "https://adsmanager.facebook.com/" },
    { name: "Metricool", url: "https://app.metricool.com" },
    { name: "Monday", url: "https://monday.com" },
    { name: "Slack", url: "https://proworldteam.slack.com" },
    { name: "Pipedrive", url: "https://app.pipedrive.com" },
    { name: "Play by Point", url: "https://book.proworldtennis.net" },
    { name: "Canva", url: "https://www.canva.com" },
    { name: "Webflow", url: "https://webflow.com/dashboard" },
    { name: "QuickBooks", url: "https://qbo.intuit.com" },
    { name: "Google Drive", url: "https://drive.google.com" }
  ];
  const all = PAGES.filter((p) => !p.with).map((p) => p.id);
  // Starting points when you add a person. After that, tick or untick any page for that person.
  const PRESETS = {
    marketing: { label: "Marketing", pages: ["mkt", "leads", "soccer", "pipeline", "thanksgiving", "sunday-preview", "ads-audit", "inbox-audit", "cult", "alo", "launch"] },
    editor: { label: "Video editor", pages: ["mkt"] },
    coach: { label: "Coach", pages: ["coach-portal", "tryouts", "be-coach"] },
    desk: { label: "Front desk", pages: ["tryouts", "desk-live", "be-desk", "attendance", "leads"] },
    admin: { label: "Administrator", pages: all, admin: true },
    none: { label: "Nothing yet", pages: [] }
  };
  // People on the staff list from before the Dashboard had sign-in (added in the Coach Portal) carry no page list:
  // they keep exactly what they had. The database rules say the same thing.
  const LEGACY = ["coach-portal", "tryouts"];
  const STATUS_LABEL = { here: "Live", live: "Live", proto: "Prototype", plan: "Plan", page: "Page", report: "Report", archive: "Archive" };
  const OPENS_LABEL = { site: "", claude: "Opens in Claude", link: "Its own page" };
  window.PW_PAGES = { PAGES, SECTIONS, OUTSIDE, PRESETS, LEGACY, ALL: all, STATUS_LABEL, OPENS_LABEL };
})();
