# Suggesting Mode Architecture

> **Status:** Alpha (`@alpha` tagged). Implemented in Phase 1 on branch `feature/content-suggestions`.

Suggesting mode is the third edit mode in the Portable Text Editor. When active, typing creates **suggestions** (proposed changes rendered as decorations) instead of modifying the base document.

## The Three Edit Modes

The editor has three mutually exclusive edit modes, managed by the XState state machine in `editor-machine.ts`:

```
┌─────────────────────────────────────────────────┐
│                  edit mode                       │
│                                                  │
│  ┌──────────┐   ┌──────────┐   ┌────────────┐  │
│  │ read only│   │ editable │   │ suggesting │  │
│  │          │   │          │   │            │  │
│  │  idle    │   │  idle    │   │  idle      │  │
│  │  focusing│   │  focusing│   │  focusing  │  │
│  │  dragging│   │  dragging│   │  dragging  │  │
│  └──────────┘   └──────────┘   └────────────┘  │
└─────────────────────────────────────────────────┘
```

| Mode           | `readOnly` | `suggesting` | Document mutations | Behavior interception                               |
| -------------- | ---------- | ------------ | ------------------ | --------------------------------------------------- |
| **Read only**  | `true`     | `false`      | Blocked            | Only clipboard.copy, mouse.click, serialize, select |
| **Editable**   | `false`    | `false`      | Allowed            | Full behavior chain                                 |
| **Suggesting** | `false`    | `true`       | Intercepted        | Mutation events caught by suggest-mode behavior     |

**Key invariant:** Read only always wins. There is no direct transition from read only to suggesting — you must go through editable first.

### Transitions

```
editable ──── update suggestMode(true) ────→ suggesting
editable ──── update readOnly(true) ───────→ read only

suggesting ── update suggestMode(false) ───→ editable
suggesting ── update readOnly(true) ───────→ read only

read only ─── update readOnly(false) ──────→ editable
read only ─── update suggestMode(*) ───────→ (ignored — no transition)
```

The state machine does **not** remember previous suggesting state. A round-trip `suggesting → read only → editable` lands in editable, not suggesting.

## State Machine Integration

### Where it lives

The `'suggesting'` state is a peer of `'editable'` and `'read only'` inside the `'edit mode'` parallel state in `packages/editor/src/editor/editor-machine.ts`.

Both `'editable'` and `'suggesting'` share identical substates (idle, focusing, dragging internally) via the `createEditableSubstates(modeName)` factory function. This eliminates duplication — any fix to focus management or drag-and-drop applies to both modes automatically.

### Events

| Event                  | Payload                   | Effect                                               |
| ---------------------- | ------------------------- | ---------------------------------------------------- |
| `'update suggestMode'` | `{ suggesting: boolean }` | Transitions between editable ↔ suggesting            |
| `'update readOnly'`    | `{ readOnly: boolean }`   | Transitions to/from read only (overrides suggesting) |

### Emitted events

The state machine emits events on mode transitions:

| Emitted event  | When                                       |
| -------------- | ------------------------------------------ |
| `'suggesting'` | Entering suggesting mode                   |
| `'editable'`   | Leaving suggesting mode (back to editable) |
| `'read only'`  | readOnly overrides suggesting              |

### Consumer API

```typescript
// Enable suggesting mode
editor.send({type: 'update suggestMode', suggesting: true})

// Disable suggesting mode
editor.send({type: 'update suggestMode', suggesting: false})

// Listen for mode changes
editor.on('suggesting', () => {
  /* entered suggesting mode */
})
editor.on('editable', () => {
  /* back to editable */
})

// Read current state
const snapshot = editor.getSnapshot()
snapshot.context.suggesting // boolean
snapshot.context.readOnly // boolean
```

### Snapshot derivation

The `suggesting` field in `EditorContext` is derived from the state machine via `matches({'edit mode': 'suggesting'})`. It appears in two places:

- `createEditorSnapshot()` in `editor-snapshot.ts` — used by the behavior system when evaluating guards
- `getEditorSnapshot()` in `editor-selector.ts` — used by React hooks (`useEditorSelector`)

