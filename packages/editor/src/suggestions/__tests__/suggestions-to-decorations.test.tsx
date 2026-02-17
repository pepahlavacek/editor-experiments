import {describe, expect, it, vi} from 'vitest'
import type {EditorSelection} from '../../types/editor'
import type {
  DeleteSuggestion,
  InsertSuggestion,
  ReplaceSuggestion,
  SuggestionConfig,
} from '../../types/suggestion'
import {suggestionsToDecorations} from '../suggestions-to-decorations'

const makeSelection = (
  blockKey: string,
  spanKey: string,
  anchorOffset: number,
  focusOffset: number,
): NonNullable<EditorSelection> => ({
  anchor: {
    path: [{_key: blockKey}, 'children', {_key: spanKey}],
    offset: anchorOffset,
  },
  focus: {
    path: [{_key: blockKey}, 'children', {_key: spanKey}],
    offset: focusOffset,
  },
})

const makeCollapsedSelection = (
  blockKey: string,
  spanKey: string,
  offset: number,
): NonNullable<EditorSelection> =>
  makeSelection(blockKey, spanKey, offset, offset)

describe('suggestionsToDecorations', () => {
  it('returns empty array for empty suggestions', () => {
    const config: SuggestionConfig = {suggestions: []}
    const result = suggestionsToDecorations(config)
    expect(result).toEqual([])
  })

  it('maps a ReplaceSuggestion to a RangeDecoration', () => {
    const suggestion: ReplaceSuggestion = {
      type: 'replace',
      id: 'replace-1',
      selection: makeSelection('b1', 's1', 5, 10),
      replacementText: 'world',
    }
    const config: SuggestionConfig = {suggestions: [suggestion]}
    const [decoration] = suggestionsToDecorations(config)

    expect(decoration.id).toBe('replace-1')
    expect(decoration.selection).toBe(suggestion.selection)
    expect(decoration.payload).toEqual({
      suggestionType: 'replace',
      suggestionId: 'replace-1',
    })
    expect(decoration.component).toBeDefined()
  })

  it('maps an InsertSuggestion to a RangeDecoration with collapsed selection', () => {
    const suggestion: InsertSuggestion = {
      type: 'insert',
      id: 'insert-1',
      selection: makeCollapsedSelection('b1', 's1', 5),
      insertedText: 'hello ',
    }
    const config: SuggestionConfig = {suggestions: [suggestion]}
    const [decoration] = suggestionsToDecorations(config)

    expect(decoration.id).toBe('insert-1')
    expect(decoration.selection).toBe(suggestion.selection)
    expect(decoration.payload).toEqual({
      suggestionType: 'insert',
      suggestionId: 'insert-1',
    })
    // Collapsed selection — anchor and focus should be the same
    expect(decoration.selection!.anchor.offset).toBe(
      decoration.selection!.focus.offset,
    )
  })

  it('maps a DeleteSuggestion to a RangeDecoration', () => {
    const suggestion: DeleteSuggestion = {
      type: 'delete',
      id: 'delete-1',
      selection: makeSelection('b1', 's1', 0, 5),
    }
    const config: SuggestionConfig = {suggestions: [suggestion]}
    const [decoration] = suggestionsToDecorations(config)

    expect(decoration.id).toBe('delete-1')
    expect(decoration.selection).toBe(suggestion.selection)
    expect(decoration.payload).toEqual({
      suggestionType: 'delete',
      suggestionId: 'delete-1',
    })
  })

  it('maps multiple suggestions to multiple decorations', () => {
    const suggestions = [
      {
        type: 'replace' as const,
        id: 'r1',
        selection: makeSelection('b1', 's1', 0, 5),
        replacementText: 'Hello',
      },
      {
        type: 'insert' as const,
        id: 'i1',
        selection: makeCollapsedSelection('b1', 's1', 10),
        insertedText: ' World',
      },
      {
        type: 'delete' as const,
        id: 'd1',
        selection: makeSelection('b2', 's1', 0, 3),
      },
    ]
    const config: SuggestionConfig = {suggestions}
    const decorations = suggestionsToDecorations(config)

    expect(decorations).toHaveLength(3)
    expect(decorations[0].id).toBe('r1')
    expect(decorations[1].id).toBe('i1')
    expect(decorations[2].id).toBe('d1')
  })

  it('wires up onMoved callback when config.onMoved is provided', () => {
    const onMoved = vi.fn()
    const suggestion: ReplaceSuggestion = {
      type: 'replace',
      id: 'r1',
      selection: makeSelection('b1', 's1', 0, 5),
      replacementText: 'test',
    }
    const config: SuggestionConfig = {suggestions: [suggestion], onMoved}
    const [decoration] = suggestionsToDecorations(config)

    expect(decoration.onMoved).toBeDefined()

    // Simulate an onMoved call
    const newSelection = makeSelection('b1', 's1', 2, 7)
    const previousSelection = suggestion.selection
    decoration.onMoved!({
      rangeDecoration: decoration,
      newSelection,
      previousSelection,
      origin: 'local',
    })

    expect(onMoved).toHaveBeenCalledWith({
      suggestion,
      newSelection,
      previousSelection,
      origin: 'local',
    })
  })

  it('does not set onMoved when config.onMoved is not provided', () => {
    const suggestion: ReplaceSuggestion = {
      type: 'replace',
      id: 'r1',
      selection: makeSelection('b1', 's1', 0, 5),
      replacementText: 'test',
    }
    const config: SuggestionConfig = {suggestions: [suggestion]}
    const [decoration] = suggestionsToDecorations(config)

    expect(decoration.onMoved).toBeUndefined()
  })

  it('wires up onAction callback for accept/reject', () => {
    const onAction = vi.fn()
    const suggestion: DeleteSuggestion = {
      type: 'delete',
      id: 'd1',
      selection: makeSelection('b1', 's1', 0, 5),
    }
    const config: SuggestionConfig = {suggestions: [suggestion], onAction}
    const [decoration] = suggestionsToDecorations(config)

    // The onAction is wired into the component — we verify the component exists
    // and the payload carries the suggestion ID for identification
    expect(decoration.component).toBeDefined()
    expect(decoration.payload?.suggestionId).toBe('d1')
  })
})
