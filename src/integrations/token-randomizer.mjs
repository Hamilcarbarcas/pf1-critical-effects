/* pf1-token-randomizer — name obfuscation.
 *
 * A DM can give a token a name the players are shown in place of its real one. Anything this
 * module prints about a token — a chat card, a GM-facing list a player might see quoted, a roll
 * request's flavour — has to go through that module rather than read `token.name`, or an obscured
 * NPC's real name leaks (DESIGN.md §10).
 *
 * Optional dependency: with the module absent or the API missing, every call falls back to the
 * name it was given, so callers need no guard of their own.
 */

/**
 * A token's name as it may be displayed.
 *
 * @param {TokenDocument|null} token
 * @param {string|null} [fallback]  used when there is no token, no API, or the API declines;
 *                                  defaults to the token's own name
 * @returns {string|null}
 */
export function displayName(token, fallback = null) {
  const base = fallback ?? token?.name ?? null;
  if (!token) return base;

  const api = game.modules.get("pf1-token-randomizer")?.api;
  if (!api?.getDisplayName) return base;

  try {
    return api.getDisplayName(token) ?? base;
  } catch {
    return base;
  }
}
