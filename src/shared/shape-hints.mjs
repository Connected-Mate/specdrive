// What a product of a given SHAPE almost always has to answer before anyone
// builds it. Plain ESM so `node mcp/server.mjs` can load it directly.
//
// This is a STARTING POINT the agent adapts to the real project — never a form
// to fill in, and never a questionnaire for the owner. The agent names the
// shape, derives the areas, researches the ones the internet can answer, and
// only asks the owner about taste, priorities and constraints.

/** Plain-words label for each known area slug. Free-form areas are allowed:
 *  anything not listed here keeps the agent's own wording. */
export const AREA_LABELS = {
  'business-model': 'Business model & pricing',
  'platform-rules': 'Platform rules (App Store / Play)',
  'store-rules': 'Store rules & permissions',
  'backend-hosting': 'Backend & hosting',
  'auth-accounts': 'Accounts & sign-in',
  payments: 'Payments & billing',
  'legal-privacy': 'Legal & privacy (GDPR, minors, data)',
  notifications: 'Notifications',
  'offline-sync': 'Working offline & syncing',
  'analytics-metrics': 'Analytics & success metrics',
  'support-ops': 'Support & running it day to day',
  'launch-distribution': 'Launch & distribution',
  accessibility: 'Accessibility',
  security: 'Security',
  'trust-safety': 'Trust, safety & moderation',
  'seo-discovery': 'Being found (search & discovery)',
  onboarding: 'First run & onboarding',
  'data-model': 'Data & storage',
  integrations: 'Integrations & third parties',
  localization: 'Languages & regions',
  'performance-cost': 'Speed & running costs',
  hardware: 'Hardware, firmware & manufacturing',
  'ai-behaviour': 'AI behaviour, prompts & guardrails',
  'ai-cost-limits': 'AI cost, rate limits & fallbacks',
  packaging: 'Packaging & releases',
  'game-economy': 'Game economy & progression',
  'inventory-logistics': 'Stock, shipping & returns',
  'two-sided-liquidity': 'Both sides of the marketplace',
  'internal-access': 'Who inside can see what',
  'backup-recovery': 'Backups & recovery',
  'content-pipeline': 'Where the content comes from',
  'api-contract': 'The public interface others build on',
  'rate-limits': 'Quotas, rate limits & abuse',
  'device-testing': 'Testing on real devices',
  'app-review': 'Getting through store review',
  'browser-support': 'Browsers & devices supported',
  'migration-rollout': 'Rollout & migration of existing users'
}

/** Areas nearly every shipped product owes an answer to. */
const UNIVERSAL = [
  { area: 'security', why: 'Somebody will poke at it. Decide what must never leak before it exists.' },
  {
    area: 'legal-privacy',
    why: 'What personal data it holds, where it lives, and what the law expects of that.'
  },
  {
    area: 'analytics-metrics',
    why: 'How we will know, in numbers, whether this is working at all.'
  }
]

