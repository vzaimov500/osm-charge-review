/**
 * Licences whose data may be imported into OpenStreetMap without further
 * permission. Anything else needs documented explicit permission, expressed as
 * `LicenseRef-permission` plus `permission_url`.
 *
 * This list is deliberately short. Attribution licences such as CC-BY-4.0 are
 * *not* here: they need a waiver, which is a permission, not a licence.
 */
export const OSM_COMPATIBLE_LICENCES = ['ODbL-1.0', 'CC0-1.0', 'PDDL-1.0'] as const

/** Explicit written permission from the data owner, documented at `permission_url`. */
export const PERMISSION_LICENCE = 'LicenseRef-permission'

export type LicenceStatus =
  /** Known compatible, or permission documented. */
  | 'compatible'
  /** Permission claimed but not documented. */
  | 'permission_undocumented'
  /** Unknown / pending / incompatible: review allowed, live upload must be refused. */
  | 'unverified'

export function licenceStatus(licence: string, permissionUrl: string | undefined): LicenceStatus {
  if ((OSM_COMPATIBLE_LICENCES as readonly string[]).includes(licence)) return 'compatible'
  if (licence === PERMISSION_LICENCE)
    return permissionUrl ? 'compatible' : 'permission_undocumented'
  return 'unverified'
}
