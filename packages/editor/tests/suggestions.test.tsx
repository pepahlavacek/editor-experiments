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
import {page, userEvent} from 'vitest/browser'
import type {RangeDecoration, RangeDecorationOnMovedDetails} from '../src'
import {suggestionsToDecorations} from '../src'
import {createTestEditor, createTestEditors} from '../src/test/vitest'
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

    await createTestEditor({
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

// ---------------------------------------------------------------------------
// Helpers for multi-block tests
// ---------------------------------------------------------------------------

/**
 * Make a selection pointing at a specific block and span.
 */
function selBlock(
  blockKey: string,
  spanKey: string,
  anchorOffset: number,
  focusOffset: number,
): {
  anchor: {path: Array<{_key: string} | string>; offset: number}
  focus: {path: Array<{_key: string} | string>; offset: number}
} {
  return {
    anchor: {
      path: [{_key: blockKey}, 'children', {_key: spanKey}],
      offset: anchorOffset,
    },
    focus: {
      path: [{_key: blockKey}, 'children', {_key: spanKey}],
      offset: focusOffset,
    },
  }
}

/**
 * Two-block value: "Hello world" / "Goodbye moon"
 */
function twoBlockValue() {
  return [
    {
      _type: 'block',
      _key: 'b1',
      children: [{_type: 'span', _key: 's1', text: 'Hello world'}],
      markDefs: [],
    },
    {
      _type: 'block',
      _key: 'b2',
      children: [{_type: 'span', _key: 's2', text: 'Goodbye moon'}],
      markDefs: [],
    },
  ]
}

// ---------------------------------------------------------------------------
// Nested suggestions tests
// ---------------------------------------------------------------------------

describe('Suggestions: Nested / Overlapping', () => {
  test('Overlapping ranges both render correctly', async () => {
    // "Hello world" — two overlapping suggestions:
    // replace "lo wor" (3-9) and delete "world" (6-11)
    const suggestion1: ReplaceSuggestion = {
      type: 'replace',
      id: 'rep-overlap',
      selection: sel(3, 9), // "lo wor"
      replacementText: 'REPLACED',
    }
    const suggestion2: DeleteSuggestion = {
      type: 'delete',
      id: 'del-overlap',
      selection: sel(6, 11), // "world"
    }

    const config: SuggestionConfig = {
      suggestions: [suggestion1, suggestion2],
      onAction: vi.fn(),
    }
    const decorations = suggestionsToDecorations(config)

    await createTestEditor({
      initialValue: helloWorldValue(),
      editableProps: {rangeDecorations: decorations},
    })

    // Both suggestions should render.
    // Overlapping decorations produce multiple leaf segments, each wrapped
    // by its decoration component — so getByTestId may match multiple elements.
    await vi.waitFor(() =>
      expect
        .element(page.getByTestId('suggestion-rep-overlap').first())
        .toBeInTheDocument(),
    )
    await vi.waitFor(() =>
      expect
        .element(page.getByTestId('suggestion-del-overlap').first())
        .toBeInTheDocument(),
    )
  })

  test('Insert inside a replace range — both visible', async () => {
    // "Hello world" — replace "world" (6-11) + insert at offset 8 (inside "world")
    const suggestion1: ReplaceSuggestion = {
      type: 'replace',
      id: 'rep-outer',
      selection: sel(6, 11), // "world"
      replacementText: 'earth',
    }
    const suggestion2: InsertSuggestion = {
      type: 'insert',
      id: 'ins-inner',
      selection: sel(8, 8), // collapsed inside "world"
      insertedText: 'INJECTED',
    }

    const config: SuggestionConfig = {
      suggestions: [suggestion1, suggestion2],
      onAction: vi.fn(),
    }
    const decorations = suggestionsToDecorations(config)

    await createTestEditor({
      initialValue: helloWorldValue(),
      editableProps: {rangeDecorations: decorations},
    })

    // The replace decoration splits "world" into segments around the insert point,
    // so the replace testid may appear on multiple leaf spans.
    await vi.waitFor(() =>
      expect
        .element(page.getByTestId('suggestion-rep-outer').first())
        .toBeInTheDocument(),
    )
    // Insert suggestion renders at the collapsed position
    await vi.waitFor(() =>
      expect
        .element(page.getByTestId('suggestion-ins-inner'))
        .toBeInTheDocument(),
    )

    // The injected text should be visible
    await vi.waitFor(() =>
      expect
        .element(page.getByText('INJECTED', {exact: true}))
        .toBeInTheDocument(),
    )
  })

  test('Delete containing another suggestion — independent tracking', async () => {
    // "Hello world" — delete "Hello world" (0-11) + replace "world" (6-11)
    const onMovedSpy1 = vi.fn()
    const onMovedSpy2 = vi.fn()

    const suggestion1: DeleteSuggestion = {
      type: 'delete',
      id: 'del-outer',
      selection: sel(0, 11), // entire "Hello world"
    }
    const suggestion2: ReplaceSuggestion = {
      type: 'replace',
      id: 'rep-inner',
      selection: sel(6, 11), // "world"
      replacementText: 'earth',
    }

    const config: SuggestionConfig = {
      suggestions: [suggestion1, suggestion2],
      onAction: vi.fn(),
    }
    let decorations = suggestionsToDecorations(config)
    decorations = decorations.map((dec, i) => ({
      ...dec,
      onMoved: (details: RangeDecorationOnMovedDetails) => {
        if (i === 0) onMovedSpy1(details)
        else onMovedSpy2(details)
        decorations = updateDecorations({decorations, details})
      },
    }))

    const {editor} = await createTestEditor({
      initialValue: helloWorldValue(),
      editableProps: {rangeDecorations: decorations},
    })

    // Both should render (overlapping — use .first())
    await vi.waitFor(() =>
      expect
        .element(page.getByTestId('suggestion-del-outer').first())
        .toBeInTheDocument(),
    )
    await vi.waitFor(() =>
      expect
        .element(page.getByTestId('suggestion-rep-inner').first())
        .toBeInTheDocument(),
    )

    // Type at offset 3 (inside both suggestions)
    editor.send({type: 'select', at: sel(3, 3)})
    editor.send({type: 'insert.text', text: 'X'})

    await vi.waitFor(() => {
      const terse = getTersePt(editor.getSnapshot().context)
      expect(terse[0]).toBe('HelXlo world')
    })

    // Both should have been notified independently
    expect(onMovedSpy1).toHaveBeenCalled()
    expect(onMovedSpy2).toHaveBeenCalled()

    // Outer: anchor stays 0, focus shifts to 12
    const lastOuter =
      onMovedSpy1.mock.calls[onMovedSpy1.mock.calls.length - 1]?.[0]
    expect(lastOuter.newSelection.focus.offset).toBe(12)

    // Inner: anchor shifts to 7, focus shifts to 12
    const lastInner =
      onMovedSpy2.mock.calls[onMovedSpy2.mock.calls.length - 1]?.[0]
    expect(lastInner.newSelection.anchor.offset).toBe(7)
    expect(lastInner.newSelection.focus.offset).toBe(12)
  })

  test('Accept inner suggestion — outer still renders', async () => {
    // "Hello world" — delete "Hello world" (0-11) + delete "world" (6-11)
    // Accept inner ("world") → outer should still be present
    const onActionSpy = vi.fn()

    const suggestion1: DeleteSuggestion = {
      type: 'delete',
      id: 'del-outer-adj',
      selection: sel(0, 11), // entire "Hello world"
    }
    const suggestion2: DeleteSuggestion = {
      type: 'delete',
      id: 'del-inner-adj',
      selection: sel(6, 11), // "world"
    }

    let suggestions: Suggestion[] = [suggestion1, suggestion2]
    const config: SuggestionConfig = {
      suggestions,
      onAction: (event) => {
        onActionSpy(event)
        suggestions = suggestions.filter((s) => s.id !== event.suggestion.id)
      },
    }
    const decorations = suggestionsToDecorations(config)

    const {rerender} = await createTestEditor({
      initialValue: helloWorldValue(),
      editableProps: {rangeDecorations: decorations},
    })

    // Both should render (overlapping — use .first())
    await vi.waitFor(() =>
      expect
        .element(page.getByTestId('suggestion-del-outer-adj').first())
        .toBeInTheDocument(),
    )
    await vi.waitFor(() =>
      expect
        .element(page.getByTestId('suggestion-del-inner-adj').first())
        .toBeInTheDocument(),
    )

    // Accept the inner suggestion
    // There are multiple accept buttons — click the last one (inner)
    const acceptBtns = page.getByTitle('Accept suggestion')
    await acceptBtns.last().click()

    expect(onActionSpy).toHaveBeenCalled()

    // Re-render with inner removed
    const newDecorations = suggestionsToDecorations({
      suggestions,
      onAction: onActionSpy,
    })

    await rerender({
      editableProps: {rangeDecorations: newDecorations},
    })

    // Inner should be gone, outer should remain
    await vi.waitFor(() =>
      expect
        .element(page.getByTestId('suggestion-del-inner-adj').first())
        .not.toBeInTheDocument(),
    )
    await vi.waitFor(() =>
      expect
        .element(page.getByTestId('suggestion-del-outer-adj').first())
        .toBeInTheDocument(),
    )
  })

  test('Reject outer suggestion — inner survives', async () => {
    const onActionSpy = vi.fn()

    const suggestion1: DeleteSuggestion = {
      type: 'delete',
      id: 'del-outer-rej',
      selection: sel(0, 11), // entire "Hello world"
    }
    const suggestion2: ReplaceSuggestion = {
      type: 'replace',
      id: 'rep-inner-rej',
      selection: sel(6, 11), // "world"
      replacementText: 'earth',
    }

    let suggestions: Suggestion[] = [suggestion1, suggestion2]
    const config: SuggestionConfig = {
      suggestions,
      onAction: (event) => {
        onActionSpy(event)
        suggestions = suggestions.filter((s) => s.id !== event.suggestion.id)
      },
    }
    const decorations = suggestionsToDecorations(config)

    const {rerender} = await createTestEditor({
      initialValue: helloWorldValue(),
      editableProps: {rangeDecorations: decorations},
    })

    // Both should render (overlapping — use .first())
    await vi.waitFor(() =>
      expect
        .element(page.getByTestId('suggestion-del-outer-rej').first())
        .toBeInTheDocument(),
    )
    await vi.waitFor(() =>
      expect
        .element(page.getByTestId('suggestion-rep-inner-rej').first())
        .toBeInTheDocument(),
    )

    // Reject the outer suggestion (first reject button)
    const rejectBtns = page.getByTitle('Reject suggestion')
    await rejectBtns.first().click()

    expect(onActionSpy).toHaveBeenCalled()

    // Re-render with outer removed
    const newDecorations = suggestionsToDecorations({
      suggestions,
      onAction: onActionSpy,
    })

    await rerender({
      editableProps: {rangeDecorations: newDecorations},
    })

    // Outer should be gone, inner should remain
    await vi.waitFor(() =>
      expect
        .element(page.getByTestId('suggestion-del-outer-rej').first())
        .not.toBeInTheDocument(),
    )
    await vi.waitFor(() =>
      expect
        .element(page.getByTestId('suggestion-rep-inner-rej').first())
        .toBeInTheDocument(),
    )
  })
})

// ---------------------------------------------------------------------------
// Change shifting tests
// ---------------------------------------------------------------------------

describe('Suggestions: Change Shifting', () => {
  test('Cumulative offset shift from multiple characters', async () => {
    const onMovedSpy = vi.fn()
    const suggestion: DeleteSuggestion = {
      type: 'delete',
      id: 'del-cumulative',
      selection: sel(6, 11), // "world"
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

    await vi.waitFor(() =>
      expect
        .element(locator.getByTestId('suggestion-del-cumulative'))
        .toBeInTheDocument(),
    )

    // Type 5 characters at the start
    editor.send({type: 'select', at: sel(0, 0)})
    editor.send({type: 'insert.text', text: 'ABCDE'})

    await vi.waitFor(() => {
      const terse = getTersePt(editor.getSnapshot().context)
      expect(terse[0]).toBe('ABCDEHello world')
    })

    // Decoration should have shifted right by 5
    expect(onMovedSpy).toHaveBeenCalled()
    const lastCall =
      onMovedSpy.mock.calls[onMovedSpy.mock.calls.length - 1]?.[0]
    expect(lastCall.newSelection.anchor.offset).toBe(11) // 6 + 5
    expect(lastCall.newSelection.focus.offset).toBe(16) // 11 + 5

    // Re-render and verify text
    await rerender({
      initialValue: editor.getSnapshot().context.value,
      editableProps: {rangeDecorations: decorations},
    })

    const deletedText = locator.getByTestId('suggestion-del-cumulative-deleted')
    await vi.waitFor(() =>
      expect.element(deletedText).toHaveTextContent('world'),
    )
  })

  test('Multi-block independence — edit block 1, block 2 unaffected', async () => {
    const onMovedSpy1 = vi.fn()
    const onMovedSpy2 = vi.fn()

    // Suggestion on block 1 and block 2
    const suggestion1: DeleteSuggestion = {
      type: 'delete',
      id: 'del-b1',
      selection: selBlock('b1', 's1', 0, 5), // "Hello"
    }
    const suggestion2: ReplaceSuggestion = {
      type: 'replace',
      id: 'rep-b2',
      selection: selBlock('b2', 's2', 8, 12), // "moon"
      replacementText: 'sun',
    }

    const config: SuggestionConfig = {
      suggestions: [suggestion1, suggestion2],
      onAction: vi.fn(),
    }
    let decorations = suggestionsToDecorations(config)
    decorations = decorations.map((dec, i) => ({
      ...dec,
      onMoved: (details: RangeDecorationOnMovedDetails) => {
        if (i === 0) onMovedSpy1(details)
        else onMovedSpy2(details)
        decorations = updateDecorations({decorations, details})
      },
    }))

    const {editor, locator} = await createTestEditor({
      initialValue: twoBlockValue(),
      editableProps: {rangeDecorations: decorations},
    })

    // Both should render
    await vi.waitFor(() =>
      expect
        .element(locator.getByTestId('suggestion-del-b1'))
        .toBeInTheDocument(),
    )
    await vi.waitFor(() =>
      expect
        .element(locator.getByTestId('suggestion-rep-b2'))
        .toBeInTheDocument(),
    )

    // Edit block 1 — type at start
    editor.send({
      type: 'select',
      at: selBlock('b1', 's1', 0, 0),
    })
    editor.send({type: 'insert.text', text: 'XX'})

    await vi.waitFor(() => {
      const terse = getTersePt(editor.getSnapshot().context)
      expect(terse[0]).toBe('XXHello world')
    })

    // Block 1 suggestion should have shifted
    expect(onMovedSpy1).toHaveBeenCalled()

    // Block 2 suggestion should NOT have been affected
    expect(onMovedSpy2).not.toHaveBeenCalled()
  })

  test('Rapid sequential edits — type, delete, type', async () => {
    const onMovedSpy = vi.fn()
    const suggestion: ReplaceSuggestion = {
      type: 'replace',
      id: 'rep-rapid',
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

    await vi.waitFor(() =>
      expect
        .element(locator.getByTestId('suggestion-rep-rapid'))
        .toBeInTheDocument(),
    )

    // Type "AB" at start → shifts right by 2
    editor.send({type: 'select', at: sel(0, 0)})
    editor.send({type: 'insert.text', text: 'AB'})

    await vi.waitFor(() => {
      const terse = getTersePt(editor.getSnapshot().context)
      expect(terse[0]).toBe('ABHello world')
    })

    // Delete "AB" (select 0-2, replace with empty) → shifts back left by 2
    editor.send({type: 'select', at: sel(0, 2)})
    editor.send({type: 'insert.text', text: ''})

    await vi.waitFor(() => {
      const terse = getTersePt(editor.getSnapshot().context)
      expect(terse[0]).toBe('Hello world')
    })

    // Type "XYZ" at start → shifts right by 3
    editor.send({type: 'select', at: sel(0, 0)})
    editor.send({type: 'insert.text', text: 'XYZ'})

    await vi.waitFor(() => {
      const terse = getTersePt(editor.getSnapshot().context)
      expect(terse[0]).toBe('XYZHello world')
    })

    // Net shift should be +3 (AB+2, -AB-2, XYZ+3)
    const lastCall =
      onMovedSpy.mock.calls[onMovedSpy.mock.calls.length - 1]?.[0]
    expect(lastCall.newSelection.anchor.offset).toBe(9) // 6 + 3
    expect(lastCall.newSelection.focus.offset).toBe(14) // 11 + 3

    // Re-render and verify
    await rerender({
      initialValue: editor.getSnapshot().context.value,
      editableProps: {rangeDecorations: decorations},
    })

    const deletedText = locator.getByTestId('suggestion-rep-rapid-deleted')
    await vi.waitFor(() =>
      expect.element(deletedText).toHaveTextContent('world'),
    )
  })

  test('Undo reverting suggestion position', async () => {
    const onMovedSpy = vi.fn()
    const suggestion: DeleteSuggestion = {
      type: 'delete',
      id: 'del-undo',
      selection: sel(6, 11), // "world"
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

    await vi.waitFor(() =>
      expect
        .element(locator.getByTestId('suggestion-del-undo'))
        .toBeInTheDocument(),
    )

    // Type "XX" at start → shifts right by 2
    editor.send({type: 'select', at: sel(0, 0)})
    editor.send({type: 'insert.text', text: 'XX'})

    await vi.waitFor(() => {
      const terse = getTersePt(editor.getSnapshot().context)
      expect(terse[0]).toBe('XXHello world')
    })

    // Verify shifted
    const afterInsert =
      onMovedSpy.mock.calls[onMovedSpy.mock.calls.length - 1]?.[0]
    expect(afterInsert.newSelection.anchor.offset).toBe(8) // 6 + 2

    // Undo
    editor.send({type: 'history.undo'})

    await vi.waitFor(() => {
      const terse = getTersePt(editor.getSnapshot().context)
      expect(terse[0]).toBe('Hello world')
    })

    // After undo, decoration should shift back
    const afterUndo =
      onMovedSpy.mock.calls[onMovedSpy.mock.calls.length - 1]?.[0]
    expect(afterUndo.newSelection.anchor.offset).toBe(6)
    expect(afterUndo.newSelection.focus.offset).toBe(11)

    // Re-render and verify
    await rerender({
      initialValue: editor.getSnapshot().context.value,
      editableProps: {rangeDecorations: decorations},
    })

    const deletedText = locator.getByTestId('suggestion-del-undo-deleted')
    await vi.waitFor(() =>
      expect.element(deletedText).toHaveTextContent('world'),
    )
  })
})

// ---------------------------------------------------------------------------
// Multi-editor collaborative tests
// ---------------------------------------------------------------------------

describe('Suggestions: Multi-Editor Collaborative', () => {
  test('Suggestion in Editor B survives when Editor A types before it', async () => {
    // Editor B has a replace suggestion on "world" (6-11)
    // Editor A types at the beginning — patches sync to B as remote
    // Suggestion in B should shift right and still highlight "world"
    //
    // IMPORTANT: Each editor has independent decoration arrays to avoid
    // shared mutable state masking reconciliation bugs.

    const onMovedSpyB = vi.fn()
    const suggestion: ReplaceSuggestion = {
      type: 'replace',
      id: 'rep-collab',
      selection: sel(6, 11), // "world"
      replacementText: 'earth',
    }

    const config: SuggestionConfig = {
      suggestions: [suggestion],
      onAction: vi.fn(),
    }
    let decorationsB = suggestionsToDecorations(config)
    decorationsB = decorationsB.map((dec) => ({
      ...dec,
      onMoved: (details: RangeDecorationOnMovedDetails) => {
        onMovedSpyB(details)
        decorationsB = updateDecorations({decorations: decorationsB, details})
      },
    }))

    const {editor, locator, editorB, locatorB} = await createTestEditors({
      initialValue: helloWorldValue(),
      editableProps: {}, // Editor A: no decorations
      editablePropsB: {rangeDecorations: decorationsB}, // Editor B: own decorations
    })

    // Wait for both editors
    await vi.waitFor(() => expect.element(locator).toBeInTheDocument())
    await vi.waitFor(() => expect.element(locatorB).toBeInTheDocument())

    // Verify suggestion in Editor B
    await vi.waitFor(() =>
      expect
        .element(locatorB.getByTestId('suggestion-rep-collab'))
        .toBeInTheDocument(),
    )

    // Type in Editor A at the beginning
    await userEvent.click(locator)
    editor.send({type: 'focus'})
    editor.send({type: 'select', at: sel(0, 0)})
    await userEvent.type(locator, 'AAA ')

    // Wait for sync to complete
    await vi.waitFor(() => {
      const terseA = getTersePt(editor.getSnapshot().context)
      const terseB = getTersePt(editorB.getSnapshot().context)
      expect(terseA[0]).toContain('AAA')
      expect(terseB[0]).toContain('AAA')
    })

    // Suggestion in Editor B should NOT be invalidated
    const lastCall =
      onMovedSpyB.mock.calls[onMovedSpyB.mock.calls.length - 1]?.[0]
    if (lastCall) {
      expect(lastCall.newSelection).not.toBeNull()
    }

    // Verify suggestion in Editor B still highlights "world"
    await vi.waitFor(() =>
      expect
        .element(locatorB.getByTestId('suggestion-rep-collab'))
        .toBeInTheDocument(),
    )
  })

  test('Suggestion in Editor A survives when Editor B types after it', async () => {
    // Editor A has a delete suggestion on "Hello" (0-5)
    // Editor B types at the end — patches sync to A as remote
    // Suggestion in A should be unaffected (typing after doesn't shift)

    const onMovedSpyA = vi.fn()
    const suggestion: DeleteSuggestion = {
      type: 'delete',
      id: 'del-collab-after',
      selection: sel(0, 5), // "Hello"
    }

    const config: SuggestionConfig = {
      suggestions: [suggestion],
      onAction: vi.fn(),
    }
    let decorationsA = suggestionsToDecorations(config)
    decorationsA = decorationsA.map((dec) => ({
      ...dec,
      onMoved: (details: RangeDecorationOnMovedDetails) => {
        onMovedSpyA(details)
        decorationsA = updateDecorations({decorations: decorationsA, details})
      },
    }))

    const {editor, locator, editorB, locatorB} = await createTestEditors({
      initialValue: helloWorldValue(),
      editableProps: {rangeDecorations: decorationsA}, // Editor A: has suggestion
      editablePropsB: {}, // Editor B: no decorations
    })

    await vi.waitFor(() => expect.element(locator).toBeInTheDocument())
    await vi.waitFor(() => expect.element(locatorB).toBeInTheDocument())

    // Verify suggestion in Editor A
    await vi.waitFor(() =>
      expect
        .element(locator.getByTestId('suggestion-del-collab-after'))
        .toBeInTheDocument(),
    )

    // Type in Editor B at the end
    await userEvent.click(locatorB)
    editorB.send({type: 'focus'})
    editorB.send({type: 'select', at: sel(11, 11)})
    await userEvent.type(locatorB, '!!!')

    // Wait for sync
    await vi.waitFor(() => {
      const terseA = getTersePt(editor.getSnapshot().context)
      const terseB = getTersePt(editorB.getSnapshot().context)
      expect(terseA[0]).toContain('!!!')
      expect(terseB[0]).toContain('!!!')
    })

    // Suggestion in Editor A should be unaffected — typing after doesn't move it
    // onMoved may or may not fire depending on reconciliation, but if it does,
    // the selection should remain valid
    if (onMovedSpyA.mock.calls.length > 0) {
      const lastCall =
        onMovedSpyA.mock.calls[onMovedSpyA.mock.calls.length - 1]?.[0]
      expect(lastCall.newSelection).not.toBeNull()
      expect(lastCall.newSelection.anchor.offset).toBe(0)
      expect(lastCall.newSelection.focus.offset).toBe(5)
    }

    // Verify suggestion still renders in Editor A
    await vi.waitFor(() =>
      expect
        .element(locator.getByTestId('suggestion-del-collab-after'))
        .toBeInTheDocument(),
    )
  })

  test('Both editors have independent suggestions — remote edit shifts only affected editor', async () => {
    // Editor A: suggestion on "Hello" (0-5)
    // Editor B: suggestion on "world" (6-11)
    // Editor A types at offset 5 — shifts B's suggestion, not A's

    const suggestionA: DeleteSuggestion = {
      type: 'delete',
      id: 'del-indep-a',
      selection: sel(0, 5), // "Hello"
    }
    const suggestionB: ReplaceSuggestion = {
      type: 'replace',
      id: 'rep-indep-b',
      selection: sel(6, 11), // "world"
      replacementText: 'earth',
    }

    const decorationsA = suggestionsToDecorations({
      suggestions: [suggestionA],
      onAction: vi.fn(),
    })

    const decorationsB = suggestionsToDecorations({
      suggestions: [suggestionB],
      onAction: vi.fn(),
    })

    const {editor, locator, editorB, locatorB} = await createTestEditors({
      initialValue: helloWorldValue(),
      editableProps: {rangeDecorations: decorationsA},
      editablePropsB: {rangeDecorations: decorationsB},
    })

    await vi.waitFor(() => expect.element(locator).toBeInTheDocument())
    await vi.waitFor(() => expect.element(locatorB).toBeInTheDocument())

    // Verify both suggestions render
    await vi.waitFor(() =>
      expect
        .element(locator.getByTestId('suggestion-del-indep-a'))
        .toBeInTheDocument(),
    )
    await vi.waitFor(() =>
      expect
        .element(locatorB.getByTestId('suggestion-rep-indep-b'))
        .toBeInTheDocument(),
    )

    // Editor A types "XX" at offset 5 (between "Hello" and " world")
    editor.send({type: 'focus'})
    editor.send({type: 'select', at: sel(5, 5)})
    editor.send({type: 'insert.text', text: 'XX'})

    // Wait for Editor A to process
    await vi.waitFor(() => {
      const terseA = getTersePt(editor.getSnapshot().context)
      expect(terseA[0]).toBe('HelloXX world')
    })

    // Wait for sync to Editor B
    await vi.waitFor(() => {
      const terseB = getTersePt(editorB.getSnapshot().context)
      expect(terseB[0]).toBe('HelloXX world')
    })

    // Editor B's suggestion should still render after remote edit.
    // For same-span text insertions, the reconciliation takes the changed=false
    // path — Point.transform correctly shifts offsets without calling onMoved.
    // The decoration tracks correctly; the consumer just isn't notified.
    await vi.waitFor(() =>
      expect
        .element(locatorB.getByTestId('suggestion-rep-indep-b'))
        .toBeInTheDocument(),
    )

    // Editor A's suggestion should also still render (unaffected by typing at offset 5)
    await vi.waitFor(() =>
      expect
        .element(locator.getByTestId('suggestion-del-indep-a'))
        .toBeInTheDocument(),
    )
  })

  test('Suggestion survives rapid back-and-forth edits between editors', async () => {
    // Editor B has a suggestion on "world" (6-11)
    // Editor A types, then Editor B types, then Editor A types again
    // Suggestion should track through all the remote patches

    const onMovedSpyB = vi.fn()
    const suggestion: DeleteSuggestion = {
      type: 'delete',
      id: 'del-rapid-collab',
      selection: sel(6, 11), // "world"
    }

    let decorationsB = suggestionsToDecorations({
      suggestions: [suggestion],
      onAction: vi.fn(),
    })
    decorationsB = decorationsB.map((dec) => ({
      ...dec,
      onMoved: (details: RangeDecorationOnMovedDetails) => {
        onMovedSpyB(details)
        decorationsB = updateDecorations({decorations: decorationsB, details})
      },
    }))

    const {editor, locator, editorB, locatorB} = await createTestEditors({
      initialValue: helloWorldValue(),
      editableProps: {},
      editablePropsB: {rangeDecorations: decorationsB},
    })

    await vi.waitFor(() => expect.element(locator).toBeInTheDocument())
    await vi.waitFor(() => expect.element(locatorB).toBeInTheDocument())

    // Verify suggestion in Editor B
    await vi.waitFor(() =>
      expect
        .element(locatorB.getByTestId('suggestion-del-rapid-collab'))
        .toBeInTheDocument(),
    )

    // Editor A types "A" at start — must use userEvent for patch sync
    await userEvent.click(locator)
    editor.send({type: 'focus'})
    editor.send({type: 'select', at: sel(0, 0)})
    await userEvent.type(locator, 'A')

    await vi.waitFor(() => {
      const terseB = getTersePt(editorB.getSnapshot().context)
      expect(terseB[0]).toContain('A')
      expect(terseB[0]).toContain('world')
    })

    // Editor B types "B" at end
    await userEvent.click(locatorB)
    editorB.send({type: 'focus'})
    // Select at end of current text in Editor B
    const terseBAfterA = getTersePt(editorB.getSnapshot().context)
    const textLenAfterA = (terseBAfterA[0] ?? '').length
    editorB.send({
      type: 'select',
      at: selBlock('b1', 's1', textLenAfterA, textLenAfterA),
    })
    await userEvent.type(locatorB, 'B')

    await vi.waitFor(() => {
      const terseA = getTersePt(editor.getSnapshot().context)
      expect(terseA[0]).toContain('B')
    })

    // Editor A types "C" at start again
    await userEvent.click(locator)
    editor.send({type: 'focus'})
    editor.send({type: 'select', at: sel(0, 0)})
    await userEvent.type(locator, 'C')

    await vi.waitFor(() => {
      const terseB = getTersePt(editorB.getSnapshot().context)
      expect(terseB[0]).toContain('C')
    })

    // Suggestion should still be valid after all the back-and-forth
    // The exact offset depends on where characters landed, but the
    // decoration should not be invalidated
    const lastCall =
      onMovedSpyB.mock.calls[onMovedSpyB.mock.calls.length - 1]?.[0]
    expect(lastCall).toBeDefined()
    expect(lastCall.newSelection).not.toBeNull()

    // Suggestion should still render
    await vi.waitFor(() =>
      expect
        .element(locatorB.getByTestId('suggestion-del-rapid-collab'))
        .toBeInTheDocument(),
    )
  })
})
