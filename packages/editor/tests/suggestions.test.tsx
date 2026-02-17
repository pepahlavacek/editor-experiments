/**
 * Browser tests for content suggestion rendering and position tracking.
 *
 * These tests run in headless Chromium via vitest-browser-react, exercising
 * the full rendering pipeline: Suggestion → RangeDecoration → Slate leaf →
 * real DOM with contentEditable.
 *
 * The unit tests in suggestions-to-decorations.test.tsx cover the mapping
 * logic; these tests verify rendering + position tracking in a real editor.
 */
import {getTersePt} from '@portabletext/test'
import {describe, expect, test, vi} from 'vitest'
import {page} from 'vitest/browser'
import type {RangeDecoration, RangeDecorationOnMovedDetails} from '../src'
import {suggestionsToDecorations} from '../src'
import {createTestEditor} from '../src/test/vitest'
import type {
  DeleteSuggestion,
  InsertSuggestion,
  ReplaceSuggestion,
  Suggestion,
  SuggestionConfig,
} from '../src/types/suggestion'

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Standard initial value: single block "Hello world" with known keys.
 */
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
 * Make a selection pointing at block b1, span s1.
 */
function sel(
  anchorOffset: number,
  focusOffset: number,
): {
  anchor: {path: Array<{_key: string} | string>; offset: number}
  focus: {path: Array<{_key: string} | string>; offset: number}
} {
  return {
    anchor: {
      path: [{_key: 'b1'}, 'children', {_key: 's1'}],
      offset: anchorOffset,
    },
    focus: {
      path: [{_key: 'b1'}, 'children', {_key: 's1'}],
      offset: focusOffset,
    },
  }
}

/**
 * Helper to update decorations based on onMoved callback.
 * Mirrors the pattern from range-decorations-operations.test.tsx.
 */
function updateDecorations({
  decorations,
  details,
}: {
  decorations: Array<RangeDecoration>
  details: RangeDecorationOnMovedDetails
}): Array<RangeDecoration> {
  return decorations.flatMap((dec) => {
    if (
      dec.payload?.['suggestionId'] ===
      details.rangeDecoration.payload?.['suggestionId']
    ) {
      if (!details.newSelection) {
        return []
      }
      return [
        {
          ...dec,
          selection: details.newSelection,
        },
      ]
    }
    return [dec]
  })
}

// ---------------------------------------------------------------------------
// Rendering tests
// ---------------------------------------------------------------------------