Both derive from the same state machine state. There is exactly one source of truth.

## Behavior Interception

### How it works

The `createSuggestModeBehavior()` function (in `packages/editor/src/suggestions/behavior.suggest-mode.ts`) creates a wildcard behavior (`on: '*'`) that intercepts mutation events when suggesting mode is active.

```
User types "hello"
    │
    ▼
editor.send({ type: 'insert.text', text: 'hello' })
    │
    ▼
State machine routes to behavior chain
    │
    ▼
createSuggestModeBehavior guard:
  ├── snapshot.context.suggesting === true?
  ├── Is this a mutation event? (check MUTATION_EVENT_TYPES)
  │
  ├── YES to both → intercept: call onIntercept(), return effect()
  │                  (effect() stops propagation — base document untouched)
  │
  └── NO → pass through to next behavior in chain
```

### MUTATION_EVENT_TYPES

The set of intercepted event types includes all document-mutating operations:

- **Text:** `insert.text`, `insert.break`, `insert.soft break`, `insert.span`, `insert.block`, `insert.blocks`, `insert.child`, `insert.inline object`
- **Deletion:** `delete`, `delete.backward`, `delete.forward`, `delete.block`, `delete.child`, `delete.text`
- **Splitting:** `split`
- **Formatting:** `style.add/remove/toggle`, `decorator.add/remove/toggle`, `annotation.add/remove/toggle/set`
- **Block properties:** `block.set/unset`, `child.set/unset`
- **Lists:** `list item.add/remove/toggle`
- **Moving:** `move.backward/forward/block/block down/block up`

Non-mutation events (selection, focus, keyboard, clipboard read, history) pass through to normal PTE handling.

### The `raise()` invariant

**IMPORTANT:** Suggest mode relies on all document mutations flowing through `raise()` to one of the `MUTATION_EVENT_TYPES` events. Abstract behaviors use `raise()` to decompose high-level events into final mutation events:

```
input.insertFromPaste → raise('deserialize') → raise('deserialize.data')
  → raise('deserialization.success') → raise('insert.blocks') ← CAUGHT HERE
```

The intermediate events pass through uncaught, but no document mutation happens until the final event. If a behavior uses `execute()` to bypass the chain for a mutation event, suggest mode won't catch it and the document will be modified silently.

## The `isActive()` Veto Pattern

The `isActive()` callback on `SuggestModeBehaviorConfig` serves a dual role:

### 1. Veto (primary use)

When the state machine is in suggesting mode, `isActive()` returning `false` **vetoes** interception. This enables the accept/reject bypass pattern:

```typescript
const behavior = createSuggestModeBehavior({
  isActive: () => !service.isBypassing,
  onIntercept: ({event, snapshot}) => {
    /* create suggestion */
  },
})

// During accept/reject:
service.isBypassing = true
try {
  applySuggestionToEditor(editor, suggestion) // mutations pass through
} finally {
  service.isBypassing = false
}
```

The state machine stays in suggesting mode during bypass — only the behavior guard is bypassed.

### 2. Legacy fallback (deprecated)

When the state machine is NOT in suggesting mode, `isActive()` returning `true` enables interception as a backwards-compatible fallback. This emits a deprecation warning because it creates a snapshot inconsistency: `snapshot.context.suggesting` reports `false` while mutations are being intercepted.

Consumers should migrate to `editor.send({ type: 'update suggestMode', suggesting: true })`.

### Guard logic

```typescript
guard: ({event, snapshot}) => {
  if (snapshot.context.suggesting) {
    // State machine says suggesting. isActive() can veto.
    if (config.isActive?.() === false) return false
  } else {
    // State machine NOT suggesting. isActive() is legacy fallback.
    if (config.isActive?.() === true) {
      console.warn('...deprecation warning...')
    } else {
      return false
    }
  }
  return isMutationEvent(event)
}
```

## Decoration Pipeline

Suggestions are rendered as range decorations on the editor surface:

