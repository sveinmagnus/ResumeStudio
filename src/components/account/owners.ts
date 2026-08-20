/**
 * How an account and a resume's `owner_id` read to a person.
 *
 * Its own module because the picker names the owner on every row (always
 * loaded) while the transfer dialog is lazy — sharing these from either of
 * those two files would put one of them back in the other's chunk.
 */
import type { TeamUser } from '../../lib/api'

export const accountName = (user: TeamUser): string => user.display_name || user.username

/** How a resume's `owner_id` reads to a person, including the two odd cases. */
export function ownerLabel(ownerId: string | null | undefined, users: TeamUser[]): string {
  if (ownerId == null) return 'Unowned'
  const user = users.find((u) => u.id === ownerId)
  // An owner_id with no account behind it is not a display bug to paper over:
  // that resume is invisible to every member and editable by none of them.
  return user ? accountName(user) : 'An account that no longer exists'
}