/** shape → the areas that shape almost always needs, each with a plain "why". */
export const SHAPE_HINTS = {
  'ios-app': {
    label: 'iPhone / iPad app',
    areas: [
      { area: 'platform-rules', why: 'Apple can refuse the app. Its rules decide what we may even build.' },
      { area: 'app-review', why: 'What reviewers check, and what gets an app rejected on the first try.' },
      { area: 'backend-hosting', why: 'Almost no app lives on the phone alone — decide what a server must do.' },
      { area: 'auth-accounts', why: 'Whether people sign in, and how, changes half of the product.' },
      { area: 'business-model', why: 'Free, paid, or subscription decides what Apple takes and what we build.' },
      { area: 'payments', why: 'In-app purchase rules are strict and cost 15-30%.' },
      { area: 'notifications', why: 'Push is how phone apps come back to people. It needs setup and permission.' },
      { area: 'offline-sync', why: 'Phones lose signal. Decide what still works in a tunnel.' },
      { area: 'legal-privacy', why: 'Apple demands privacy labels and consent before the app can ship.' },
      { area: 'device-testing', why: 'Simulators lie. Plan how it gets tested on real hardware.' },
      { area: 'launch-distribution', why: 'TestFlight, then the store listing, screenshots and release notes.' },
      { area: 'accessibility', why: 'VoiceOver and larger text are expected on iPhone, not optional extras.' }
    ]
  },
  'android-app': {
    label: 'Android app',
    areas: [
      { area: 'platform-rules', why: 'Google Play policy decides what the app is allowed to do.' },
      { area: 'app-review', why: 'Play review and its data-safety form gate every release.' },
      { area: 'backend-hosting', why: 'Decide what the phone does and what a server must do.' },
      { area: 'auth-accounts', why: 'Whether people sign in, and how.' },
      { area: 'business-model', why: 'Free, paid or subscription changes the whole build.' },
      { area: 'payments', why: 'Play billing rules and their cut.' },
      { area: 'notifications', why: 'Push is how the app earns a second visit.' },
      { area: 'offline-sync', why: 'Signal drops. Decide what still works.' },
      { area: 'device-testing', why: 'Android is a thousand different screens and versions.' },
      { area: 'legal-privacy', why: 'The data-safety declaration must match what the app really does.' },
      { area: 'launch-distribution', why: 'Store listing, staged rollout, release channels.' },
      { area: 'accessibility', why: 'TalkBack and text scaling are expected.' }
    ]
  },
  'cross-platform-mobile': {
    label: 'App for both iPhone and Android',
    areas: [
      { area: 'platform-rules', why: 'Two stores, two rule books, and they disagree.' },
      { area: 'app-review', why: 'Both reviews must pass before anyone can install it.' },
      { area: 'backend-hosting', why: 'One shared server behind two apps.' },
      { area: 'auth-accounts', why: 'Sign-in has to feel native on both.' },
      { area: 'business-model', why: 'Both stores take a cut; pricing has to survive that.' },
      { area: 'payments', why: 'Apple and Google each demand their own billing.' },
      { area: 'notifications', why: 'Push works differently on each platform.' },
      { area: 'offline-sync', why: 'Phones lose signal on both platforms.' },
      { area: 'device-testing', why: 'Two platforms means twice the real-device testing.' },
      { area: 'launch-distribution', why: 'Two listings, two release processes, one launch date.' },
      { area: 'accessibility', why: 'Screen readers on both, and they behave differently.' }
    ]
  },
  'web-app': {
    label: 'Website people log into',
    areas: [
      { area: 'auth-accounts', why: 'Who gets in, how they get back in, and what happens when they forget.' },
      { area: 'backend-hosting', why: 'Where it runs, what it costs, what happens when it falls over.' },
      { area: 'data-model', why: 'What we store about people and how long we keep it.' },
      { area: 'browser-support', why: 'Which browsers and screen sizes must work, and which we ignore.' },
      { area: 'onboarding', why: 'The first two minutes decide whether anyone comes back.' },
      { area: 'accessibility', why: 'Keyboard and screen-reader use, and the law in some markets.' },
      { area: 'performance-cost', why: 'Slow pages lose people, and cloud bills grow quietly.' },
      { area: 'backup-recovery', why: 'Decide now what happens the day the database is wrong.' }
    ]
  },
  'web-saas': {
    label: 'Paid online product (subscription)',
    areas: [
      { area: 'business-model', why: 'Pricing, plans and what each plan includes IS the product.' },
      { area: 'payments', why: 'Subscriptions, failed cards, refunds, taxes, invoices.' },
      { area: 'auth-accounts', why: 'Accounts, teams, invitations, who can do what.' },
      { area: 'backend-hosting', why: 'Where it runs and what it costs per customer.' },
      { area: 'onboarding', why: 'Trial-to-paid lives or dies in the first session.' },
      { area: 'legal-privacy', why: 'Terms, privacy policy, GDPR, data processing agreements.' },
      { area: 'support-ops', why: 'Paying customers write in. Decide who answers and how.' },
      { area: 'analytics-metrics', why: 'Signups, activation, churn — the numbers the business runs on.' },
      { area: 'security', why: 'Customer data in one place is a target.' },
      { area: 'backup-recovery', why: 'Losing a customer\'s data ends the business.' },
      { area: 'launch-distribution', why: 'How the first hundred customers ever hear about it.' }
    ]
  },
  marketplace: {
    label: 'Marketplace connecting two sides',
    areas: [
      { area: 'two-sided-liquidity', why: 'Both sides must show up, and the empty side is the hard one.' },
      { area: 'business-model', why: 'Commission, listing fee or subscription — and who pays it.' },
      { area: 'payments', why: 'Money passes through us: payouts, escrow, refunds, disputes.' },
      { area: 'trust-safety', why: 'Strangers transacting. Reviews, reporting, fraud, bad actors.' },
      { area: 'auth-accounts', why: 'Two kinds of account, verified differently.' },
      { area: 'legal-privacy', why: 'Handling other people\'s money and data has rules.' },
      { area: 'support-ops', why: 'Disputes need a human. Decide who and how fast.' },
      { area: 'seo-discovery', why: 'Listings have to be findable or the marketplace is invisible.' },
      { area: 'analytics-metrics', why: 'Match rate and repeat use tell us if it actually works.' }
    ]
  },
  'api-backend': {
    label: 'Server or API other software talks to',
    areas: [
      { area: 'api-contract', why: 'Once someone builds on it, changing it breaks them.' },
      { area: 'auth-accounts', why: 'Keys, tokens, who is allowed to call what.' },
      { area: 'rate-limits', why: 'Quotas and abuse protection, or one caller takes it down.' },
      { area: 'backend-hosting', why: 'Where it runs, how it scales, what it costs.' },
      { area: 'data-model', why: 'The shape of the data is the shape of the product.' },
      { area: 'security', why: 'A public endpoint is attacked from day one.' },
      { area: 'support-ops', why: 'Monitoring, alerts, and who gets woken up.' },
      { area: 'backup-recovery', why: 'Decide now what happens when data is lost or corrupted.' },
      { area: 'business-model', why: 'Free tier, metered, or internal-only changes the design.' }
    ]
  },
  'internal-tool': {
    label: 'Tool for one company\'s own staff',
    areas: [
      { area: 'internal-access', why: 'Who inside may see and do what — the main risk in internal tools.' },
      { area: 'auth-accounts', why: 'Usually the company\'s existing login, not a new one.' },
      { area: 'integrations', why: 'It only earns its keep by talking to the systems already in use.' },
      { area: 'data-model', why: 'It usually reads real, sensitive company data.' },
      { area: 'support-ops', why: 'Who maintains it when the person who asked for it moves on.' },
      { area: 'migration-rollout', why: 'How the team stops doing it the old way.' },
      { area: 'security', why: 'Internal does not mean safe.' },
      { area: 'legal-privacy', why: 'Staff and customer data both carry obligations.' }
    ]
  },
  'content-site': {
    label: 'Site built around content',
    areas: [
      { area: 'content-pipeline', why: 'Who writes it, where it lives, and how it gets published.' },
      { area: 'seo-discovery', why: 'For a content site, being found IS the product.' },
      { area: 'business-model', why: 'Ads, sponsorship, paywall or nothing — decide before the design.' },
      { area: 'performance-cost', why: 'Page speed drives both readers and search ranking.' },
      { area: 'accessibility', why: 'Text-heavy sites are the easiest to get right and the worst to get wrong.' },
      { area: 'localization', why: 'Whether content exists in more than one language.' },
      { area: 'analytics-metrics', why: 'Which pieces are read, and by whom.' },
      { area: 'legal-privacy', why: 'Cookie consent, newsletters, and copyright of what is published.' }
    ]
  },
  'e-commerce': {
    label: 'Shop selling things',
    areas: [
      { area: 'payments', why: 'Taking money reliably, with taxes and refunds, is the whole shop.' },
      { area: 'inventory-logistics', why: 'Stock, shipping, delivery times and returns.' },
      { area: 'business-model', why: 'Margins, shipping costs and what is actually profitable.' },
      { area: 'auth-accounts', why: 'Guest checkout versus accounts changes conversion.' },
      { area: 'trust-safety', why: 'Fraud, chargebacks and fake orders.' },
      { area: 'legal-privacy', why: 'Consumer law, right of return, invoices, VAT.' },
      { area: 'seo-discovery', why: 'Product pages have to be findable.' },
      { area: 'support-ops', why: 'Where is my order is the most common message a shop gets.' },
      { area: 'analytics-metrics', why: 'Conversion, basket size, abandoned carts.' }
    ]
  },
  game: {
    label: 'Game',
    areas: [
      { area: 'game-economy', why: 'Progression, difficulty and rewards are the design, not decoration.' },
      { area: 'business-model', why: 'Premium, ads or in-app purchases changes every design choice.' },
      { area: 'platform-rules', why: 'Stores and consoles have rules, especially about money and minors.' },
      { area: 'backend-hosting', why: 'Saves, leaderboards and multiplayer need a server.' },
      { area: 'performance-cost', why: 'Frame rate is the feel of the game.' },
      { area: 'legal-privacy', why: 'Games attract minors, which raises the legal bar sharply.' },
      { area: 'launch-distribution', why: 'Store pages, trailers, wishlist and launch week.' },
      { area: 'analytics-metrics', why: 'Where players stop playing tells you what to fix.' }
    ]
  },
  'hardware-plus-app': {
    label: 'A physical device with an app',
    areas: [
      { area: 'hardware', why: 'Parts, firmware, certification and manufacturing lead times.' },
      { area: 'backend-hosting', why: 'Devices phone home; something has to answer.' },
      { area: 'offline-sync', why: 'The device must keep working when the network does not.' },
      { area: 'auth-accounts', why: 'Pairing a device to a person is its own problem.' },
      { area: 'security', why: 'A device in someone\'s home is a physical attack surface.' },
      { area: 'legal-privacy', why: 'Sensors collect data; certification and consent both apply.' },
      { area: 'support-ops', why: 'Firmware updates, returns, and devices that die in the field.' },
      { area: 'business-model', why: 'Hardware margin plus any subscription behind it.' },
      { area: 'launch-distribution', why: 'Manufacturing, shipping and the app store, together.' }
    ]
  },
  'chrome-extension': {
    label: 'Browser extension',
    areas: [
      { area: 'store-rules', why: 'Extension stores are strict about permissions and get apps removed.' },
      { area: 'security', why: 'An extension can read every page — that is the whole risk.' },
      { area: 'legal-privacy', why: 'Stores demand a privacy justification for every permission asked.' },
      { area: 'browser-support', why: 'Chrome, Edge, Firefox and Safari differ in what they allow.' },
      { area: 'auth-accounts', why: 'If it syncs anything, someone has to sign in.' },
      { area: 'business-model', why: 'Free, paid or licence-key changes how it is built.' },
      { area: 'launch-distribution', why: 'Store listing, review times, and updates being re-reviewed.' },
      { area: 'analytics-metrics', why: 'Installs versus actual use, without spying on people.' }
    ]
  },
  'cli-devtool': {
    label: 'Command-line tool for developers',
    areas: [
      { area: 'packaging', why: 'How people install it and get updates decides whether they use it.' },
      { area: 'api-contract', why: 'Flags and output are an interface; changing them breaks scripts.' },
      { area: 'browser-support', why: 'Which operating systems and versions we promise to work on.' },
      { area: 'security', why: 'Dev tools read credentials and run commands.' },
      { area: 'support-ops', why: 'Issues, versioning and who fixes them.' },
      { area: 'business-model', why: 'Open source, paid, or open core — decide before the licence.' },
      { area: 'launch-distribution', why: 'How developers ever hear it exists.' }
    ]
  },
  'ai-assistant': {
    label: 'AI assistant or agent',
    areas: [
      { area: 'ai-behaviour', why: 'What it must never do or say, and how we hold it to that.' },
      { area: 'ai-cost-limits', why: 'Every answer costs money; runaway use is the classic failure.' },
      { area: 'legal-privacy', why: 'What of the user\'s data goes to a model, and who else sees it.' },
      { area: 'security', why: 'Prompt injection: untrusted text trying to give the assistant orders.' },
      { area: 'auth-accounts', why: 'Whose data the assistant is allowed to touch.' },
      { area: 'business-model', why: 'Usage costs must fit inside what people pay.' },
      { area: 'backend-hosting', why: 'Which model, which provider, and the fallback when it is down.' },
      { area: 'analytics-metrics', why: 'How we tell a good answer from a bad one, at scale.' },
      { area: 'onboarding', why: 'People need to learn what to ask it.' }
    ]
  }
}

