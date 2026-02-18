/**
 * Browser tests for suggest mode behavior interception.
 *
 * These tests verify that when suggest mode is active:
 * - Typing creates suggestions instead of editing the base document
 * - Delete creates delete suggestions
 * - The base document remains unchanged
 * - Toggling suggest mode off restores normal editing
 * - Non-mutation events (selection, focus) pass through normally
 *
 * Phase 2B tests verify suggestion continuation:
 * - Consecutive keystrokes at the same position extend a single suggestion
 * - Backspace shrinks the current insert suggestion
 * - Delete extends adjacent delete suggestions
 */
import {defineSchema} from '@portabletext/schema'
import {createTestKeyGenerator, getTersePt} from '@portabletext/test'
import React from 'react'
import {describe, expect, test, vi} from 'vitest'
import {render} from 'vitest-browser-react'
import {page, userEvent} from 'vitest/browser'
import {
  createSuggestModeBehavior,
  EditorProvider,
  PortableTextEditable,
  suggestionsToDecorations,
  useEditor,
  type Editor,
  type EditorSelection,
  type InsertSuggestion,
  type Suggestion,
  type SuggestModeInterceptEvent,
} from '../src'
import {EditorRefPlugin} from '../src/plugins/plugin.editor-ref'
import {createTestEditor, createTestEditors} from '../src/test/vitest'
// ===========================================================================
// Phase 2B: Suggestion continuation
// ===========================================================================

// Path / selection comparison helpers (mirrors suggest-mode-plugin.tsx)
import type {EditorSelectionPoint} from '../src/types/editor'
import type {SuggestionConfig} from '../src/types/suggestion'
import {
  getPlainTextFromSuggestion,
  textToSuggestionContent,
} from '../src/types/suggestion'

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function helloWorldValue() {
  return [
    {
      _type: 'block',
      _key: 'b1',
      children: [{_type: 'span', _key: 's1', text: 'Hello world'}],
      markDefs: [],
    },
  ]
}

/**
 * Set up a test editor with suggest mode behavior.
 * Returns the editor, locator, and a way to control suggest mode + collect suggestions.
 */
