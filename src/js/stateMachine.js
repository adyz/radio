/**
 * Generic state machine with declarative side-effects table.
 * No knowledge of radio, DOM, or anything else.
 */

export function createStateMachine(fxTable, effects) {
  let state = null;

  return {
    getState: () => state,

    setState(newState) {
      const fx = fxTable[newState];
      if (!fx) throw new Error(`Unknown state: ${newState}`);

      const prev = state;
      state = newState;
      if (prev !== newState) console.log(`[radio] ${prev ?? '∅'} → ${newState}`);

      effects(fx, newState);

      return { prev, next: newState };
    },
  };
}