describe('Suggestions: Rendering', () => {
  test('Replace suggestion renders strikethrough + green replacement text', async () => {
    const suggestion: ReplaceSuggestion = {
      type: 'replace',
      id: 'rep-1',
      selection: sel(6, 11), // "world"
      replacementText: 'earth',
    }
    const config: SuggestionConfig = {
      suggestions: [suggestion],
      onAction: vi.fn(),
    }
    const decorations = suggestionsToDecorations(config)

    const {locator} = await createTestEditor({
      initialValue: helloWorldValue(),
      editableProps: {rangeDecorations: decorations},
    })

    // The replace component wraps the original text
    const suggestionEl = locator.getByTestId('suggestion-rep-1')
    await vi.waitFor(() => expect.element(suggestionEl).toBeInTheDocument())

    // Original text should be in the deleted-text span (strikethrough)
    const deletedText = locator.getByTestId('suggestion-rep-1-deleted')
    await vi.waitFor(() =>
      expect.element(deletedText).toHaveTextContent('world'),
    )

    // Replacement text should be in the inserted-text span
    const insertedText = locator.getByTestId('suggestion-rep-1-inserted')
    await vi.waitFor(() =>
      expect.element(insertedText).toHaveTextContent('earth'),
    )
  })

  test('Insert suggestion renders zero-width decoration with injected text', async () => {
    const suggestion: InsertSuggestion = {
      type: 'insert',
      id: 'ins-1',
      selection: sel(5, 5), // collapsed at "Hello|world"
      insertedText: ' beautiful',
    }
    const config: SuggestionConfig = {
      suggestions: [suggestion],
      onAction: vi.fn(),
    }
    const decorations = suggestionsToDecorations(config)

    const {locator} = await createTestEditor({
      initialValue: helloWorldValue(),
      editableProps: {rangeDecorations: decorations},
    })

    // The insert component should be present with injected text.
    // For zero-width (collapsed) decorations, the component wraps a Slate
    // zero-width string and injects the preview text as contentEditable=false.
    // We verify the outer suggestion element renders, then check that the
    // injected text is visible via getByText on the page.
    const suggestionEl = page.getByTestId('suggestion-ins-1')
    await vi.waitFor(() => expect.element(suggestionEl).toBeInTheDocument())

    // The injected text should be visible in the document
    const insertedText = page.getByText(' beautiful', {exact: true})
    await vi.waitFor(() => expect.element(insertedText).toBeInTheDocument())
  })

  test('Delete suggestion renders strikethrough', async () => {
    const suggestion: DeleteSuggestion = {
      type: 'delete',
      id: 'del-1',
      selection: sel(6, 11), // "world"
    }
    const config: SuggestionConfig = {
      suggestions: [suggestion],
      onAction: vi.fn(),
    }
    const decorations = suggestionsToDecorations(config)

    const {locator} = await createTestEditor({
      initialValue: helloWorldValue(),
      editableProps: {rangeDecorations: decorations},
    })

    // The delete component wraps the text
    const suggestionEl = locator.getByTestId('suggestion-del-1')
    await vi.waitFor(() => expect.element(suggestionEl).toBeInTheDocument())

    // Text should be in the deleted-text span
    const deletedText = locator.getByTestId('suggestion-del-1-deleted')
    await vi.waitFor(() =>
      expect.element(deletedText).toHaveTextContent('world'),
    )
  })

  test('Accept/reject buttons render and are clickable', async () => {
    const onActionSpy = vi.fn()
    const suggestion: DeleteSuggestion = {
      type: 'delete',
      id: 'del-btn',
      selection: sel(6, 11), // "world"
    }
    const config: SuggestionConfig = {
      suggestions: [suggestion],
      onAction: onActionSpy,
    }
    const decorations = suggestionsToDecorations(config)

    const {locator} = await createTestEditor({
      initialValue: helloWorldValue(),
      editableProps: {rangeDecorations: decorations},
    })

    // Suggestion should render
    await vi.waitFor(() =>
      expect
        .element(locator.getByTestId('suggestion-del-btn'))
        .toBeInTheDocument(),
    )

    // Accept button — use page-level query since button is contentEditable=false
    const acceptBtn = page.getByTitle('Accept suggestion')
    await vi.waitFor(() => expect.element(acceptBtn).toBeInTheDocument())

    // Click accept
    await acceptBtn.click()
    expect(onActionSpy).toHaveBeenCalledWith({
      action: 'accept',
      suggestion,
    })

    // Reset and test reject
    onActionSpy.mockClear()
    const rejectBtn = page.getByTitle('Reject suggestion')
    await rejectBtn.click()
    expect(onActionSpy).toHaveBeenCalledWith({
      action: 'reject',
      suggestion,
    })
  })
})

// ---------------------------------------------------------------------------
// Position tracking tests
// ---------------------------------------------------------------------------