/** Every shape slug the reference knows about. */
export const SHAPES = Object.keys(SHAPE_HINTS)

/** Plain label for an area slug — falls back to the agent's own wording. */
export function areaLabel(area) {
  if (AREA_LABELS[area]) return AREA_LABELS[area]
  const s = String(area).replace(/[-_]+/g, ' ').trim()
  return s ? s[0].toUpperCase() + s.slice(1) : area
}

/** Loose match: "iOS app", "ios_app", "iPhone app" all reach "ios-app". */
export function normalizeShape(shape) {
  if (!shape) return null
  const raw = String(shape).toLowerCase().trim()
  const slug = raw.replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '')
  if (SHAPE_HINTS[slug]) return slug
  const aliases = {
    ios: 'ios-app',
    iphone: 'ios-app',
    'iphone-app': 'ios-app',
    ipad: 'ios-app',
    android: 'android-app',
    mobile: 'cross-platform-mobile',
    'mobile-app': 'cross-platform-mobile',
    'react-native': 'cross-platform-mobile',
    flutter: 'cross-platform-mobile',
    saas: 'web-saas',
    'web-application': 'web-app',
    website: 'content-site',
    blog: 'content-site',
    shop: 'e-commerce',
    ecommerce: 'e-commerce',
    store: 'e-commerce',
    api: 'api-backend',
    backend: 'api-backend',
    server: 'api-backend',
    cli: 'cli-devtool',
    'dev-tool': 'cli-devtool',
    extension: 'chrome-extension',
    'browser-extension': 'chrome-extension',
    'ai-agent': 'ai-assistant',
    chatbot: 'ai-assistant',
    iot: 'hardware-plus-app',
    hardware: 'hardware-plus-app'
  }
  return aliases[slug] ?? null
}

