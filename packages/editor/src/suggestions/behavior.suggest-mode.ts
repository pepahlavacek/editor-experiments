import {effect} from '../behaviors/behavior.types.action'
import {
  defineBehavior,
  type Behavior,
} from '../behaviors/behavior.types.behavior'
import type {BehaviorEvent} from '../behaviors/behavior.types.event'
import type {EditorSnapshot} from '../editor/editor-snapshot'

/**
 * Mutation event types that suggest mode intercepts.
 *
 * These are events that would modify the document content.
 * Selection, focus, clipboard read, and history events pass through.
 *
 * INVARIANT: Suggest mode relies on all document mutations flowing through
 * `raise()` to one of these event types. Abstract behaviors use `raise()` to
 * decompose high-level events (e.g., `input.insertFromPaste` → `deserialize`
 * → `insert.blocks`), and the final mutation event is caught here. If a
 * behavior uses `execute()` to bypass the chain for a mutation event, suggest
 * mode won't catch it and the document will be modified silently.
 */
const MUTATION_EVENT_TYPES = new Set([
  // Text insertion
  'insert.text',
  'insert.break',
  'insert.soft break',
  'insert.span',
  'insert.block',
  'insert.blocks',
  'insert.child',
  'insert.inline object',
  // Deletion
  'delete',
  'delete.backward',
  'delete.forward',
  'delete.block',
  'delete.child',
  'delete.text',
  // Splitting
  'split',
  // Styles and decorators
  'style.add',
  'style.remove',
  'style.toggle',
  'decorator.add',
  'decorator.remove',
  'decorator.toggle',
  // Annotations
  'annotation.add',
  'annotation.remove',
  'annotation.toggle',
  'annotation.set',
  // Block/child properties
  'block.set',
  'block.unset',
  'child.set',
  'child.unset',
  // List items
  'list item.add',
  'list item.remove',
  'list item.toggle',
  // Moving
  'move.backward',
  'move.forward',
  'move.block',
  'move.block down',
  'move.block up',
])

function isMutationEvent(event: BehaviorEvent): boolean {
  return MUTATION_EVENT_TYPES.has(event.type)
}

/**
 * An intercepted event from suggest mode.
 *
 * Contains the original behavior event and the editor snapshot at the time
 * of interception. The consumer uses this to create suggestions.
 *
 * @alpha
 */
export interface SuggestModeInterceptEvent {
  /**
   * The original behavior event that was intercepted.
   */
  event: BehaviorEvent
  /**
   * Editor snapshot at the time of interception.
   * Contains selection, value, and schema.
   */
  snapshot: EditorSnapshot
}

/**
 * Configuration for the suggest mode behavior.
 *
 * @alpha
 */
export interface SuggestModeBehaviorConfig {
  /**
   * Controls whether the behavior should intercept mutation events.
   *
   * **Veto pattern (recommended):** When the state machine is in suggesting
   * mode, return `false` to temporarily bypass interception (e.g., during
   * accept/reject where mutations must reach the document). Return `undefined`
   * to defer to the state machine.
   *
   * **Legacy activation (deprecated):** When the state machine is NOT in
   * suggesting mode, returning `true` enables interception as a fallback —
   * but this causes a snapshot inconsistency (`snapshot.context.suggesting`
   * will report `false`) and emits a deprecation warning. Migrate to
   * `editor.send({type: 'update suggestMode', suggesting: true})` instead.
   *
   * @deprecated for enabling suggest mode. Use the state machine API instead.
   * Will be kept as a veto/bypass mechanism in future versions.
   */
  isActive?: () => boolean | undefined
  /**
   * Called when a mutation event is intercepted in suggest mode.
   * The consumer should create a suggestion from the event.
   */
  onIntercept: (interceptEvent: SuggestModeInterceptEvent) => void
}

/**
 * Create a suggest mode behavior that intercepts mutation events.
 *
 * When active, this behavior catches all document-mutating events
 * (insert, delete, split, style changes, etc.) and redirects them
 * to the `onIntercept` callback instead of modifying the document.
 *
 * This is a **consumer behavior** — it's registered via `editor.registerBehavior()`
 * and takes priority over PTE's built-in abstract behaviors.
 *
 * Non-mutation events (selection, focus, keyboard, clipboard read, history)
 * pass through to normal PTE handling.
 *
 * @example
 * ```tsx
 * const behavior = createSuggestModeBehavior({
 *   isActive: () => suggestModeEnabled,
 *   onIntercept: ({event, snapshot}) => {
 *     if (event.type === 'insert.text') {
 *       createInsertSuggestion(event.text, snapshot.context.selection)
 *     }
 *   },
 * })
 *
 * // Register with the editor
 * const unregister = editor.registerBehavior({behavior})
 * ```
 *
 * @alpha
 */
export function createSuggestModeBehavior(
  config: SuggestModeBehaviorConfig,
): Behavior {
  return defineBehavior({
    on: '*',
    guard: ({event, snapshot}) => {
      const stateMachineSuggesting = snapshot.context.suggesting

      if (stateMachineSuggesting) {
        // State machine says suggesting. isActive() can veto (return false)
        // to temporarily bypass interception (e.g., during accept/reject).
        if (config.isActive?.() === false) return false
      } else if (!stateMachineSuggesting && config.isActive?.() === true) {
        // Legacy fallback: isActive() says active but state machine disagrees.
        // This is deprecated — warn but still intercept for backwards compat.
        console.warn(
          'Suggest mode: isActive() returned true but the state machine is not in suggesting mode. ' +
            'This causes snapshot.context.suggesting to report false while mutations are intercepted. ' +
            'Migrate to editor.send({type: "update suggestMode", suggesting: true}) instead. ' +
            'The isActive() option is deprecated and will be removed in a future major version.',
        )
      } else {
        return false
      }

      if (!isMutationEvent(event)) return false
      return true
    },
    actions: [
      ({event, snapshot}) => [
        effect(() => {
          config.onIntercept({event, snapshot})
        }),
      ],
    ],
  })
}
