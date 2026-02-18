/**
 * Browser tests for suggest mode behavior interception.
 *
 * These tests verify that when suggest mode is active:
 * - Typing creates suggestions instead of editing the base document
 * - Delete creates delete suggestions
 * - The base document remains unchanged
 * - Toggling suggest mode off restores normal editing
 * - Non-mutation events (selection, focus) pass through normally
 */
import {describe, expect, test, vi} from 'vitest'
import {createSuggestModeBehavior, type SuggestModeInterceptEvent} from '../src'
import {createTestEditor} from '../src/test/vitest'
import type {InsertSuggestion, Suggestion} from '../src/types/suggestion'
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
