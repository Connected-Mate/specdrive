# SpecDrive — Impeccable Design Context

## Design Context

### Users
Non-technical people ("vibe coders") who want to build real software with AI coding agents (Claude Code, Cursor…) but don't know what specs, architecture, or dev plans are. They open SpecDrive on their Mac, follow guided steps, copy prompts into their AI agent, and watch their project's specification fill itself in live. Context: solo, at home or work, excited but easily intimidated by jargon. The job to be done: turn a vague idea into a rigorous, spec-driven build without ever feeling lost.

### Brand Personality
Calm, crafted, confident. A premium indie-magazine feel — "this tool has taste" — that makes structured engineering discipline feel like a beautiful editorial experience, not a dashboard. Emotions to evoke: delight at watching specs appear live, reassurance ("the AI and the app handle the hard parts"), quiet pride.

### Aesthetic Direction
Exact style reference: Portal (useportal.net) twilight-serif editorial system — MANDATED BY THE USER, overrides generic font guidance:
- Display: Perfectly Nineties Regular (bundled woff2), 36–48px, line-height 1.0, weight 400 only, display sizes only.
- Body/UI: Inter 400/500/600, 12–16px, letter-spacing -0.02em (user-mandated; ban-lists do not apply).
- One chromatic accent: iOS blue #007aff, functional only (CTAs, active states, links). Everything else achromatic: #000 headings, #3e3e3e body, #636363 muted, #f7f7f7 canvas, #fff cards.
- Dusk gradient (only atmospheric surface): linear-gradient(180deg,#4a7ff2 0%,#7b7ed8 30%,#c98ab5 65%,#e8a87c 100%) — hero/onboarding only.
- Shapes: pills at 50px radius for ALL buttons/badges; cards 22–30px; nav capsule 22px.
- Elevation: 5px #f7f7f7 glow ring + 1px hairlines, never heavy drop shadows. Filled-button shadow: inset 0 1px 0 0 #fff, 0 0 0 1px rgba(0,0,0,.15), 0 3px 2px 0 rgba(0,0,0,.06).
- Light theme only. Subtle doodle-pattern texture available as background garnish.
- Anti-references: generic SaaS dashboards, purple gradients, cards-in-cards, gray-on-color, dark "hacker" themes, monospace-as-tech.

### Design Principles
1. **Plain words over jargon** — every label, empty state and prompt explains itself to a non-developer; specs are "your project's memory", tasks are "steps".
2. **The board is the show** — specs appearing live (via MCP) is the product's magic moment; animate entrances (ease-out-quint, transform+opacity, staggered) and make new cards unmissable.
3. **One blue thing per screen** — a single #007aff primary action tells the user exactly what to do next; everything else stays achromatic.
4. **Editorial calm** — generous 80px+ section gaps, serif headlines, 640–720px reading widths; the app should feel like a magazine spread, never a dense admin panel.
5. **Guided loop** — the phase stepper (Capture → Challenge → Research → Risks → Plan → Build) always shows where you are and hands you the exact next prompt to copy.
