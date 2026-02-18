import {
  createSuggestModeBehavior,
  getPlainTextFromSuggestion,
  textToSuggestionContent,
  useEditor,
  type EditorSelection,
  type EditorSelectionPoint,
  type InsertSuggestion,
  type Suggestion,
  type SuggestModeInterceptEvent,
} from '@portabletext/editor'
import {useCallback, useEffect, useRef} from 'react'
import type {FakeSuggestionService} from './fake-suggestion-service'

// ---------------------------------------------------------------------------
// Path / selection comparison helpers
// ---------------------------------------------------------------------------

function pathsEqual(
  a: EditorSelectionPoint['path'],
  b: EditorSelectionPoint['path'],
): boolean {
  if (a.length !== b.length) return false
  for (let i = 0; i < a.length; i++) {
    const ai = a[i]
    const bi = b[i]
    if (typeof ai === 'string' && typeof bi === 'string') {
      if (ai !== bi) return false
    } else if (typeof ai === 'number' && typeof bi === 'number') {
      if (ai !== bi) return false
    } else if (typeof ai === 'object' && typeof bi === 'object') {
      if (ai !== null && bi !== null && '_key' in ai && '_key' in bi) {
        if (ai._key !== bi._key) return false
      } else {
        return false
      }
    } else {
      return false
    }
  }
  return true
}

function pointsEqual(
  a: EditorSelectionPoint,
  b: EditorSelectionPoint,
): boolean {
  return a.offset === b.offset && pathsEqual(a.path, b.path)
}

function selectionIsCollapsed(sel: NonNullable<EditorSelection>): boolean {
  return pointsEqual(sel.anchor, sel.focus)
}

// ---------------------------------------------------------------------------
// Suggestion lookup helpers
// ---------------------------------------------------------------------------

/**
 * Find an insert suggestion whose collapsed selection matches the given point.
 * In suggest mode the doc is frozen, so the cursor stays at the original
 * insert point — every subsequent keystroke at that point should extend
 * the same suggestion.
 */
function findInsertSuggestionAtPoint(
  suggestions: Suggestion[],
  point: EditorSelectionPoint,
): InsertSuggestion | undefined {
  return suggestions.find(
    (s): s is InsertSuggestion =>
      s.type === 'insert' && pointsEqual(s.selection.anchor, point),
  )
}

/**
 * Find a delete suggestion whose range is adjacent to the given point.
 * "Adjacent" means the point is at the anchor or focus edge of the
 * delete selection, so a further delete in the same direction extends it.
 *
 * Returns the suggestion and which edge matched ('anchor' | 'focus').
 */
function findAdjacentDeleteSuggestion(
  suggestions: Suggestion[],
  point: EditorSelectionPoint,
  direction: 'backward' | 'forward',
): {suggestion: Suggestion; edge: 'anchor' | 'focus'} | undefined {
  for (const s of suggestions) {
    if (s.type !== 'delete') continue
    // For backward delete: the point should be at the anchor (start) of the
    // delete range — we're extending backward from the start.
    // For forward delete: the point should be at the focus (end).
    //
    // We normalize: anchor is the earlier point, focus is the later point.
    // Since we only handle same-path for now, compare offsets.
    if (!pathsEqual(s.selection.anchor.path, point.path)) continue
    if (!pathsEqual(s.selection.focus.path, point.path)) continue

    const anchorOffset = s.selection.anchor.offset
    const focusOffset = s.selection.focus.offset
    const startOffset = Math.min(anchorOffset, focusOffset)
    const endOffset = Math.max(anchorOffset, focusOffset)

    if (direction === 'backward' && point.offset === startOffset) {
      return {
        suggestion: s,
        edge: anchorOffset <= focusOffset ? 'anchor' : 'focus',
      }
    }
    if (direction === 'forward' && point.offset === endOffset) {
      return {
        suggestion: s,
        edge: anchorOffset >= focusOffset ? 'anchor' : 'focus',
      }
    }
  }
  return undefined
}

// ---------------------------------------------------------------------------
// Content manipulation helpers
// ---------------------------------------------------------------------------

/**
 * Append text to an insert suggestion's content.
 * Appends to the last span of the last block.
 */
function appendTextToContent(
  suggestion: InsertSuggestion,
  text: string,
): InsertSuggestion {
  const plainText = getPlainTextFromSuggestion(suggestion)
  return {
    ...suggestion,
    content: textToSuggestionContent(plainText + text),
  }
}