describe('Suggestions: Position Tracking', () => {
  test('Type before a suggestion → suggestion shifts right', async () => {
    const onMovedSpy = vi.fn()
    const suggestion: ReplaceSuggestion = {
      type: 'replace',
      id: 'rep-shift',
      selection: sel(6, 11), // "world"
      replacementText: 'earth',
    }

    const config: SuggestionConfig = {
      suggestions: [suggestion],
      onAction: vi.fn(),
    }
    let decorations = suggestionsToDecorations(config)

    // Wire up onMoved to track decoration updates
    decorations = decorations.map((dec) => ({
      ...dec,
      onMoved: (details: RangeDecorationOnMovedDetails) => {
        onMovedSpy(details)
        decorations = updateDecorations({decorations, details})
      },
    }))

    const {editor, locator, rerender} = await createTestEditor({
      initialValue: helloWorldValue(),
      editableProps: {rangeDecorations: decorations},
    })

    // Verify initial rendering
    await vi.waitFor(() =>
      expect
        .element(locator.getByTestId('suggestion-rep-shift'))
        .toBeInTheDocument(),
    )

    // Place cursor at start of text (offset 0)
    editor.send({
      type: 'select',
      at: sel(0, 0),
    })

    // Type "Hey " before the suggestion
    editor.send({type: 'insert.text', text: 'Hey '})

    // Wait for text to be inserted
    await vi.waitFor(() => {
      const terse = getTersePt(editor.getSnapshot().context)
      expect(terse[0]).toBe('Hey Hello world')
    })

    // onMoved should have been called
    expect(onMovedSpy).toHaveBeenCalled()
    const lastCall =
      onMovedSpy.mock.calls[onMovedSpy.mock.calls.length - 1]?.[0]
    expect(lastCall).toBeDefined()
    expect(lastCall.newSelection).not.toBeNull()

    // The new selection should be shifted right by 4 characters ("Hey " = 4 chars)
    expect(lastCall.newSelection.anchor.offset).toBe(10) // 6 + 4
    expect(lastCall.newSelection.focus.offset).toBe(15) // 11 + 4

    // Re-render with updated decorations
    await rerender({
      initialValue: editor.getSnapshot().context.value,
      editableProps: {rangeDecorations: decorations},
    })

    // Decoration should still highlight "world"
    const deletedText = locator.getByTestId('suggestion-rep-shift-deleted')
    await vi.waitFor(() =>
      expect.element(deletedText).toHaveTextContent('world'),
    )
  })

  test('Type after a suggestion → suggestion stays put', async () => {
    const onMovedSpy = vi.fn()
    const suggestion: DeleteSuggestion = {
      type: 'delete',
      id: 'del-stay',
      selection: sel(0, 5), // "Hello"
    }

    const config: SuggestionConfig = {
      suggestions: [suggestion],
      onAction: vi.fn(),
    }
    let decorations = suggestionsToDecorations(config)
    decorations = decorations.map((dec) => ({
      ...dec,
      onMoved: (details: RangeDecorationOnMovedDetails) => {
        onMovedSpy(details)
        decorations = updateDecorations({decorations, details})
      },
    }))

    const {editor, locator} = await createTestEditor({
      initialValue: helloWorldValue(),
      editableProps: {rangeDecorations: decorations},
    })

    // Verify initial rendering
    await vi.waitFor(() =>
      expect
        .element(locator.getByTestId('suggestion-del-stay'))
        .toBeInTheDocument(),
    )

    // Place cursor at end of text (offset 11)
    editor.send({
      type: 'select',
      at: sel(11, 11),
    })

    // Type "!!!" after the suggestion
    editor.send({type: 'insert.text', text: '!!!'})

    // Wait for text to be inserted
    await vi.waitFor(() => {
      const terse = getTersePt(editor.getSnapshot().context)
      expect(terse[0]).toBe('Hello world!!!')
    })

    // onMoved should NOT have been called — typing after doesn't affect the decoration
    expect(onMovedSpy).not.toHaveBeenCalled()
  })

  test('Delete text before a suggestion → suggestion shifts left', async () => {
    const onMovedSpy = vi.fn()
    const suggestion: ReplaceSuggestion = {
      type: 'replace',
      id: 'rep-left',
      selection: sel(6, 11), // "world"
      replacementText: 'earth',
    }

    const config: SuggestionConfig = {
      suggestions: [suggestion],
      onAction: vi.fn(),
    }
    let decorations = suggestionsToDecorations(config)
    decorations = decorations.map((dec) => ({
      ...dec,
      onMoved: (details: RangeDecorationOnMovedDetails) => {
        onMovedSpy(details)
        decorations = updateDecorations({decorations, details})
      },
    }))

    const {editor, locator, rerender} = await createTestEditor({
      initialValue: helloWorldValue(),
      editableProps: {rangeDecorations: decorations},
    })

    // Verify initial rendering
    await vi.waitFor(() =>
      expect
        .element(locator.getByTestId('suggestion-rep-left'))
        .toBeInTheDocument(),
    )

    // Select "Hello " (offset 0-6) and delete it
    editor.send({
      type: 'select',
      at: sel(0, 6),
    })
    editor.send({type: 'insert.text', text: ''})

    // Wait for deletion
    await vi.waitFor(() => {
      const terse = getTersePt(editor.getSnapshot().context)
      expect(terse[0]).toBe('world')
    })

    // onMoved should have been called with shifted selection
    expect(onMovedSpy).toHaveBeenCalled()
    const lastCall =
      onMovedSpy.mock.calls[onMovedSpy.mock.calls.length - 1]?.[0]
    expect(lastCall.newSelection).not.toBeNull()
    expect(lastCall.newSelection.anchor.offset).toBe(0) // 6 - 6
    expect(lastCall.newSelection.focus.offset).toBe(5) // 11 - 6

    // Re-render with updated decorations
    await rerender({
      initialValue: editor.getSnapshot().context.value,
      editableProps: {rangeDecorations: decorations},
    })

    // Decoration should still highlight "world"
    const deletedText = locator.getByTestId('suggestion-rep-left-deleted')
    await vi.waitFor(() =>
      expect.element(deletedText).toHaveTextContent('world'),
    )
  })

  test('Multiple suggestions on same block → all track independently', async () => {
    const onMovedSpy1 = vi.fn()
    const onMovedSpy2 = vi.fn()

    // "Hello world" — two suggestions: "Hello" (0-5) and "world" (6-11)
    const suggestion1: DeleteSuggestion = {
      type: 'delete',
      id: 'del-hello',
      selection: sel(0, 5), // "Hello"
    }
    const suggestion2: ReplaceSuggestion = {
      type: 'replace',
      id: 'rep-world',
      selection: sel(6, 11), // "world"
      replacementText: 'earth',
    }

    const config: SuggestionConfig = {
      suggestions: [suggestion1, suggestion2],
      onAction: vi.fn(),
    }
    let decorations = suggestionsToDecorations(config)

    // Wire up individual onMoved spies
    decorations = decorations.map((dec, i) => ({
      ...dec,
      onMoved: (details: RangeDecorationOnMovedDetails) => {
        if (i === 0) onMovedSpy1(details)
        else onMovedSpy2(details)
        decorations = updateDecorations({decorations, details})
      },
    }))

    const {editor, locator, rerender} = await createTestEditor({
      initialValue: helloWorldValue(),
      editableProps: {rangeDecorations: decorations},
    })

    // Both suggestions should render
    await vi.waitFor(() =>
      expect
        .element(locator.getByTestId('suggestion-del-hello'))
        .toBeInTheDocument(),
    )
    await vi.waitFor(() =>
      expect
        .element(locator.getByTestId('suggestion-rep-world'))
        .toBeInTheDocument(),
    )

    // Insert "XX" at offset 5 (between "Hello" and " world")
    editor.send({
      type: 'select',
      at: sel(5, 5),
    })
    editor.send({type: 'insert.text', text: 'XX'})

    // Wait for insertion
    await vi.waitFor(() => {
      const terse = getTersePt(editor.getSnapshot().context)
      expect(terse[0]).toBe('HelloXX world')
    })

    // suggestion2 ("world" at 6-11) SHOULD have shifted right by 2
    expect(onMovedSpy2).toHaveBeenCalled()
    const lastCall2 =
      onMovedSpy2.mock.calls[onMovedSpy2.mock.calls.length - 1]?.[0]
    expect(lastCall2?.newSelection?.anchor?.offset).toBe(8) // 6 + 2
    expect(lastCall2?.newSelection?.focus?.offset).toBe(13) // 11 + 2

    // Re-render with updated decorations
    await rerender({
      initialValue: editor.getSnapshot().context.value,
      editableProps: {rangeDecorations: decorations},
    })

    // Both decorations should still render correctly
    const deletedHello = locator.getByTestId('suggestion-del-hello-deleted')
    await vi.waitFor(() =>
      expect.element(deletedHello).toHaveTextContent('Hello'),
    )

    const insertedEarth = locator.getByTestId('suggestion-rep-world-inserted')
    await vi.waitFor(() =>
      expect.element(insertedEarth).toHaveTextContent('earth'),
    )
  })
})

