'use strict';
/**
 * MERLIN_ACTOR — documented, unimplemented, default-off gate for any
 * future autonomous action capability. Out of scope this session per the
 * session spec's explicit hard safety rule: "Merlin reads and writes its
 * own reports/prompts. Nothing else."
 *
 * isActorEnabled() always returns false in this build — there is no
 * implementation behind this gate to turn on. It exists so a future
 * session that adds actor capability has an obvious, pre-named place to
 * wire the check, and so anyone reading this code sees the boundary was
 * deliberate, not an oversight.
 */

function isActorEnabled() {
  return false;
}

/** Throws if ever called — nothing should be gated on this yet. Exists to fail loud if a future edit wires it in prematurely. */
function assertActorNotImplemented() {
  throw new Error(
    'MERLIN_ACTOR has no implementation. Do not gate any write/mutate/send action on ' +
    'isActorEnabled() until a real actor capability is built and reviewed — see merlin/CLAUDE.md.'
  );
}

module.exports = { isActorEnabled, assertActorNotImplemented };
