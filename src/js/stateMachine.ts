/**
 * Generic state machine with declarative side-effects table.
 * No knowledge of radio, DOM, or anything else.
 */

export function createStateMachine<State extends string, Fx>(
  fxTable: Record<State, Fx>,
  effects: (fx: Fx, newState: State) => void,
) {
  let state: State | null = null;

  return {
    getState: () => state,

    setState(newState: State) {
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
