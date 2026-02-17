import type {PropsWithChildren, ReactElement} from 'react'
import type {
  EditorSelection,
  RangeDecoration,
  RangeDecorationOnMovedDetails,
} from '../types/editor'
import type {
  Suggestion,
  SuggestionConfig,
  SuggestionEvent,
} from '../types/suggestion'

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
        component: createReplaceComponent(
          suggestion.replacementText,
          suggestion,
          config.onAction,
        ),
        onMoved,
        payload: {suggestionType: 'replace', suggestionId: suggestion.id},
      }
    case 'insert':
      return {
        id: suggestion.id,
        selection: suggestion.selection,
        component: createInsertComponent(
          suggestion.insertedText,
          suggestion,
          config.onAction,
        ),
        onMoved,
        payload: {suggestionType: 'insert', suggestionId: suggestion.id},
      }
    case 'delete':
      return {
        id: suggestion.id,
        selection: suggestion.selection,
        component: createDeleteComponent(suggestion, config.onAction),
        onMoved,
        payload: {suggestionType: 'delete', suggestionId: suggestion.id},
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

/**
 * Replace: strikethrough on original text + inline replacement preview.
 *
 * The component wraps the existing text (children) with strikethrough styling,
 * then appends a non-editable inline element showing the replacement text.
 */
function createReplaceComponent(
  replacementText: string,
  suggestion: Suggestion,
  onAction?: (event: SuggestionEvent) => void,
): (props: PropsWithChildren) => ReactElement<any> {
  return function ReplaceSuggestionComponent(
    props: PropsWithChildren,
  ): ReactElement<any> {
    return (
      <span
        data-suggestion-id={suggestion.id}
        data-suggestion-type="replace"
        className="suggestion suggestion-replace"
      >
        <span
          className="suggestion-delete"
          style={{textDecoration: 'line-through', opacity: 0.6}}
        >
          {props.children}
        </span>
        <span
          contentEditable={false}
          className="suggestion-insert"
          style={{color: 'green', textDecoration: 'none'}}
        >
          {replacementText}
        </span>
        {onAction && (
          <SuggestionActions suggestion={suggestion} onAction={onAction} />
        )}
      </span>
    )
  }
}

/**
 * Insert: inline preview of inserted text at a collapsed position.
 *
 * The decoration is at a zero-width range. Slate renders a zero-width space
 * as children. The component injects the preview text as a non-editable
 * inline element alongside the zero-width space.
 */
function createInsertComponent(
  insertedText: string,
  suggestion: Suggestion,
  onAction?: (event: SuggestionEvent) => void,
): (props: PropsWithChildren) => ReactElement<any> {
  return function InsertSuggestionComponent(
    props: PropsWithChildren,
  ): ReactElement<any> {
    return (
      <span
        data-suggestion-id={suggestion.id}
        data-suggestion-type="insert"
        className="suggestion suggestion-insert-wrapper"
      >
        {props.children}
        <span
          contentEditable={false}
          className="suggestion-insert"
          style={{color: 'green'}}
        >
          {insertedText}
        </span>
        {onAction && (
          <SuggestionActions suggestion={suggestion} onAction={onAction} />
        )}
      </span>
    )
  }
}

/**
 * Delete: strikethrough on the text to be deleted.
 */
function createDeleteComponent(
  suggestion: Suggestion,
  onAction?: (event: SuggestionEvent) => void,
): (props: PropsWithChildren) => ReactElement<any> {
  return function DeleteSuggestionComponent(
    props: PropsWithChildren,
  ): ReactElement<any> {
    return (
      <span
        data-suggestion-id={suggestion.id}
        data-suggestion-type="delete"
        className="suggestion suggestion-delete"
        style={{textDecoration: 'line-through', opacity: 0.6}}
      >
        {props.children}
        {onAction && (
          <SuggestionActions suggestion={suggestion} onAction={onAction} />
        )}
      </span>
    )
  }
}

/**
 * Inline accept/reject buttons for a suggestion.
 * Rendered as non-editable inline content.
 */
function SuggestionActions(props: {
  suggestion: Suggestion
  onAction: (event: SuggestionEvent) => void
}): ReactElement<any> {
  return (
    <span
      contentEditable={false}
      className="suggestion-actions"
      style={{userSelect: 'none', marginLeft: '2px'}}
    >
      <button
        type="button"
        className="suggestion-accept"
        title="Accept suggestion"
        onClick={() =>
          props.onAction({action: 'accept', suggestion: props.suggestion})
        }
      >
        ✓
      </button>
      <button
        type="button"
        className="suggestion-reject"
        title="Reject suggestion"
        onClick={() =>
          props.onAction({action: 'reject', suggestion: props.suggestion})
        }
      >
        ✗
      </button>
    </span>
  )
}
