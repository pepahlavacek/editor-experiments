import type {PropsWithChildren} from 'react'
import type {
  EditorSelection,
  RangeDecoration,
  RangeDecorationOnMovedDetails,
} from '../types/editor'
import type {Suggestion, SuggestionConfig} from '../types/suggestion'
import {
  DeleteSuggestionComponent,
  InsertSuggestionComponent,
  ReplaceSuggestionComponent,
} from './suggestion-components'

/**
 * Convert a SuggestionConfig into an array of RangeDecorations.
 *
 * This is the core mapping layer: each Suggestion becomes a RangeDecoration
 * with the appropriate component and callbacks wired up.
 *
 * - ReplaceSuggestion → expanded range with strikethrough + inline replacement preview
 * - InsertSuggestion → collapsed range with inline insertion preview
 * - DeleteSuggestion → expanded range with strikethrough
 *
 * @alpha
 */
export function suggestionsToDecorations(
  config: SuggestionConfig,
): RangeDecoration[] {
  return config.suggestions.map((suggestion) =>
    suggestionToDecoration(suggestion, config),
  )
}

function suggestionToDecoration(
  suggestion: Suggestion,
  config: SuggestionConfig,
): RangeDecoration {
  const onMoved = createOnMoved(suggestion, config)

  switch (suggestion.type) {
    case 'replace':
      return {
        id: suggestion.id,
        selection: suggestion.selection,
        component: (props: PropsWithChildren) => (
          <ReplaceSuggestionComponent
            suggestionId={suggestion.id}
            content={suggestion.content}
          >
            {props.children}
          </ReplaceSuggestionComponent>
        ),
        onMoved,
        payload: {suggestionType: suggestion.type, suggestionId: suggestion.id},
      }
    case 'insert':
      return {
        id: suggestion.id,
        selection: suggestion.selection,
        component: (props: PropsWithChildren) => (
          <InsertSuggestionComponent
            suggestionId={suggestion.id}
            content={suggestion.content}
          >
            {props.children}
          </InsertSuggestionComponent>
        ),
        onMoved,
        payload: {suggestionType: suggestion.type, suggestionId: suggestion.id},
      }
    case 'delete':
      return {
        id: suggestion.id,
        selection: suggestion.selection,
        component: (props: PropsWithChildren) => (
          <DeleteSuggestionComponent suggestionId={suggestion.id}>
            {props.children}
          </DeleteSuggestionComponent>
        ),
        onMoved,
        payload: {suggestionType: suggestion.type, suggestionId: suggestion.id},
      }
  }
}

function createOnMoved(
  suggestion: Suggestion,
  config: SuggestionConfig,
): RangeDecoration['onMoved'] {
  if (!config.onMoved) return undefined

  return (details: RangeDecorationOnMovedDetails): EditorSelection | void => {
    return config.onMoved?.({
      suggestion,
      newSelection: details.newSelection,
      previousSelection: details.previousSelection,
      origin: details.origin,
    })
  }
}