```
Suggestion[]
    │
    ▼
suggestionsToDecorations({ suggestions, onAction, onMoved })
    │
    ▼
RangeDecoration[]  (one per suggestion)
    │
    ▼
<PortableTextEditable rangeDecorations={decorations} />
    │
    ▼
Slate renders decorated leaves with suggestion components
```

### Suggestion types → decoration rendering

| Suggestion type     | Selection                    | Rendering                                                 |
| ------------------- | ---------------------------- | --------------------------------------------------------- |
| `InsertSuggestion`  | Collapsed (anchor === focus) | Inline preview of inserted text at cursor position        |
| `DeleteSuggestion`  | Expanded (anchor !== focus)  | Strikethrough on text to be deleted                       |
| `ReplaceSuggestion` | Expanded (anchor !== focus)  | Strikethrough on original + inline preview of replacement |

Each decoration includes `onAction` callbacks for accept/reject, wired through the `SuggestionConfig`.

## Position Tracking

Range decorations track suggestion positions through local and remote edits using Slate's `Point.transform`:

```
Editor operation (insert, delete, split, merge)
    │
    ▼
moveRangeByOperation(decorationRange, operation)
    │
    ├── Point.transform(anchor, operation, { affinity: 'inward' })
    ├── Point.transform(focus, operation, { affinity: 'inward' })
    │
    ▼
Updated range (or null if invalidated)
```

**Inward affinity** means insertions at the range boundary do NOT expand the range. Without this, typing at the exact edge of a suggestion decoration would absorb the new text into the decorated range.

For remote edits, the `onMoved` callback notifies the consumer so they can update their suggestion store. The consumer can return an `EditorSelection` to override the auto-resolved position.

## Mode Visibility Rules

| Mode           | Suggestions visible?                            | Mutations intercepted?                          |
| -------------- | ----------------------------------------------- | ----------------------------------------------- |
| **Read only**  | No — decorations not rendered                   | No — most events blocked by read-only whitelist |
| **Editable**   | Yes — decorations rendered if suggestions exist | No — normal editing                             |
| **Suggesting** | Yes — decorations rendered                      | Yes — mutation events intercepted by behavior   |

Visibility is controlled by the consumer (the playground checks `suggestionService.enabled`), not by the editor core. The editor provides the mechanism (range decorations); the consumer decides when to show them.

## File Map

| File                                             | Purpose                                                                         |
| ------------------------------------------------ | ------------------------------------------------------------------------------- |
| `src/editor/editor-machine.ts`                   | State machine with `'suggesting'` state, `createEditableSubstates()` factory    |
| `src/editor/editor-snapshot.ts`                  | `EditorContext` type with `suggesting: boolean`, `createEditorSnapshot()`       |
| `src/editor/editor-selector.ts`                  | `getEditorSnapshot()` derives `suggesting` from state machine                   |
| `src/editor/create-editor.ts`                    | Routes `'update suggestMode'` event, relays `'suggesting'` emitted event        |
| `src/editor/relay-machine.ts`                    | `EditorEmittedEvent` union includes `'suggesting'`                              |
| `src/suggestions/behavior.suggest-mode.ts`       | `createSuggestModeBehavior()`, `MUTATION_EVENT_TYPES`, guard logic              |
| `src/suggestions/suggestions-to-decorations.tsx` | `suggestionsToDecorations()` — maps suggestions to range decorations            |
| `src/suggestions/suggestion-components.tsx`      | React components for insert/delete/replace decoration rendering                 |
| `src/types/suggestion.ts`                        | `Suggestion`, `InsertSuggestion`, `DeleteSuggestion`, `ReplaceSuggestion` types |
| `src/behaviors/behavior.perform-event.ts`        | `performEvent()` — passes `suggesting` flag through behavior chain              |
| `src/internal-utils/move-range-by-operation.ts`  | Position tracking with inward affinity                                          |
| `tests/suggesting-state.test.tsx`                | 17 browser tests for state transitions, interception, backwards compat, events  |