/**
 * Remove the last character from an insert suggestion's content.
 * Returns null if the content becomes empty (suggestion should be removed).
 */
function removeLastCharFromContent(
  suggestion: InsertSuggestion,
): InsertSuggestion | null {
  const plainText = getPlainTextFromSuggestion(suggestion)
  if (plainText.length <= 1) return null
  return {
    ...suggestion,
    content: textToSuggestionContent(plainText.slice(0, -1)),
  }
}

// ---------------------------------------------------------------------------
// Plugin component
// ---------------------------------------------------------------------------

/**
 * Plugin component that registers the suggest mode behavior with the editor.
 *
 * Must be rendered inside an EditorProvider. When suggest mode is active,
 * typing creates suggestions instead of editing the base document.
 *
 * Phase 2B: Continuation — consecutive keystrokes at the same position
 * extend a single suggestion instead of creating one per keystroke.
 * Backspace shrinks the current insert suggestion. Delete extends
 * adjacent delete suggestions.
 */
export function SuggestModePlugin(props: {
  active: boolean
  service: FakeSuggestionService
}) {
  const editor = useEditor()
  const activeRef = useRef(props.active)
  activeRef.current = props.active

  // Trace prop changes
  useEffect(() => {
    console.log(
      `[SuggestModePlugin:render] active prop changed to: ${props.active}`,
    )
  }, [props.active])

  const serviceRef = useRef(props.service)
  serviceRef.current = props.service

  const nextIdRef = useRef(1)

  const onIntercept = useCallback(
    ({event, snapshot}: SuggestModeInterceptEvent) => {
      const selection = snapshot.context.selection
      if (!selection) return

      const service = serviceRef.current
      const suggestions = service.getSnapshot()

      switch (event.type) {
        case 'insert.text': {
          if (!('text' in event) || !event.text) return

          const cursorPoint = selection.anchor

          // Continuation: check if there's already an insert suggestion at this position
          const existing = findInsertSuggestionAtPoint(suggestions, cursorPoint)
          if (existing) {
            const updated = appendTextToContent(existing, event.text)
            service.updateSuggestion(updated)
          } else {
            // New insert suggestion
            const id = `suggest-${nextIdRef.current++}`
            const collapsedSelection = {
              anchor: selection.anchor,
              focus: selection.anchor,
            }
            service.addSuggestionImmediate({
              type: 'insert',
              id,
              selection: collapsedSelection,
              content: textToSuggestionContent(event.text),
            })
          }
          break
        }

        case 'delete.backward': {
          const cursorPoint = selection.anchor

          if (selectionIsCollapsed(selection)) {
            // Collapsed selection backspace

            // 1. Check if we're extending an existing insert suggestion (shrink it)
            const existingInsert = findInsertSuggestionAtPoint(
              suggestions,
              cursorPoint,
            )
            if (existingInsert) {
              const shrunk = removeLastCharFromContent(existingInsert)
              if (shrunk) {
                service.updateSuggestion(shrunk)
              } else {
                // Content is empty — remove the suggestion entirely
                service.removeSuggestion(existingInsert.id)
              }
              break
            }

            // 2. Check if we're adjacent to an existing delete suggestion (extend it)
            const adjacentDelete = findAdjacentDeleteSuggestion(
              suggestions,
              cursorPoint,
              'backward',
            )
            if (adjacentDelete && cursorPoint.offset > 0) {
              // Extend the delete range backward by one character
              const {suggestion} = adjacentDelete
              const newAnchorOffset =
                Math.min(
                  suggestion.selection.anchor.offset,
                  suggestion.selection.focus.offset,
                ) - 1
              const newFocusOffset = Math.max(
                suggestion.selection.anchor.offset,
                suggestion.selection.focus.offset,
              )
              service.updateSuggestion({
                ...suggestion,
                selection: {
                  anchor: {...cursorPoint, offset: newAnchorOffset},
                  focus: {...cursorPoint, offset: newFocusOffset},
                },
              })
              break
            }

            // 3. No existing suggestion — create a new delete suggestion
            //    covering the character before the cursor
            if (cursorPoint.offset > 0) {
              const id = `suggest-${nextIdRef.current++}`
              service.addSuggestionImmediate({
                type: 'delete',
                id,
                selection: {
                  anchor: {...cursorPoint, offset: cursorPoint.offset - 1},
                  focus: cursorPoint,
                },
              })
            }
          } else {
            // Expanded selection delete — create delete suggestion over selection
            const id = `suggest-${nextIdRef.current++}`
            service.addSuggestionImmediate({
              type: 'delete',
              id,
              selection,
            })
          }
          break
        }

        case 'delete.forward': {
          const cursorPoint = selection.anchor

          if (selectionIsCollapsed(selection)) {
            // Forward delete at collapsed selection

            // Check if adjacent to existing delete suggestion
            const adjacentDelete = findAdjacentDeleteSuggestion(
              suggestions,
              cursorPoint,
              'forward',
            )
            if (adjacentDelete) {
              const {suggestion} = adjacentDelete
              const startOffset = Math.min(
                suggestion.selection.anchor.offset,
                suggestion.selection.focus.offset,
              )
              const endOffset =
                Math.max(
                  suggestion.selection.anchor.offset,
                  suggestion.selection.focus.offset,
                ) + 1
              service.updateSuggestion({
                ...suggestion,
                selection: {
                  anchor: {...cursorPoint, offset: startOffset},
                  focus: {...cursorPoint, offset: endOffset},
                },
              })
              break
            }

            // New delete suggestion covering the character after the cursor
            // We don't know the text length here, so we trust the offset is valid
            const id = `suggest-${nextIdRef.current++}`
            service.addSuggestionImmediate({
              type: 'delete',
              id,
              selection: {
                anchor: cursorPoint,
                focus: {...cursorPoint, offset: cursorPoint.offset + 1},
              },
            })
          } else {
            // Expanded selection
            const id = `suggest-${nextIdRef.current++}`
            service.addSuggestionImmediate({
              type: 'delete',
              id,
              selection,
            })
          }
          break
        }

        case 'delete':
        case 'delete.text': {
          // Generic delete — only handle expanded selection
          const isExpanded = !selectionIsCollapsed(selection)
          if (isExpanded) {
            const id = `suggest-${nextIdRef.current++}`
            service.addSuggestionImmediate({
              type: 'delete',
              id,
              selection,
            })
          }
          break
        }

        case 'insert.break':
        case 'insert.soft break':
        case 'split': {
          const cursorPoint = selection.anchor

          // Continuation: if there's an insert suggestion at this position,
          // append a newline to it
          const existing = findInsertSuggestionAtPoint(suggestions, cursorPoint)
          if (existing) {
            const updated = appendTextToContent(existing, '\n')
            service.updateSuggestion(updated)
          } else {
            const id = `suggest-${nextIdRef.current++}`
            const collapsedSelection = {
              anchor: selection.anchor,
              focus: selection.anchor,
            }
            service.addSuggestionImmediate({
              type: 'insert',
              id,
              selection: collapsedSelection,
              content: textToSuggestionContent('\n'),
            })
          }
          break
        }

        default:
          // Other mutation events (style, decorator, annotation, etc.)
          // are intercepted but not yet handled — they don't modify the doc
          console.log(
            `[SuggestMode] Intercepted ${event.type} — not yet handled`,
          )
          break
      }
    },
    [],
  )

  useEffect(() => {
    console.log(
      `[SuggestModePlugin:useEffect] Registering behavior. editor=${!!editor} editorId=${(editor as any)?._internal?.slateEditor?.instance?.id ?? 'unknown'}`,
    )
    const behavior = createSuggestModeBehavior({
      isActive: () => {
        const active = activeRef.current
        const bypassing = serviceRef.current.isBypassing
        // Only log when active to avoid spam
        if (active) {
          console.log(
            `[SuggestModePlugin:isActive] active=${active} bypassing=${bypassing} → ${active && !bypassing}`,
          )
        }
        return active && !bypassing
      },
      onIntercept: (interceptEvent) => {
        console.log(
          `[SuggestModePlugin:onIntercept] event=${interceptEvent.event.type}`,
        )
        onIntercept(interceptEvent)
      },
    })

    const unregister = editor.registerBehavior({behavior})
    console.log(`[SuggestModePlugin:useEffect] Behavior registered.`)
    return () => {
      console.log(`[SuggestModePlugin:useEffect] Unregistering behavior.`)
      unregister()
    }
  }, [editor, onIntercept])

  return null
}
