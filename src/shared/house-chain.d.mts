import type { Folder, FolderRule } from './types'

/** A rule as it reaches a project: it remembers which house it came from, and
 *  whether a closer house overrode it. */
export interface EffectiveRule extends FolderRule {
  /** Id of the house this rule is written in */
  houseId: string
  /** Name of that house — what the owner reads */
  house: string
  /** Set when a house closer to the project carries a rule with the same name */
  supersededBy?: string
  supersededByHouse?: string
  supersededByTitle?: string
}

export interface HouseRuleGroup {
  folder: Folder
  /** "SNCF · Marketing" — the address of the house these rules come from */
  path: string
  /** True for the project's own house (the last one in the chain) */
  own: boolean
  rules: EffectiveRule[]
}

export type ReadFolder = (id: string) => Folder | null

export const MAX_HOUSE_DEPTH: number

export function houseChain(folderId: string | null | undefined, readFolder: ReadFolder): Folder[]
export function chainLabel(chain: Folder[], separator?: string): string
export function effectiveRules(
  folderId: string | null | undefined,
  readFolder: ReadFolder
): EffectiveRule[]
export function activeRules(
  folderId: string | null | undefined,
  readFolder: ReadFolder
): EffectiveRule[]
export function isInLineOf(
  folderId: string | null | undefined,
  ancestorId: string,
  readFolder: ReadFolder
): boolean
export function subtreeDepth(folderId: string, folders: Folder[]): number
export function canParent(
  folderId: string,
  parentId: string | null | undefined,
  readFolder: ReadFolder,
  folders?: Folder[]
): string
export function possibleParents(
  folderId: string | null | undefined,
  folders: Folder[],
  readFolder: ReadFolder
): Folder[]
export function rulesByHouse(
  folderId: string | null | undefined,
  readFolder: ReadFolder
): HouseRuleGroup[]