// ---------------------------------------------------------------------------
// Interaction tests
// ---------------------------------------------------------------------------

describe('Suggestions: Interactions', () => {
  test('Accept removes the suggestion decoration', async () => {
    const onActionSpy = vi.fn()
    const suggestion: ReplaceSuggestion = {
      type: 'replace',
      id: 'rep-accept',
      selection: sel(6, 11), // "world"
      replacementText: 'earth',
    }

    let suggestions: Suggestion[] = [suggestion]
    const config: SuggestionConfig = {
      suggestions,
      onAction: (event) => {
        onActionSpy(event)
        if (event.action === 'accept') {
          suggestions = suggestions.filter((s) => s.id !== event.suggestion.id)
        }
      },
    }
    let decorations = suggestionsToDecorations(config)

    const {locator, rerender} = await createTestEditor({
      initialValue: helloWorldValue(),
      editableProps: {rangeDecorations: decorations},
    })

    // Verify suggestion renders
    const suggestionEl = locator.getByTestId('suggestion-rep-accept')
    await vi.waitFor(() => expect.element(suggestionEl).toBeInTheDocument())

    // Click accept
    const acceptBtn = page.getByTitle('Accept suggestion')
    await acceptBtn.click()

    expect(onActionSpy).toHaveBeenCalledWith({
      action: 'accept',
      suggestion,
    })

    // Re-render with the suggestion removed
    decorations = suggestionsToDecorations({
      suggestions,
      onAction: onActionSpy,
    })

    await rerender({
      editableProps: {rangeDecorations: decorations},
    })

    // Suggestion should be gone
    await vi.waitFor(() => expect.element(suggestionEl).not.toBeInTheDocument())
  })

  test('Reject removes the suggestion decoration', async () => {
    const onActionSpy = vi.fn()
    const suggestion: DeleteSuggestion = {
      type: 'delete',
      id: 'del-reject',
      selection: sel(6, 11), // "world"
    }

    let suggestions: Suggestion[] = [suggestion]
    const config: SuggestionConfig = {
      suggestions,
      onAction: (event) => {
        onActionSpy(event)
        if (event.action === 'reject') {
          suggestions = suggestions.filter((s) => s.id !== event.suggestion.id)
        }
      },
    }
    let decorations = suggestionsToDecorations(config)

    const {locator, rerender} = await createTestEditor({
      initialValue: helloWorldValue(),
      editableProps: {rangeDecorations: decorations},
    })

    // Verify suggestion renders
    const suggestionEl = locator.getByTestId('suggestion-del-reject')
    await vi.waitFor(() => expect.element(suggestionEl).toBeInTheDocument())

    // Click reject
    const rejectBtn = page.getByTitle('Reject suggestion')
    await rejectBtn.click()

    expect(onActionSpy).toHaveBeenCalledWith({
      action: 'reject',
      suggestion,
    })

    // Re-render with the suggestion removed
    decorations = suggestionsToDecorations({
      suggestions,
      onAction: onActionSpy,
    })

    await rerender({
      editableProps: {rangeDecorations: decorations},
    })

    // Suggestion should be gone
    await vi.waitFor(() => expect.element(suggestionEl).not.toBeInTheDocument())
  })

  test('Edit inside a replace suggestion range → onMoved fires with updated selection', async () => {
    const onMovedSpy = vi.fn()
    const suggestion: ReplaceSuggestion = {
      type: 'replace',
      id: 'rep-edit-inside',
      selection: sel(6, 11), // "world"
      replacementText: 'earth',
    }

    const config: SuggestionConfig = {
      suggestions: [suggestion],
      onAction: vi.fn(),
    }
    let decorations = suggestionsToDecorations(config)
    decorations = decorations.map((dec) => ({
      ...dec,
      onMoved: (details: RangeDecorationOnMovedDetails) => {
        onMovedSpy(details)
        decorations = updateDecorations({decorations, details})
      },
    }))

    const {editor, locator, rerender} = await createTestEditor({
      initialValue: helloWorldValue(),
      editableProps: {rangeDecorations: decorations},
    })

    // Verify initial rendering
    await vi.waitFor(() =>
      expect
        .element(locator.getByTestId('suggestion-rep-edit-inside'))
        .toBeInTheDocument(),
    )

    // Place cursor inside the suggestion range (offset 8, inside "world")
    editor.send({
      type: 'select',
      at: sel(8, 8),
    })

    // Type "X" inside the range
    editor.send({type: 'insert.text', text: 'X'})

    // Wait for insertion
    await vi.waitFor(() => {
      const terse = getTersePt(editor.getSnapshot().context)
      expect(terse[0]).toBe('Hello woXrld')
    })

    // onMoved should have been called — the focus offset should expand
    expect(onMovedSpy).toHaveBeenCalled()
    const lastCall =
      onMovedSpy.mock.calls[onMovedSpy.mock.calls.length - 1]?.[0]
    expect(lastCall.newSelection).not.toBeNull()
    // Anchor stays at 6, focus expands to 12 (was 11, +1 for inserted char)
    expect(lastCall.newSelection.anchor.offset).toBe(6)
    expect(lastCall.newSelection.focus.offset).toBe(12)

    // Re-render with updated decorations
    await rerender({
      initialValue: editor.getSnapshot().context.value,
      editableProps: {rangeDecorations: decorations},
    })

    // Decoration should now cover "woXrld"
    const deletedText = locator.getByTestId(
      'suggestion-rep-edit-inside-deleted',
    )
    await vi.waitFor(() =>
      expect.element(deletedText).toHaveTextContent('woXrld'),
    )
  })
})
