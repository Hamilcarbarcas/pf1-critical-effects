/* Leaf module: no imports, so anything may import it without creating a cycle.
 *
 * MODULE_ID lives here rather than in the entry file because several modules use it at their own
 * top level (building a socket channel name, for instance). Importing that from the entry file
 * would form a cycle and evaluate the binding before it was initialised.
 */

export const MODULE_ID = "pf1-critical-effects";
