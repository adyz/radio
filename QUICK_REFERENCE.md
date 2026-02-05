# State Machine Quick Reference

## Visual State Flow

```
                    ┌─────────────────┐
                    │  App Starts     │
                    └────────┬────────┘
                             │
                             ▼
                    ┌─────────────────┐
                    │     IDLE        │◄──────────┐
                    │  Initial state  │           │
                    └────────┬────────┘           │
                             │                     │
                    PLAY / SELECT_STATION        │
                             │                     │
                             ▼                     │
        ┌────────────────────────────────────┐   │
        │          LOADING                   │   │
        │  • Show spinner                    │   │
        │  • Play loading sound              │   │
        │  • Fetch radio stream              │   │
        └──┬──────────┬──────────────────┬──┘   │
           │          │                  │       │
    FAILURE│          │SUCCESS           │       │
           │          │              NEXT/PREV   │
           │          │             SELECT       │
           │          │                  │       │
           ▼          ▼                  │       │
    ┌──────────┐  ┌──────────┐         │       │
    │  ERROR   │  │ PLAYING  │         │       │
    │          │  │          │         │       │
    └─────┬────┘  └────┬─────┘         │       │
          │            │                │       │
          │            │ PAUSE          │       │
          │            │                │       │
    RETRY │            ▼                │       │
    PLAY  │       ┌──────────┐         │       │
    NEXT  │       │  PAUSED  │         │       │
    PREV  │       │          │         │       │
          │       └─────┬────┘         │       │
          │             │               │       │
          │             │ PLAY          │       │
          │             │ (auto 2s)     │       │
          │             │               │       │
          └─────────────┴───────────────┘       │
                        │                        │
                   NEXT / PREV                   │
                   SELECT_STATION                │
                        │                        │
                        └────────────────────────┘
```

## States Summary

| State | What It Means | UI Display |
|-------|---------------|------------|
| **IDLE** | No station playing | Play button, no poster |
| **LOADING** | Connecting to stream | Spinner, loading sound, "Se încarcă..." |
| **PLAYING** | Radio is playing | Pause button, 🔴, station poster |
| **PAUSED** | Temporarily paused | Play button, stream alive |
| **ERROR** | Connection failed | Error message, ❤️‍🩹, "Eroare" |

## Events (User Actions)

- **PLAY** - Click play button
- **PAUSE** - Click pause button  
- **NEXT** - Click next station
- **PREV** - Click previous station
- **SELECT_STATION** - Choose from dropdown
- **SUCCESS** - Stream loaded (automatic)
- **FAILURE** - Stream failed (automatic)

## Transition Rules

From **IDLE**:
- PLAY → LOADING
- SELECT_STATION → LOADING

From **LOADING**:
- SUCCESS → PLAYING
- FAILURE → ERROR
- NEXT/PREV/SELECT_STATION → LOADING (restart)

From **PLAYING**:
- PAUSE → PAUSED
- NEXT/PREV/SELECT_STATION → LOADING

From **PAUSED**:
- PLAY → PLAYING
- Auto after 2s → PLAYING
- NEXT/PREV/SELECT_STATION → LOADING

From **ERROR**:
- PLAY/RETRY → LOADING
- NEXT/PREV/SELECT_STATION → LOADING

## Code Comparison

### ❌ Current (3 Booleans = 8 Combinations)

```typescript
const [isPlaying, setIsPlaying] = useState(false);
const [isLoading, setIsLoading] = useState(false);
const [hasError, setHasError] = useState(false);

// Problems:
// - Can have isPlaying=true AND isLoading=true (invalid!)
// - Race conditions when updating multiple booleans
// - Logic scattered across many functions
// - Hard to test all 8 combinations
```

### ✅ State Machine (1 State = 5 Valid Values)

```typescript
type State = 'idle' | 'loading' | 'playing' | 'paused' | 'error';
const [state, setState] = useState<State>('idle');

// Benefits:
// - Only ONE state at a time
// - Impossible to be in invalid state
// - Transitions are explicit
// - Easy to test 5 states
```

## Key Benefits

1. **🚫 No Impossible States** - Can't be playing AND loading
2. **📍 Explicit Transitions** - Clear rules
3. **🎯 Centralized Logic** - One place, not scattered
4. **✅ Easy Testing** - Test each state independently
5. **🔒 Type Safety** - TypeScript prevents errors
6. **📊 Visual Docs** - Diagram = documentation
7. **🐛 Better Debugging** - See current state clearly
8. **🔄 No Race Conditions** - Atomic state changes

## Implementation Example (Simple TypeScript)

```typescript
type PlayerState = 
  | { status: 'idle' }
  | { status: 'loading'; stationIndex: number }
  | { status: 'playing'; stationIndex: number }
  | { status: 'paused'; stationIndex: number }
  | { status: 'error'; stationIndex: number; error: string };

const [state, setState] = useState<PlayerState>({ status: 'idle' });

// Usage:
if (state.status === 'loading') {
  // TypeScript knows state.stationIndex exists
  console.log('Loading station', state.stationIndex);
}

// Transition:
setState({ status: 'loading', stationIndex: 0 });
```

## Implementation Example (XState)

```typescript
import { createMachine } from 'xstate';
import { useMachine } from '@xstate/react';

const radioMachine = createMachine({
  id: 'radio',
  initial: 'idle',
  states: {
    idle: {
      on: { PLAY: 'loading' }
    },
    loading: {
      on: { 
        SUCCESS: 'playing',
        FAILURE: 'error'
      }
    },
    playing: {
      on: { PAUSE: 'paused' }
    },
    paused: {
      on: { PLAY: 'playing' }
    },
    error: {
      on: { RETRY: 'loading' }
    }
  }
});

// Usage in component:
const [state, send] = useMachine(radioMachine);

// Check state:
const isLoading = state.matches('loading');

// Send event:
send('PLAY');
```

## Testing

```typescript
// Test a transition
test('loading → playing on success', () => {
  let state: State = { status: 'loading', stationIndex: 0 };
  
  // Simulate success
  state = { status: 'playing', stationIndex: 0 };
  
  expect(state.status).toBe('playing');
});

// Test invalid transition is ignored
test('cannot pause from idle', () => {
  let state: State = { status: 'idle' };
  
  // Try to pause (invalid)
  // State machine would ignore this
  
  expect(state.status).toBe('idle');
});
```

## Further Reading

- **STATE_MACHINE.md** - Complete explanation (14KB)
- **STATE_MACHINE_DIAGRAM.md** - Interactive Mermaid diagram (8KB)
- **README.md** - Project overview with state machine section

## Summary

**State machines make implicit, scattered state management explicit and centralized.**

Instead of juggling multiple booleans and worrying about invalid combinations, you have:
- ✅ One clear state at a time
- ✅ Explicit transitions
- ✅ Visual documentation
- ✅ Type-safe code
- ✅ Easy testing

This leads to **more predictable, maintainable, and bug-free code**! 🎉