/** The suggested checklist for a shape: shape areas first, then the universals
 *  it did not already name. Returns [] for an unknown shape (the agent still
 *  derives its own — the reference is a hint, not a gate). */
export function hintsFor(shape) {
  const slug = normalizeShape(shape)
  if (!slug) return []
  const areas = SHAPE_HINTS[slug].areas
  const seen = new Set(areas.map((a) => a.area))
  return [...areas, ...UNIVERSAL.filter((a) => !seen.has(a.area))]
}

/** The block get_guidance / create_project print: a starting point, in words a
 *  non-technical owner could read over the agent's shoulder. */
export function shapeHintBlock(shape) {
  const slug = normalizeShape(shape)
  if (!slug) {
    return (
      `\n\nWHAT THIS PRODUCT NEEDS — derive it yourself.\n` +
      `First, name the SHAPE of what is being built (one of: ${SHAPES.join(', ')}, or your own label if none fits). ` +
      `Then derive the areas THIS product must have an answer for before anyone plans or builds, and declare them with set_required_areas (one plain-English "why" each). ` +
      `Then fill them: everything the web or your own judgement can answer, RESEARCH NOW (real pages) and write as specs — do not ask the owner. ` +
      `Ask the owner only about taste, priorities and constraints.`
    )
  }
  const hints = hintsFor(slug)
  return (
    `\n\nWHAT THIS KIND OF PRODUCT (${SHAPE_HINTS[slug].label}) USUALLY NEEDS — a STARTING POINT, not a form:\n` +
    hints.map((h) => `  • ${h.area} (${areaLabel(h.area)}) — ${h.why}`).join('\n') +
    `\n\nAdapt this list to THIS product: drop what genuinely does not apply (mark it "n/a" with a reason), add what is missing, then declare the real list with set_required_areas. ` +
    `Everything the web can answer, research NOW and write as specs tagged "area:<slug>" — the owner is only asked about taste, priorities and constraints.`
  )
}