async function createSuggestModeEditor() {
  const suggestions: Suggestion[] = []
  let suggestModeActive = false
  let nextId = 1

  const interceptedEvents: SuggestModeInterceptEvent[] = []

  const behavior = createSuggestModeBehavior({
    isActive: () => suggestModeActive,
    onIntercept: (interceptEvent) => {
      interceptedEvents.push(interceptEvent)
      const {event, snapshot} = interceptEvent
      const selection = snapshot.context.selection
      if (!selection) return

      const id = `suggest-${nextId++}`

      if (event.type === 'insert.text' && 'text' in event) {
        suggestions.push({
          type: 'insert',
          id,
          selection: {anchor: selection.anchor, focus: selection.anchor},
          content: textToSuggestionContent(event.text),
        })
      } else if (
        event.type === 'delete' ||
        event.type === 'delete.backward' ||
        event.type === 'delete.forward' ||
        event.type === 'delete.text'
      ) {
        const isExpanded =
          selection.anchor.offset !== selection.focus.offset ||
          JSON.stringify(selection.anchor.path) !==
            JSON.stringify(selection.focus.path)
        if (isExpanded) {
          suggestions.push({
            type: 'delete',
            id,
            selection,
          })
        }
      }
    },
  })

  const {editor, locator} = await createTestEditor({
    initialValue: helloWorldValue(),
  })

  // Register the behavior
  const unregister = editor.registerBehavior({behavior})

  return {
    editor,
    locator,
    suggestions,
    interceptedEvents,
    enableSuggestMode: () => {
      suggestModeActive = true
    },
    disableSuggestMode: () => {
      suggestModeActive = false
    },
    unregister,
  }
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('Suggest mode: basic interception', () => {
  test('typing in suggest mode creates insert suggestion, base doc unchanged', async () => {
    const {editor, locator, suggestions, enableSuggestMode} =
      await createSuggestModeEditor()

    // Click to focus and place cursor at offset 5 (after "Hello")
    await locator.click()
    editor.send({
      type: 'select',
      at: {
        anchor: {path: [{_key: 'b1'}, 'children', {_key: 's1'}], offset: 5},
        focus: {path: [{_key: 'b1'}, 'children', {_key: 's1'}], offset: 5},
      },
    })

    // Enable suggest mode
    enableSuggestMode()

    // Type a character — should be intercepted
    editor.send({type: 'insert.text', text: 'X'})

    // Verify: suggestion was created
    expect(suggestions).toHaveLength(1)
    expect(suggestions[0]!.type).toBe('insert')
    const insertSuggestion = suggestions[0] as InsertSuggestion
    expect(getPlainTextFromSuggestion(insertSuggestion)).toBe('X')

    // Verify: base document is unchanged
    await vi.waitFor(() => {
      expect(locator).toHaveTextContent('Hello world')
    })
  })

  test('typing in edit mode (suggest off) edits document normally', async () => {
    const {editor, locator, suggestions} = await createSuggestModeEditor()

    // Click to focus
    await locator.click()
    editor.send({
      type: 'select',
      at: {
        anchor: {path: [{_key: 'b1'}, 'children', {_key: 's1'}], offset: 5},
        focus: {path: [{_key: 'b1'}, 'children', {_key: 's1'}], offset: 5},
      },
    })

    // Suggest mode is OFF by default — type normally
    editor.send({type: 'insert.text', text: 'X'})

    // Verify: no suggestions created
    expect(suggestions).toHaveLength(0)

    // Verify: document was edited
    await vi.waitFor(() => {
      expect(locator).toHaveTextContent('HelloX world')
    })
  })

  test('delete with expanded selection in suggest mode creates delete suggestion', async () => {
    const {editor, locator, suggestions, enableSuggestMode} =
      await createSuggestModeEditor()

    await locator.click()

    // Select "world" (offset 6-11)
    editor.send({
      type: 'select',
      at: {
        anchor: {path: [{_key: 'b1'}, 'children', {_key: 's1'}], offset: 6},
        focus: {path: [{_key: 'b1'}, 'children', {_key: 's1'}], offset: 11},
      },
    })

    enableSuggestMode()

    // Delete the selection — should be intercepted
    editor.send({type: 'delete'})

    // Verify: delete suggestion created
    expect(suggestions).toHaveLength(1)
    expect(suggestions[0]!.type).toBe('delete')

    // Verify: base document unchanged
    await vi.waitFor(() => {
      expect(locator).toHaveTextContent('Hello world')
    })
  })

  test('toggling suggest mode off restores normal editing', async () => {
    const {
      editor,
      locator,
      suggestions,
      enableSuggestMode,
      disableSuggestMode,
    } = await createSuggestModeEditor()

    await locator.click()
    editor.send({
      type: 'select',
      at: {
        anchor: {path: [{_key: 'b1'}, 'children', {_key: 's1'}], offset: 5},
        focus: {path: [{_key: 'b1'}, 'children', {_key: 's1'}], offset: 5},
      },
    })

    // Enable suggest mode, type
    enableSuggestMode()
    editor.send({type: 'insert.text', text: 'A'})
    expect(suggestions).toHaveLength(1)

    // Disable suggest mode, type
    disableSuggestMode()
    editor.send({type: 'insert.text', text: 'B'})

    // Only 1 suggestion (from suggest mode), not 2
    expect(suggestions).toHaveLength(1)

    // Document was edited by the second insert
    await vi.waitFor(() => {
      expect(locator).toHaveTextContent('HelloB world')
    })
  })

  test('selection events pass through in suggest mode', async () => {
    const {editor, locator, interceptedEvents, enableSuggestMode} =
      await createSuggestModeEditor()

    await locator.click()
    enableSuggestMode()

    // Send a select event — should NOT be intercepted
    editor.send({
      type: 'select',
      at: {
        anchor: {path: [{_key: 'b1'}, 'children', {_key: 's1'}], offset: 3},
        focus: {path: [{_key: 'b1'}, 'children', {_key: 's1'}], offset: 3},
      },
    })

    // No interception events for selection
    expect(
      interceptedEvents.filter((e) => e.event.type === 'select'),
    ).toHaveLength(0)
  })

  test('select + type in suggest mode creates replace suggestion', async () => {
    const {editor, locator, suggestions, enableSuggestMode} =
      await createSuggestModeEditor()

    await locator.click()

    // Select "world" (offset 6-11)
    editor.send({
      type: 'select',
      at: {
        anchor: {path: [{_key: 'b1'}, 'children', {_key: 's1'}], offset: 6},
        focus: {path: [{_key: 'b1'}, 'children', {_key: 's1'}], offset: 11},
      },
    })

    enableSuggestMode()

    // Type with selection — this fires insert.text which we intercept
    // The consumer would create a replace suggestion from the expanded selection + text
    editor.send({type: 'insert.text', text: 'earth'})

    // Verify: insert suggestion created (the behavior intercepts insert.text)
    // Note: creating a "replace" from insert.text + expanded selection is consumer logic
    expect(suggestions).toHaveLength(1)
    expect(suggestions[0]!.type).toBe('insert')

    // Verify: base document unchanged
    await vi.waitFor(() => {
      expect(locator).toHaveTextContent('Hello world')
    })
  })

  test('multiple intercepted events accumulate suggestions', async () => {
    const {editor, locator, suggestions, enableSuggestMode} =
      await createSuggestModeEditor()

    await locator.click()
    editor.send({
      type: 'select',
      at: {
        anchor: {path: [{_key: 'b1'}, 'children', {_key: 's1'}], offset: 5},
        focus: {path: [{_key: 'b1'}, 'children', {_key: 's1'}], offset: 5},
      },
    })

    enableSuggestMode()

    // Type multiple characters
    editor.send({type: 'insert.text', text: 'A'})
    editor.send({type: 'insert.text', text: 'B'})
    editor.send({type: 'insert.text', text: 'C'})

    // Each creates a separate suggestion
    expect(suggestions).toHaveLength(3)
    expect(getPlainTextFromSuggestion(suggestions[0] as InsertSuggestion)).toBe(
      'A',
    )
    expect(getPlainTextFromSuggestion(suggestions[1] as InsertSuggestion)).toBe(
      'B',
    )
    expect(getPlainTextFromSuggestion(suggestions[2] as InsertSuggestion)).toBe(
      'C',
    )

    // Base document unchanged
    await vi.waitFor(() => {
      expect(locator).toHaveTextContent('Hello world')
    })
  })

  test('intercepted event includes correct snapshot with selection', async () => {
    const {editor, locator, interceptedEvents, enableSuggestMode} =
      await createSuggestModeEditor()

    await locator.click()
    editor.send({
      type: 'select',
      at: {
        anchor: {path: [{_key: 'b1'}, 'children', {_key: 's1'}], offset: 7},
        focus: {path: [{_key: 'b1'}, 'children', {_key: 's1'}], offset: 7},
      },
    })

    enableSuggestMode()
    editor.send({type: 'insert.text', text: 'Z'})

    expect(interceptedEvents).toHaveLength(1)
    const {event, snapshot} = interceptedEvents[0]!

    // Event is the original insert.text
    expect(event.type).toBe('insert.text')
    expect('text' in event && event.text).toBe('Z')

    // Snapshot has the selection at offset 7
    expect(snapshot.context.selection?.anchor.offset).toBe(7)
  })

  test('style events are intercepted in suggest mode', async () => {
    const {editor, locator, interceptedEvents, enableSuggestMode} =
      await createSuggestModeEditor()

    await locator.click()

    // Select some text
    editor.send({
      type: 'select',
      at: {
        anchor: {path: [{_key: 'b1'}, 'children', {_key: 's1'}], offset: 0},
        focus: {path: [{_key: 'b1'}, 'children', {_key: 's1'}], offset: 5},
      },
    })

    enableSuggestMode()

    // Try to bold — should be intercepted
    editor.send({type: 'style.toggle', style: 'strong'})

    // Verify: event was intercepted
    expect(interceptedEvents).toHaveLength(1)
    expect(interceptedEvents[0]!.event.type).toBe('style.toggle')

    // Verify: text is NOT bold (base doc unchanged)
    await vi.waitFor(() => {
      expect(locator).toHaveTextContent('Hello world')
    })
  })
})

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

/**
 * Set up a test editor with suggest mode behavior that implements
 * Phase 2B continuation logic (matching SuggestModePlugin behavior).
 *
 * - Consecutive insert.text at the same position extends a single suggestion
 * - delete.backward on an insert suggestion shrinks it
 * - delete.backward/forward extends adjacent delete suggestions
 */
async function createContinuationEditor() {
  const suggestions: Suggestion[] = []
  let suggestModeActive = false
  let nextId = 1

  function findInsertAtPoint(
    point: EditorSelectionPoint,
  ): InsertSuggestion | undefined {
    return suggestions.find(
      (s): s is InsertSuggestion =>
        s.type === 'insert' && pointsEqual(s.selection.anchor, point),
    )
  }

  function findAdjacentDelete(
    point: EditorSelectionPoint,
    direction: 'backward' | 'forward',
  ): {index: number; suggestion: Suggestion} | undefined {
    for (let i = 0; i < suggestions.length; i++) {
      const s = suggestions[i]!
      if (s.type !== 'delete') continue
      if (!pathsEqual(s.selection.anchor.path, point.path)) continue
      if (!pathsEqual(s.selection.focus.path, point.path)) continue

      const startOffset = Math.min(
        s.selection.anchor.offset,
        s.selection.focus.offset,
      )
      const endOffset = Math.max(
        s.selection.anchor.offset,
        s.selection.focus.offset,
      )

      if (direction === 'backward' && point.offset === startOffset) {
        return {index: i, suggestion: s}
      }
      if (direction === 'forward' && point.offset === endOffset) {
        return {index: i, suggestion: s}
      }
    }
    return undefined
  }

  const behavior = createSuggestModeBehavior({
    isActive: () => suggestModeActive,
    onIntercept: ({event, snapshot}) => {
      const selection = snapshot.context.selection
      if (!selection) return

      switch (event.type) {
        case 'insert.text': {
          if (!('text' in event) || !event.text) return
          const cursorPoint = selection.anchor

          // Continuation: extend existing insert suggestion at this position
          const existing = findInsertAtPoint(cursorPoint)
          if (existing) {
            const plainText = getPlainTextFromSuggestion(existing)
            const idx = suggestions.indexOf(existing)
            suggestions[idx] = {
              ...existing,
              content: textToSuggestionContent(plainText + event.text),
            }
          } else {
            suggestions.push({
              type: 'insert',
              id: `suggest-${nextId++}`,
              selection: {anchor: cursorPoint, focus: cursorPoint},
              content: textToSuggestionContent(event.text),
            })
          }
          break
        }

        case 'delete.backward': {
          const cursorPoint = selection.anchor

          if (selectionIsCollapsed(selection)) {
            // 1. Shrink existing insert suggestion
            const existingInsert = findInsertAtPoint(cursorPoint)
            if (existingInsert) {
              const plainText = getPlainTextFromSuggestion(existingInsert)
              if (plainText.length <= 1) {
                // Remove suggestion entirely
                const idx = suggestions.indexOf(existingInsert)
                suggestions.splice(idx, 1)
              } else {
                const idx = suggestions.indexOf(existingInsert)
                suggestions[idx] = {
                  ...existingInsert,
                  content: textToSuggestionContent(plainText.slice(0, -1)),
                }
              }
              break
            }

            // 2. Extend adjacent delete suggestion backward
            const adjacent = findAdjacentDelete(cursorPoint, 'backward')
            if (adjacent && cursorPoint.offset > 0) {
              const {index, suggestion} = adjacent
              const startOffset = Math.min(
                suggestion.selection.anchor.offset,
                suggestion.selection.focus.offset,
              )
              const endOffset = Math.max(
                suggestion.selection.anchor.offset,
                suggestion.selection.focus.offset,
              )
              suggestions[index] = {
                ...suggestion,
                selection: {
                  anchor: {...cursorPoint, offset: startOffset - 1},
                  focus: {...cursorPoint, offset: endOffset},
                },
              }
              break
            }

            // 3. New delete suggestion for the character before cursor
            if (cursorPoint.offset > 0) {
              suggestions.push({
                type: 'delete',
                id: `suggest-${nextId++}`,
                selection: {
                  anchor: {...cursorPoint, offset: cursorPoint.offset - 1},
                  focus: cursorPoint,
                },
              })
            }
          } else {
            // Expanded selection delete
            suggestions.push({
              type: 'delete',
              id: `suggest-${nextId++}`,
              selection,
            })
          }
          break
        }

        case 'delete.forward': {
          const cursorPoint = selection.anchor

          if (selectionIsCollapsed(selection)) {
            // Extend adjacent delete suggestion forward
            const adjacent = findAdjacentDelete(cursorPoint, 'forward')
            if (adjacent) {
              const {index, suggestion} = adjacent
              const startOffset = Math.min(
                suggestion.selection.anchor.offset,
                suggestion.selection.focus.offset,
              )
              const endOffset = Math.max(
                suggestion.selection.anchor.offset,
                suggestion.selection.focus.offset,
              )
              suggestions[index] = {
                ...suggestion,
                selection: {
                  anchor: {...cursorPoint, offset: startOffset},
                  focus: {...cursorPoint, offset: endOffset + 1},
                },
              }
              break
            }

            // New delete suggestion for the character after cursor
            suggestions.push({
              type: 'delete',
              id: `suggest-${nextId++}`,
              selection: {
                anchor: cursorPoint,
                focus: {...cursorPoint, offset: cursorPoint.offset + 1},
              },
            })
          } else {
            suggestions.push({
              type: 'delete',
              id: `suggest-${nextId++}`,
              selection,
            })
          }
          break
        }

        case 'delete':
        case 'delete.text': {
          const isExpanded = !selectionIsCollapsed(selection)
          if (isExpanded) {
            suggestions.push({
              type: 'delete',
              id: `suggest-${nextId++}`,
              selection,
            })
          }
          break
        }

        case 'insert.break':
        case 'insert.soft break':
        case 'split': {
          const cursorPoint = selection.anchor
          const existing = findInsertAtPoint(cursorPoint)
          if (existing) {
            const plainText = getPlainTextFromSuggestion(existing)
            const idx = suggestions.indexOf(existing)
            suggestions[idx] = {
              ...existing,
              content: textToSuggestionContent(plainText + '\n'),
            }
          } else {
            suggestions.push({
              type: 'insert',
              id: `suggest-${nextId++}`,
              selection: {anchor: selection.anchor, focus: selection.anchor},
              content: textToSuggestionContent('\n'),
            })
          }
          break
        }

        default:
          break
      }
    },
  })

  const {editor, locator} = await createTestEditor({
    initialValue: helloWorldValue(),
  })

  const unregister = editor.registerBehavior({behavior})

  return {
    editor,
    locator,
    suggestions,
    enableSuggestMode: () => {
      suggestModeActive = true
    },
    disableSuggestMode: () => {
      suggestModeActive = false
    },
    unregister,
  }
}

const spanPath = [{_key: 'b1'}, 'children', {_key: 's1'}]

describe('Suggest mode: continuation (Phase 2B)', () => {
  test('consecutive typing at same position creates ONE suggestion, not many', async () => {
    const {editor, locator, suggestions, enableSuggestMode} =
      await createContinuationEditor()

    await locator.click()
    editor.send({
      type: 'select',
      at: {
        anchor: {path: spanPath, offset: 5},
        focus: {path: spanPath, offset: 5},
      },
    })

    enableSuggestMode()

    // Type "hello" — 5 keystrokes
    editor.send({type: 'insert.text', text: 'h'})
    editor.send({type: 'insert.text', text: 'e'})
    editor.send({type: 'insert.text', text: 'l'})
    editor.send({type: 'insert.text', text: 'l'})
    editor.send({type: 'insert.text', text: 'o'})

    // Should be ONE suggestion with content "hello"
    expect(suggestions).toHaveLength(1)
    expect(suggestions[0]!.type).toBe('insert')
    expect(getPlainTextFromSuggestion(suggestions[0] as InsertSuggestion)).toBe(
      'hello',
    )

    // Base doc unchanged
    await vi.waitFor(() => {
      expect(locator).toHaveTextContent('Hello world')
    })
  })

  test('typing at different positions creates separate suggestions', async () => {
    const {editor, locator, suggestions, enableSuggestMode} =
      await createContinuationEditor()

    await locator.click()
    enableSuggestMode()

    // Type at offset 5
    editor.send({
      type: 'select',
      at: {
        anchor: {path: spanPath, offset: 5},
        focus: {path: spanPath, offset: 5},
      },
    })
    editor.send({type: 'insert.text', text: 'A'})
    editor.send({type: 'insert.text', text: 'B'})

    // Move cursor to offset 0 and type
    editor.send({
      type: 'select',
      at: {
        anchor: {path: spanPath, offset: 0},
        focus: {path: spanPath, offset: 0},
      },
    })
    editor.send({type: 'insert.text', text: 'X'})
    editor.send({type: 'insert.text', text: 'Y'})

    // Two separate suggestions
    expect(suggestions).toHaveLength(2)
    expect(getPlainTextFromSuggestion(suggestions[0] as InsertSuggestion)).toBe(
      'AB',
    )
    expect(getPlainTextFromSuggestion(suggestions[1] as InsertSuggestion)).toBe(
      'XY',
    )
  })

  test('backspace shrinks an existing insert suggestion', async () => {
    const {editor, locator, suggestions, enableSuggestMode} =
      await createContinuationEditor()

    await locator.click()
    editor.send({
      type: 'select',
      at: {
        anchor: {path: spanPath, offset: 5},
        focus: {path: spanPath, offset: 5},
      },
    })

    enableSuggestMode()

    // Type "abc"
    editor.send({type: 'insert.text', text: 'a'})
    editor.send({type: 'insert.text', text: 'b'})
    editor.send({type: 'insert.text', text: 'c'})
    expect(getPlainTextFromSuggestion(suggestions[0] as InsertSuggestion)).toBe(
      'abc',
    )

    // Backspace — should shrink to "ab"
    editor.send({type: 'delete.backward', unit: 'character'})
    expect(suggestions).toHaveLength(1)
    expect(getPlainTextFromSuggestion(suggestions[0] as InsertSuggestion)).toBe(
      'ab',
    )

    // Backspace again — "a"
    editor.send({type: 'delete.backward', unit: 'character'})
    expect(getPlainTextFromSuggestion(suggestions[0] as InsertSuggestion)).toBe(
      'a',
    )

    // Base doc unchanged
    await vi.waitFor(() => {
      expect(locator).toHaveTextContent('Hello world')
    })
  })

  test('backspace removes suggestion entirely when content becomes empty', async () => {
    const {editor, locator, suggestions, enableSuggestMode} =
      await createContinuationEditor()

    await locator.click()
    editor.send({
      type: 'select',
      at: {
        anchor: {path: spanPath, offset: 5},
        focus: {path: spanPath, offset: 5},
      },
    })

    enableSuggestMode()

    // Type one character
    editor.send({type: 'insert.text', text: 'X'})
    expect(suggestions).toHaveLength(1)

    // Backspace — suggestion should be removed entirely
    editor.send({type: 'delete.backward', unit: 'character'})
    expect(suggestions).toHaveLength(0)
  })

  test('backspace with no insert suggestion creates delete suggestion', async () => {
    const {editor, locator, suggestions, enableSuggestMode} =
      await createContinuationEditor()

    await locator.click()
    editor.send({
      type: 'select',
      at: {
        anchor: {path: spanPath, offset: 5},
        focus: {path: spanPath, offset: 5},
      },
    })

    enableSuggestMode()

    // Backspace at offset 5 with no existing insert suggestion
    // Should create a delete suggestion covering offset 4-5 (the "o" in "Hello")
    editor.send({type: 'delete.backward', unit: 'character'})

    expect(suggestions).toHaveLength(1)
    expect(suggestions[0]!.type).toBe('delete')
    expect(suggestions[0]!.selection.anchor.offset).toBe(4)
    expect(suggestions[0]!.selection.focus.offset).toBe(5)
  })

  test('consecutive backspaces extend delete suggestion backward', async () => {
    const {editor, locator, suggestions, enableSuggestMode} =
      await createContinuationEditor()

    await locator.click()
    editor.send({
      type: 'select',
      at: {
        anchor: {path: spanPath, offset: 5},
        focus: {path: spanPath, offset: 5},
      },
    })

    enableSuggestMode()

    // First backspace: creates delete suggestion at 4-5
    editor.send({type: 'delete.backward', unit: 'character'})
    expect(suggestions).toHaveLength(1)
    expect(suggestions[0]!.selection.anchor.offset).toBe(4)
    expect(suggestions[0]!.selection.focus.offset).toBe(5)

    // Second backspace at offset 4 (adjacent to delete start):
    // extends to 3-5
    editor.send({
      type: 'select',
      at: {
        anchor: {path: spanPath, offset: 4},
        focus: {path: spanPath, offset: 4},
      },
    })
    editor.send({type: 'delete.backward', unit: 'character'})
    expect(suggestions).toHaveLength(1)
    expect(suggestions[0]!.selection.anchor.offset).toBe(3)
    expect(suggestions[0]!.selection.focus.offset).toBe(5)

    // Third backspace at offset 3: extends to 2-5
    editor.send({
      type: 'select',
      at: {
        anchor: {path: spanPath, offset: 3},
        focus: {path: spanPath, offset: 3},
      },
    })
    editor.send({type: 'delete.backward', unit: 'character'})
    expect(suggestions).toHaveLength(1)
    expect(suggestions[0]!.selection.anchor.offset).toBe(2)
    expect(suggestions[0]!.selection.focus.offset).toBe(5)

    // Base doc unchanged
    await vi.waitFor(() => {
      expect(locator).toHaveTextContent('Hello world')
    })
  })

  test('forward delete extends delete suggestion forward', async () => {
    const {editor, locator, suggestions, enableSuggestMode} =
      await createContinuationEditor()

    await locator.click()
    editor.send({
      type: 'select',
      at: {
        anchor: {path: spanPath, offset: 6},
        focus: {path: spanPath, offset: 6},
      },
    })

    enableSuggestMode()

    // Forward delete at offset 6: creates delete suggestion at 6-7
    editor.send({type: 'delete.forward', unit: 'character'})
    expect(suggestions).toHaveLength(1)
    expect(suggestions[0]!.selection.anchor.offset).toBe(6)
    expect(suggestions[0]!.selection.focus.offset).toBe(7)

    // Forward delete at offset 7 (adjacent to delete end): extends to 6-8
    editor.send({
      type: 'select',
      at: {
        anchor: {path: spanPath, offset: 7},
        focus: {path: spanPath, offset: 7},
      },
    })
    editor.send({type: 'delete.forward', unit: 'character'})
    expect(suggestions).toHaveLength(1)
    expect(suggestions[0]!.selection.anchor.offset).toBe(6)
    expect(suggestions[0]!.selection.focus.offset).toBe(8)

    // Base doc unchanged
    await vi.waitFor(() => {
      expect(locator).toHaveTextContent('Hello world')
    })
  })

  test('insert.break extends existing insert suggestion with newline', async () => {
    const {editor, locator, suggestions, enableSuggestMode} =
      await createContinuationEditor()

    await locator.click()
    editor.send({
      type: 'select',
      at: {
        anchor: {path: spanPath, offset: 5},
        focus: {path: spanPath, offset: 5},
      },
    })

    enableSuggestMode()

    // Type some text, then press Enter
    editor.send({type: 'insert.text', text: 'a'})
    editor.send({type: 'insert.text', text: 'b'})
    editor.send({type: 'insert.break'})
    editor.send({type: 'insert.text', text: 'c'})

    // Should be ONE suggestion with content "ab\nc"
    expect(suggestions).toHaveLength(1)
    expect(getPlainTextFromSuggestion(suggestions[0] as InsertSuggestion)).toBe(
      'ab\nc',
    )
  })

  test('type, backspace, type again continues the same suggestion', async () => {
    const {editor, locator, suggestions, enableSuggestMode} =
      await createContinuationEditor()

    await locator.click()
    editor.send({
      type: 'select',
      at: {
        anchor: {path: spanPath, offset: 5},
        focus: {path: spanPath, offset: 5},
      },
    })

    enableSuggestMode()

    // Type "abc"
    editor.send({type: 'insert.text', text: 'a'})
    editor.send({type: 'insert.text', text: 'b'})
    editor.send({type: 'insert.text', text: 'c'})

    // Backspace twice → "a"
    editor.send({type: 'delete.backward', unit: 'character'})
    editor.send({type: 'delete.backward', unit: 'character'})
    expect(getPlainTextFromSuggestion(suggestions[0] as InsertSuggestion)).toBe(
      'a',
    )

    // Type "xy" → "axy"
    editor.send({type: 'insert.text', text: 'x'})
    editor.send({type: 'insert.text', text: 'y'})

    // Still ONE suggestion
    expect(suggestions).toHaveLength(1)
    expect(getPlainTextFromSuggestion(suggestions[0] as InsertSuggestion)).toBe(
      'axy',
    )
  })
})

// ===========================================================================
// Real keyboard input tests (userEvent.type)
//
// All previous tests use editor.send() which goes through the behavior system
// directly. These tests use userEvent.type() which fires real keyboard events
// through the browser's contentEditable → Slate's beforeinput handler →
// Editor.insertText → behavior system. This exercises the full native input
// pipeline and catches issues where:
// - Slate's native insertion path bypasses preventDefault
// - DOM mutations happen before the behavior system can intercept
// - The behavior intercepts but the DOM is already mutated
// ===========================================================================

/**
 * Set up a test editor with suggest mode behavior AND suggestion decorations.
 * This is the full rendering pipeline: behavior intercepts events, creates
 * suggestions, and decorations render them in the DOM.
 *
 * Returns a rerender function that updates decorations from current suggestions.
 */
async function createRealInputEditor() {
  const suggestions: Suggestion[] = []
  let suggestModeActive = false
  let nextId = 1

  function findInsertAtPoint(
    point: EditorSelectionPoint,
  ): InsertSuggestion | undefined {
    return suggestions.find(
      (s): s is InsertSuggestion =>
        s.type === 'insert' && pointsEqual(s.selection.anchor, point),
    )
  }

  const behavior = createSuggestModeBehavior({
    isActive: () => suggestModeActive,
    onIntercept: ({event, snapshot}) => {
      const selection = snapshot.context.selection
      if (!selection) return

      if (event.type === 'insert.text' && 'text' in event && event.text) {
        const cursorPoint = selection.anchor
        const existing = findInsertAtPoint(cursorPoint)
        if (existing) {
          const plainText = getPlainTextFromSuggestion(existing)
          const idx = suggestions.indexOf(existing)
          suggestions[idx] = {
            ...existing,
            content: textToSuggestionContent(plainText + event.text),
          }
        } else {
          suggestions.push({
            type: 'insert',
            id: `suggest-${nextId++}`,
            selection: {anchor: cursorPoint, focus: cursorPoint},
            content: textToSuggestionContent(event.text),
          })
        }
      }
    },
  })

  const {editor, locator, rerender} = await createTestEditor({
    initialValue: helloWorldValue(),
  })

  const unregister = editor.registerBehavior({behavior})

  /**
   * Rebuild decorations from current suggestions and rerender.
   */
  async function rerenderDecorations() {
    const config: SuggestionConfig = {
      suggestions: [...suggestions],
      onAction: vi.fn(),
    }
    const decorations = suggestionsToDecorations(config)
    await rerender({
      initialValue: helloWorldValue(),
      editableProps: {rangeDecorations: decorations},
    })
  }

  return {
    editor,
    locator,
    suggestions,
    enableSuggestMode: () => {
      suggestModeActive = true
    },
    disableSuggestMode: () => {
      suggestModeActive = false
    },
    rerenderDecorations,
    unregister,
  }
}

describe('Suggest mode: real keyboard input (userEvent.type)', () => {
  test('real keyboard input in suggest mode creates suggestion, base doc unchanged', async () => {
    const {
      editor,
      locator,
      suggestions,
      enableSuggestMode,
      rerenderDecorations,
    } = await createRealInputEditor()

    // Focus and place cursor at offset 5 (after "Hello")
    await locator.click()
    editor.send({
      type: 'select',
      at: {
        anchor: {path: [{_key: 'b1'}, 'children', {_key: 's1'}], offset: 5},
        focus: {path: [{_key: 'b1'}, 'children', {_key: 's1'}], offset: 5},
      },
    })

    // Enable suggest mode
    enableSuggestMode()

    // Type using real keyboard input
    await userEvent.type(locator, 'abc')

    // Verify: suggestion was created with the typed text
    await vi.waitFor(() => {
      expect(suggestions.length).toBeGreaterThanOrEqual(1)
    })

    // The suggestion should contain "abc" (possibly as one or multiple suggestions
    // depending on continuation, but total text should be "abc")
    const totalText = suggestions
      .filter((s): s is InsertSuggestion => s.type === 'insert')
      .map((s) => getPlainTextFromSuggestion(s))
      .join('')
    expect(totalText).toBe('abc')

    // Verify: base document text is still "Hello world" — NOT "Helloabc world"
    const terse = getTersePt(editor.getSnapshot().context)
    expect(terse).toEqual(['Hello world'])

    // Rerender with decorations and verify suggestion is visible
    await rerenderDecorations()
    const insertedEl = page.getByTestId(
      `suggestion-${suggestions[0]!.id}-inserted`,
    )
    await vi.waitFor(() => expect.element(insertedEl).toBeInTheDocument())
  })

  test('real keyboard input order is preserved — no backwards text', async () => {
    const {
      editor,
      locator,
      suggestions,
      enableSuggestMode,
      rerenderDecorations,
    } = await createRealInputEditor()

    // Focus and place cursor at offset 5
    await locator.click()
    editor.send({
      type: 'select',
      at: {
        anchor: {path: [{_key: 'b1'}, 'children', {_key: 's1'}], offset: 5},
        focus: {path: [{_key: 'b1'}, 'children', {_key: 's1'}], offset: 5},
      },
    })

    enableSuggestMode()

    // Type "hello" character by character via real keyboard
    await userEvent.type(locator, 'hello')

    // Verify suggestion content is "hello" not "olleh"
    await vi.waitFor(() => {
      expect(suggestions.length).toBeGreaterThanOrEqual(1)
    })

    const totalText = suggestions
      .filter((s): s is InsertSuggestion => s.type === 'insert')
      .map((s) => getPlainTextFromSuggestion(s))
      .join('')
    expect(totalText).toBe('hello')

    // Base doc unchanged
    const terse = getTersePt(editor.getSnapshot().context)
    expect(terse).toEqual(['Hello world'])

    // Rerender with decorations and verify visual order
    await rerenderDecorations()
    const insertedEl = page.getByTestId(
      `suggestion-${suggestions[0]!.id}-inserted`,
    )
    await vi.waitFor(() =>
      expect.element(insertedEl).toHaveTextContent('hello'),
    )
  })

  test('suggest mode toggle per-editor — typing in one editor does not affect other', async () => {
    // This test needs two editors sharing a suggestion service.
    // Editor A: suggest mode ON → typing creates suggestions
    // Editor B: suggest mode OFF → typing edits base doc normally

    const suggestions: Suggestion[] = []
    let suggestModeA = false
    let nextId = 1

    const behaviorA = createSuggestModeBehavior({
      isActive: () => suggestModeA,
      onIntercept: ({event, snapshot}) => {
        const selection = snapshot.context.selection
        if (!selection) return
        if (event.type === 'insert.text' && 'text' in event && event.text) {
          suggestions.push({
            type: 'insert',
            id: `suggest-${nextId++}`,
            selection: {anchor: selection.anchor, focus: selection.anchor},
            content: textToSuggestionContent(event.text),
          })
        }
      },
    })

    // Editor B has suggest mode always OFF — no behavior registered
    const {editor, locator, editorB, locatorB} = await createTestEditors({
      initialValue: helloWorldValue(),
    })

    // Register suggest mode behavior only on Editor A
    const unregisterA = editor.registerBehavior({behavior: behaviorA})

    // Enable suggest mode on Editor A
    suggestModeA = true

    // Type in Editor A — should create suggestion, not edit doc
    await userEvent.click(locator)
    editor.send({type: 'focus'})
    editor.send({
      type: 'select',
      at: {
        anchor: {path: [{_key: 'b1'}, 'children', {_key: 's1'}], offset: 5},
        focus: {path: [{_key: 'b1'}, 'children', {_key: 's1'}], offset: 5},
      },
    })
    await userEvent.type(locator, 'XY')

    // Verify: suggestion created in Editor A
    await vi.waitFor(() => {
      expect(suggestions.length).toBeGreaterThanOrEqual(1)
    })

    // Verify: Editor A base doc unchanged
    const terseA = getTersePt(editor.getSnapshot().context)
    expect(terseA).toEqual(['Hello world'])

    // Type in Editor B — should edit doc normally (no suggest mode)
    await userEvent.click(locatorB)
    editorB.send({type: 'focus'})
    editorB.send({
      type: 'select',
      at: {
        anchor: {path: [{_key: 'b1'}, 'children', {_key: 's1'}], offset: 0},
        focus: {path: [{_key: 'b1'}, 'children', {_key: 's1'}], offset: 0},
      },
    })
    await userEvent.type(locatorB, 'ZZ')

    // Verify: Editor B doc was edited
    await vi.waitFor(() => {
      const terseB = getTersePt(editorB.getSnapshot().context)
      expect(terseB[0]).toContain('ZZ')
    })

    unregisterA()
  })
})

// ===========================================================================
// Playground-architecture reproduction test
//
// Josef's repro: type "hello world", enable suggest mode, type " aloha"
// → text goes into base doc AND/OR appears backwards.
//
// This test mirrors the playground's exact architecture:
// - SuggestModePlugin is a React component inside EditorProvider
// - It uses useEditor() to get the editor from context
// - It registers behavior in useEffect, unregisters on cleanup
// - Suggest mode is toggled via props (which update a ref)
// ===========================================================================

/**
 * Minimal SuggestModePlugin for testing — mirrors the playground's architecture.
 * Lives inside EditorProvider, uses useEditor(), registers behavior in useEffect.
 */
function TestSuggestModePlugin(props: {
  active: boolean
  onIntercept: (event: SuggestModeInterceptEvent) => void
}) {
  const editor = useEditor()
  const activeRef = React.useRef(props.active)
  activeRef.current = props.active

  const onInterceptRef = React.useRef(props.onIntercept)
  onInterceptRef.current = props.onIntercept

  React.useEffect(() => {
    const behavior = createSuggestModeBehavior({
      isActive: () => activeRef.current,
      onIntercept: (evt) => onInterceptRef.current(evt),
    })

    const unregister = editor.registerBehavior({behavior})
    return unregister
  }, [editor])

  return null
}

describe('Suggest mode: playground architecture reproduction', () => {
  test('type normally, enable suggest mode, type more — base doc unchanged', async () => {
    const editorRef = React.createRef<Editor>()
    const keyGen = createTestKeyGenerator()

    const suggestions: Suggestion[] = []
    let nextId = 1

    function handleIntercept({event, snapshot}: SuggestModeInterceptEvent) {
      const selection = snapshot.context.selection
      if (!selection) return

      if (event.type === 'insert.text' && 'text' in event && event.text) {
        const cursorPoint = selection.anchor
        // Continuation: find existing insert at same position
        const existing = suggestions.find(
          (s): s is InsertSuggestion =>
            s.type === 'insert' && pointsEqual(s.selection.anchor, cursorPoint),
        )
        if (existing) {
          const plainText = getPlainTextFromSuggestion(existing)
          const idx = suggestions.indexOf(existing)
          suggestions[idx] = {
            ...existing,
            content: textToSuggestionContent(plainText + event.text),
          }
        } else {
          suggestions.push({
            type: 'insert',
            id: `suggest-${nextId++}`,
            selection: {anchor: cursorPoint, focus: cursorPoint},
            content: textToSuggestionContent(event.text),
          })
        }
      }
    }

    // Wrapper that can toggle suggest mode via rerender
    function TestEditor(props: {suggestMode: boolean}) {
      return (
        <EditorProvider
          initialConfig={{
            keyGenerator: keyGen,
            schemaDefinition: defineSchema({}),
          }}
        >
          <EditorRefPlugin ref={editorRef} />
          <TestSuggestModePlugin
            active={props.suggestMode}
            onIntercept={handleIntercept}
          />
          <PortableTextEditable data-testid="editor" />
        </EditorProvider>
      )
    }

    // Step 1: Render with suggest mode OFF
    const renderResult = await render(<TestEditor suggestMode={false} />)
    const locator = page.getByTestId('editor')
    await vi.waitFor(() => expect.element(locator).toBeInTheDocument())

    const editor = editorRef.current!
    expect(editor).toBeTruthy()

    // Step 2: Type "hello world" normally (suggest mode OFF)
    await userEvent.click(locator)
    editor.send({type: 'focus'})
    await userEvent.type(locator, 'hello world')

    // Verify: doc contains "hello world"
    await vi.waitFor(() => {
      const terse = getTersePt(editor.getSnapshot().context)
      expect(terse[0]).toContain('hello world')
    })

    // No suggestions should exist yet
    expect(suggestions).toHaveLength(0)

    // Step 3: Enable suggest mode via rerender
    await renderResult.rerender(<TestEditor suggestMode={true} />)

    // Step 4: Type " aloha" in suggest mode
    await userEvent.type(locator, ' aloha')

    // Step 5: Assert — base doc should still be "hello world"
    await vi.waitFor(() => {
      const terse = getTersePt(editor.getSnapshot().context)
      expect(terse).toEqual(['hello world'])
    })

    // Suggestion should contain " aloha"
    expect(suggestions.length).toBeGreaterThanOrEqual(1)
    const totalText = suggestions
      .filter((s): s is InsertSuggestion => s.type === 'insert')
      .map((s) => getPlainTextFromSuggestion(s))
      .join('')
    expect(totalText).toBe(' aloha')
  })
})
