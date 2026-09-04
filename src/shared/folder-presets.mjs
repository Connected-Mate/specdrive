// Ready-made house rule packs — sharp, checkable, 5 per theme. Shared by the
// MCP server (create_folder's `presets` param) and the app (preset chips in the
// folder editor), so an owner clicking "Security" gets exactly what an agent
// would have written. Plain ESM so plain `node mcp/server.mjs` can load it; the
// app's TypeScript sees it through folder-presets.d.mts.

export const RULE_PRESETS = {
  security: [
    { title: 'No secrets in code', content: 'Never hardcode API keys, tokens, passwords or credentials in code or commit them to the repo — env vars or a keychain/secret manager only.' },
    { title: 'Validate every input server-side', content: 'Never trust client input — validate and sanitize everything server-side, even if the client already checks it.' },
    { title: 'Least privilege for tokens and DB access', content: 'Every token, API key and database credential gets the minimum scope/permissions it needs to do its job, nothing broader.' },
    { title: 'Pin and audit dependencies before adding', content: "New dependencies are pinned to an exact version and checked for known vulnerabilities before they're added." },
    { title: 'Minimize and protect personal data', content: 'Collect only the personal data the product truly needs, store it encrypted, and never write it to logs or error messages.' }
  ],
  design: [
    { title: "Only use the project's design tokens", content: 'Colors, type and spacing come only from the project\'s design tokens — never ad-hoc hex values, font sizes or pixel spacing invented on the spot.' },
    { title: 'Every screen keyboard- and screen-reader-usable', content: "Every screen must be fully usable by keyboard alone and correctly announced by a screen reader, meeting WCAG AA." },
    { title: 'One primary action per screen', content: 'Each screen has exactly one primary action, visually distinct from every secondary action.' },
    { title: 'Design loading, empty and error states for every view', content: 'Every view that can load, be empty or fail gets its own designed state — never a blank screen or a raw error.' },
    { title: 'Motion stays subtle and respects reduced-motion', content: "Animations are subtle and purposeful, and disable or reduce automatically when the user's system asks for reduced motion." }
  ],
  structure: [
    { title: 'Small, single-purpose modules', content: 'Keep modules and files small and focused on one responsibility — no god files that do everything.' },
    { title: 'Clear UI/logic/data layering', content: 'Keep UI, business logic and data access in separate layers — the UI never talks to storage directly.' },
    { title: 'No circular dependencies', content: 'Modules never depend on each other in a cycle — dependencies flow one direction.' },
    { title: 'Tests live next to the code they verify', content: "Each module's tests live alongside it (or in a clearly mirrored test path), never in one disconnected test dump." },
    { title: 'Conventional commit messages', content: 'Commit messages follow a conventional format (type: short summary) so history stays scannable.' }
  ]
}

/** The preset keys, in the order the folder editor shows them. */
export const PRESET_KEYS = ['security', 'design', 'structure']

/** Plain-words label for each pack — what the owner reads on the chip. */
export const PRESET_LABEL = {
  security: 'Security',
  design: 'Design',
  structure: 'Code structure'
}
