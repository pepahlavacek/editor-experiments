import type {PropsWithChildren, ReactElement} from 'react'

/**
 * Default suggestion rendering components.
 *
 * These are intentionally minimal — inline styles only, no framework dependencies.
 * Consumers can provide their own components via SuggestionConfig for custom styling.
 *
 * The components use data attributes for external CSS targeting:
 * - [data-suggestion-id] — unique suggestion identifier
 * - [data-suggestion-type] — 'replace' | 'insert' | 'delete'
 * - [data-suggestion-role] — 'deleted-text' | 'inserted-text' | 'actions'
 *
 * @alpha
 */

export interface SuggestionComponentProps extends PropsWithChildren {
  suggestionId: string
}

/**
 * Renders replaced text with strikethrough + inline replacement preview.
 */
export function ReplaceSuggestionComponent(
  props: SuggestionComponentProps & {
    replacementText: string
    onAccept?: () => void
    onReject?: () => void
  },
): ReactElement<any> {
  return (
    <span
      data-suggestion-id={props.suggestionId}
      data-suggestion-type="replace"
    >
      <span
        data-suggestion-role="deleted-text"
        style={{
          textDecoration: 'line-through',
          opacity: 0.6,
          color: 'inherit',
        }}
      >
        {props.children}
      </span>
      <span
        contentEditable={false}
        data-suggestion-role="inserted-text"
        style={{
          color: '#16a34a',
          textDecoration: 'none',
          backgroundColor: 'rgba(22, 163, 74, 0.1)',
          borderRadius: '2px',
          padding: '0 1px',
        }}
      >
        {props.replacementText}
      </span>
      {(props.onAccept || props.onReject) && (
        <SuggestionActionButtons
          onAccept={props.onAccept}
          onReject={props.onReject}
        />
      )}
    </span>
  )
}

/**
 * Renders inserted text at a collapsed (zero-width) position.
 *
 * Children contain the zero-width space that keeps Slate happy.
 * The inserted text is injected as a non-editable inline element.
 */
export function InsertSuggestionComponent(
  props: SuggestionComponentProps & {
    insertedText: string
    onAccept?: () => void
    onReject?: () => void
  },
): ReactElement<any> {
  return (
    <span data-suggestion-id={props.suggestionId} data-suggestion-type="insert">
      {props.children}
      <span
        contentEditable={false}
        data-suggestion-role="inserted-text"
        style={{
          color: '#16a34a',
          backgroundColor: 'rgba(22, 163, 74, 0.1)',
          borderRadius: '2px',
          padding: '0 1px',
        }}
      >
        {props.insertedText}
      </span>
      {(props.onAccept || props.onReject) && (
        <SuggestionActionButtons
          onAccept={props.onAccept}
          onReject={props.onReject}
        />
      )}
    </span>
  )
}

/**
 * Renders deleted text with strikethrough.
 */
export function DeleteSuggestionComponent(
  props: SuggestionComponentProps & {
    onAccept?: () => void
    onReject?: () => void
  },
): ReactElement<any> {
  return (
    <span data-suggestion-id={props.suggestionId} data-suggestion-type="delete">
      <span
        data-suggestion-role="deleted-text"
        style={{
          textDecoration: 'line-through',
          opacity: 0.6,
          color: 'inherit',
        }}
      >
        {props.children}
      </span>
      {(props.onAccept || props.onReject) && (
        <SuggestionActionButtons
          onAccept={props.onAccept}
          onReject={props.onReject}
        />
      )}
    </span>
  )
}

/**
 * Inline accept/reject buttons.
 * Rendered as non-editable inline content to prevent Slate model corruption.
 */
function SuggestionActionButtons(props: {
  onAccept?: () => void
  onReject?: () => void
}): ReactElement<any> {
  return (
    <span
      contentEditable={false}
      data-suggestion-role="actions"
      style={{
        userSelect: 'none',
        display: 'inline-flex',
        gap: '1px',
        marginLeft: '2px',
        verticalAlign: 'middle',
      }}
    >
      {props.onAccept && (
        <button
          type="button"
          title="Accept suggestion"
          onClick={props.onAccept}
          style={{
            border: 'none',
            background: 'rgba(22, 163, 74, 0.15)',
            color: '#16a34a',
            cursor: 'pointer',
            borderRadius: '3px',
            padding: '0 3px',
            fontSize: '0.75rem',
            lineHeight: '1.25rem',
          }}
        >
          ✓
        </button>
      )}
      {props.onReject && (
        <button
          type="button"
          title="Reject suggestion"
          onClick={props.onReject}
          style={{
            border: 'none',
            background: 'rgba(220, 38, 38, 0.15)',
            color: '#dc2626',
            cursor: 'pointer',
            borderRadius: '3px',
            padding: '0 3px',
            fontSize: '0.75rem',
            lineHeight: '1.25rem',
          }}
        >
          ✗
        </button>
      )}
    </span>
  )
}
