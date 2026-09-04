// Houses nest: a house can live inside another house, without limit (SNCF →
// SNCF Marketing → the projects). A project inherits the rules of every house
// above it, and the closest house wins when two rules carry the same name.
//
// This is the ONE place that logic lives. The MCP server (mcp/server.mjs), the
// app's store (src/main/store.ts), the AGENTS.md export and the "Keep in mind"
// panel all import it, so an agent and the owner can never be told two
// different things about which rules apply.
//
// Plain ESM so `node mcp/server.mjs` can load it directly; TypeScript sees it
// through house-chain.d.mts. Everything here is pure: it reads houses only
// through the `readFolder(id)` function the caller hands in.

/** A house may not sit deeper than this — a guard against silly trees. */
export const MAX_HOUSE_DEPTH = 8

const key = (title) => String(title ?? '').trim().toLowerCase()

/** The line of houses above (and including) this one: [root … leaf].
 *  Cycle-safe: a house that somehow points back into its own line stops the
 *  walk instead of looping forever. */
export function houseChain(folderId, readFolder) {
  const chain = []
  const seen = new Set()
  let id = folderId || null
  while (id && !seen.has(id) && chain.length < MAX_HOUSE_DEPTH) {
    seen.add(id)
    const folder = readFolder(id)
    if (!folder) break
    chain.unshift({ ...folder, rules: Array.isArray(folder.rules) ? folder.rules : [] })
    id = folder.parentId || null
  }
  return chain
}

/** "SNCF › Marketing" — the house's address, for a breadcrumb or a log line. */
export function chainLabel(chain, separator = ' › ') {
  return chain.map((f) => f.name).join(separator)
}

/** Every rule that reaches a project, in the order it should be read:
 *  the outermost house first, the project's own house last. Each rule carries
 *  which house it comes from. A rule whose name matches one from a house
 *  further in is kept but marked `supersededBy` — never silently dropped, so
 *  the owner and the agent can always see what replaced what. */
export function effectiveRules(folderId, readFolder) {
  const chain = houseChain(folderId, readFolder)
  const all = []
  for (const folder of chain) {
    for (const rule of folder.rules ?? []) {
      all.push({ ...rule, houseId: folder.id, house: folder.name })
    }
  }
  // The LAST rule with a given name wins: the chain runs root → leaf, so the
  // closest house to the project is the one that gets the final word.
  const winner = new Map()
  all.forEach((r, i) => winner.set(key(r.title), i))
  return all.map((r, i) => {
    const w = winner.get(key(r.title))
    if (w === i) return r
    const by = all[w]
    return { ...r, supersededBy: by.houseId, supersededByHouse: by.house, supersededByTitle: by.title }
  })
}

/** Only the rules that actually bind — the superseded ones filtered out. */
export function activeRules(folderId, readFolder) {
  return effectiveRules(folderId, readFolder).filter((r) => !r.supersededBy)
}

/** Is `folderId` somewhere below `ancestorId` (or the same house)? */
export function isInLineOf(folderId, ancestorId, readFolder) {
  return houseChain(folderId, readFolder).some((f) => f.id === ancestorId)
}

/** How deep the tree under this house goes, counting the house itself as 1.
 *  Needs the full list of houses, so it is optional everywhere it is used. */
export function subtreeDepth(folderId, folders) {
  const children = folders.filter((f) => f.parentId === folderId)
  if (!children.length) return 1
  let deepest = 1
  for (const c of children) deepest = Math.max(deepest, 1 + subtreeDepth(c.id, folders))
  return deepest
}

/** Can `folderId` be moved inside `parentId`? Returns a plain-words reason to
 *  refuse, or '' when the move is fine. `folders` (the full list) is optional —
 *  pass it and the depth check also accounts for what hangs below the house
 *  being moved. */
export function canParent(folderId, parentId, readFolder, folders) {
  if (!parentId) return ''
  if (parentId === folderId) return 'A house cannot live inside itself.'
  const parent = readFolder(parentId)
  if (!parent) return 'That house no longer exists.'
  if (isInLineOf(parentId, folderId, readFolder))
    return 'That house already lives inside this one — a house cannot contain the house it lives in.'
  const above = houseChain(parentId, readFolder).length
  const below = Array.isArray(folders) ? subtreeDepth(folderId, folders) : 1
  if (above + below > MAX_HOUSE_DEPTH)
    return `That would stack houses ${above + below} deep — ${MAX_HOUSE_DEPTH} is the limit.`
  return ''
}

/** The houses a given house is allowed to be moved into: everything except
 *  itself and anything already living inside it. */
export function possibleParents(folderId, folders, readFolder) {
  return folders.filter((f) => f.id !== folderId && !isInLineOf(f.id, folderId, readFolder))
}

/** Rules grouped by the house they come from, root first — what a board, a
 *  briefing or an AGENTS.md export renders. */
export function rulesByHouse(folderId, readFolder) {
  const chain = houseChain(folderId, readFolder)
  const rules = effectiveRules(folderId, readFolder)
  return chain.map((folder, i) => ({
    folder,
    /** "SNCF · Marketing" — where these rules come from, in plain words */
    path: chain.slice(0, i + 1).map((f) => f.name).join(' · '),
    own: i === chain.length - 1,
    rules: rules.filter((r) => r.houseId === folder.id)
  }))
}
