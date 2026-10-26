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
// door:    which of the five doors in the top bar marks this page (admin · coaches · clients · marketing · library); none = the Dashboard
//
// PROWORLD HQ (Oct 21, 2026): the top bar shows five doors — Dashboard · Admin · Coaches · Clients · Marketing — and the Library.
// A door is one audience's whole world; its menu lists the views inside it (DOORS below). The pages keep their addresses.
(function () {
  "use strict";
  const PAGES = [
    // ── Tools — in daily use ──
    { id: "mkt", section: "tools", door: "marketing", name: "Marketing Command Center", short: "Marketing", color: "", status: "here", opens: "site", menu: true, url: "/marketing", owner: "Marketing",
      desc: "Home with this week's numbers and posts, the two-week plan to approve, Meta ads, and the reports the Sunday and Monday runs post. The idea banks, archive and brief live in its Library." },
    { id: "coach-portal", section: "tools", door: "coaches", name: "Coach Portal · Player Assessments", short: "Coaches", color: "mint", status: "here", opens: "site", menu: true, url: "/portal", owner: "Coaches · Directors",
      desc: "Every player's quarterly assessment (tennis, fitness, mental, summary), monthly and camp reports, videos, the journal and the follow-up checklist, with the branded PDF for parents." },
    { id: "tryouts", section: "tools", door: "coaches", name: "Try-outs", short: "Try-outs", color: "mint", status: "here", opens: "site", menu: false, url: "/portal#/tryouts", owner: "Front desk · Coaches",
      desc: "Every try-out from the first call to the decision: date and time, the parent, what we saw, the group offered." },
    { id: "coach-board", section: "tools", door: "coaches", name: "Coach Board", short: "Coach Board", color: "cyan", status: "here", opens: "site", menu: false, url: "/portal#/board", with: "coach-portal", owner: "Directors · Coaches",
      desc: "Rosters by coach, players with no coach yet, try-outs, the Proworld Standard and the quarter commit — from Monday every morning, with a log of every change. Comes with the Coach Portal." },
    { id: "backend", section: "tools", door: "admin", name: "ProWorld Admin", short: "Admin", color: "", status: "here", opens: "site", menu: true, url: "/backend", owner: "Owners · Front desk · Coaches",
      desc: "The academy's own system, replacing Play by Point: front desk, enroll, courts, attendance, players & billing, privates, books, messages. One player record drives everything — a family that enrolls online is on the roster, in the Coach Portal, on the attendance list and on Monday the same minute, and the coaches are told." },
    { id: "billing", section: "tools", door: "admin", name: "Billing · live actions", short: "Billing", color: "orchid", status: "here", opens: "site", url: "/backend#players", owner: "Owners · Front desk",
      desc: "On top of the Admin page: hold or release a player, cancel a plan at month end, charge the card on file, send a family its account link. Without this tick Admin shows billing read-only." },
    { id: "enroll", section: "tools", door: "clients", name: "Public enrollment page", short: "Enroll", color: "mint", status: "live", opens: "site", url: "/enroll", with: "backend", owner: "Clients · Front desk",
      desc: "Where families enroll and pay: program, days, parent, Stripe. Open it to see what a family sees, or send the prefilled link from Admin's Enroll tab. No sign-in needed — it is public. Comes with Admin." },
    { id: "clients", section: "tools", door: "clients", name: "Clients", short: "Clients", color: "cyan", status: "here", opens: "site", url: "/clients", with: "backend", owner: "Front desk · Owners",
      desc: "The client side in one place: the links to send (enroll, courts, privates, the client account), who enrolled online, what families asked for, and a client's account as they see it. Comes with Admin." },
    { id: "family", section: "tools", door: "clients", hide: true, name: "The client account", short: "Client account", color: "cyan", status: "live", opens: "site", url: "/family", with: "backend", owner: "Clients · Front desk",
      desc: "Where a parent signs in with the e-mail on file (Google, or an e-mailed link) and sees their own players, coach and schedule, this month's attendance, the reports the coaches marked as sent, their bills and card — and asks the front desk for a court, a private or a plan change. Requests land in the front-desk channel and on Admin's Front desk tab. Comes with Admin." },
    { id: "ai-check", section: "tools", name: "AI & Comms Check", short: "AI check", color: "orchid", status: "here", opens: "site", menu: false, url: "/checks", owner: "Owners · Front desk",
      desc: "Is everything answering? The 2-minute morning glance at the automatic reports, the weekly test messages on every channel (text, WhatsApp, website, Instagram, Messenger), the monthly accounts that switch it all off, and what’s still missing. Every tick is saved with who and when." },
    { id: "desk-live", section: "tools", door: "library", name: "Front Desk · Daily Attendance", short: "Attendance", color: "cyan", status: "live", opens: "link", owner: "Front desk",
      desc: "Today's expected players by session from Monday and the roster, what needs fixing, and the Play by Point check-in compare. Refreshes every 5 minutes. Its own page, opened with a saved link." },
    { id: "directors-live", section: "tools", door: "library", name: "Directors Dashboard", short: "Directors", color: "cyan", status: "live", opens: "link", owner: "Directors",
      desc: "The roster by director, group and coach, family-contact coverage and the overnight Monday check. Refreshes every 5 minutes. Its own page, opened with a saved link." },
    // ── Start here ──
    { id: "start", section: "library", door: "library", name: "Start here · how HQ works", short: "Start here", color: "mint", status: "page", opens: "site", url: "/start", owner: "Everyone",
      desc: "The one-page tour of PROWORLD HQ: the top bar and how to move, the Dashboard, every door and its tabs, the Library, what runs by itself, and the five screens each role uses most — sized to the doors the reader holds. Opens for everyone on the staff list." },
    // ── Prototypes & plans ──
    { id: "comms-plan", section: "proto", name: "Coach Comms Plan", color: "gray", status: "plan", opens: "site", url: "/p?id=comms-plan", file: "comms-plan", owner: "Leadership · Directors",
      desc: "Aug 18, 2026 — how coaches talk to families: JustCall for calls and texts on one number per coach, Pipedrive as the family record, WhatsApp for video, the six-week rollout with owners, the running cost and the open items. Since then: the whole team went live on JustCall (Sept 24) and the coverage engine nudges coaches and posts the 8 AM digest." },
    { id: "inbox-brief", section: "proto", name: "One Inbox Brief", color: "gray", status: "plan", opens: "site", url: "/p?id=inbox-brief", file: "inbox-brief", owner: "Leadership · Front desk",
      desc: "Aug 13, 2026 — where the AI concierge stood, why the ready-made WhatsApp connections from JustCall and Pipedrive would break it, and the plan to make Pipedrive the one inbox for every message from a family." },
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
  // ── The doors (PROWORLD HQ): what the top bar shows. A door opens its page; its menu lists the views inside it — only the
  //    ones the person may open (`page` on an item, else the door's). `page` on the door = who sees the door at all.
  const DOORS = [
    { id: "admin", name: "Admin", href: "/backend", page: ["backend"], items: [
      { name: "Front desk", href: "/backend#desk" }, { name: "Enroll · the link", href: "/backend#enroll" }, { name: "Courts", href: "/backend#courts" },
      { name: "Attendance", href: "/backend#attendance" }, { name: "Players & billing", href: "/backend#players" }, { name: "Privates", href: "/backend#privates" },
      { name: "Books", href: "/backend#books" }, { name: "Messages", href: "/backend#messages" }, { name: "Try-outs", href: "/portal#/tryouts", page: "tryouts" } ] },
    { id: "coaches", name: "Coaches", href: "/portal", page: ["coach-portal", "tryouts"], items: [
      { name: "Players Portal", href: "/portal", page: "coach-portal" }, { name: "Try-outs", href: "/portal#/tryouts", page: "tryouts" },
      { name: "Coach Board", href: "/portal#/board", page: "coach-portal" }, { name: "Attendance", href: "/backend#attendance", page: "backend" },
      { name: "Messages", href: "/backend#messages", page: "backend" }, { name: "Courts", href: "/backend#courts", page: "backend" }, { name: "Privates", href: "/backend#privates", page: "backend" } ] },
    { id: "clients", name: "Clients", href: "/clients", page: ["backend"], items: [
      { name: "The client account", href: "/family" }, { name: "Enroll · public link", href: "/enroll" }, { name: "Courts", href: "/backend#courts" },
      { name: "Privates", href: "/backend#privates" }, { name: "Look up an account", href: "/backend#account" } ] },
    { id: "marketing", name: "Marketing", href: "/marketing", page: ["mkt"], items: [
      // same names and order as the page's own tab row (Antonio, Oct 24: the menus match the pages)
      { name: "Home · the status report", href: "/marketing#home" }, { name: "2-Week Plan", href: "/marketing#fortnight" }, { name: "Coach assignments", href: "/marketing#assignments" },
      { name: "Workflow", href: "/marketing#workflow" }, { name: "Ads", href: "/marketing#ads" }, { name: "Reports", href: "/marketing#reports" }, { name: "More · banks, archive, KPI", href: "/marketing#database" } ] },
    { id: "library", name: "Library", href: "/#library", page: null, items: [] }
  ];
  const SECTIONS = [
    { id: "tools", label: "Tools — in daily use", color: "" },
    { id: "proto", label: "Library · prototypes & plans", color: "cyan" },
    { id: "library", label: "Library · playbooks, pages & reports", color: "orchid" }
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
    marketing: { label: "Marketing", pages: ["start", "mkt", "leads", "soccer", "pipeline", "thanksgiving", "sunday-preview", "ads-audit", "inbox-audit", "cult", "alo", "launch"] },
    editor: { label: "Video editor", pages: ["start", "mkt"] },
    coach: { label: "Coach", pages: ["start", "coach-portal", "tryouts", "backend"] },
    director: { label: "Tennis director", pages: ["start", "coach-portal", "tryouts", "backend", "attendance"], director: true },   // role "director" on the staff record: everything inside Coaches (Oct 24)
    desk: { label: "Front desk", pages: ["start", "tryouts", "desk-live", "ai-check", "backend", "billing", "attendance", "leads", "inbox-brief"] },
    admin: { label: "Administrator", pages: all, admin: true },
    none: { label: "Nothing yet", pages: [] }
  };
  // People on the staff list from before the Dashboard had sign-in (added in the Coach Portal) carry no page list:
  // they keep exactly what they had. The database rules say the same thing.
  const LEGACY = ["coach-portal", "tryouts"];
  // Pages that used to exist under another id: whoever had the old one has the new one.
  const ALIAS = { "be-owner": "backend", "be-desk": "backend", "be-coach": "backend", "be-parent": "backend" };
  const STATUS_LABEL = { here: "Live", live: "Live", proto: "Prototype", plan: "Plan", page: "Page", report: "Report", archive: "Archive" };
  const OPENS_LABEL = { site: "", claude: "Opens in Claude", link: "Its own page" };
  window.PW_PAGES = { PAGES, DOORS, SECTIONS, OUTSIDE, PRESETS, LEGACY, ALIAS, ALL: all, STATUS_LABEL, OPENS_LABEL };
})();
