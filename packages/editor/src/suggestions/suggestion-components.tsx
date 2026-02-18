import type {PortableTextBlock} from '@portabletext/schema'
import type {PropsWithChildren, ReactElement} from 'react'
import {getPlainTextFromSuggestion} from '../types/suggestion'

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

/**
 * Base props for suggestion components.
 * @alpha
 */
export interface SuggestionComponentProps extends PropsWithChildren {
  suggestionId: string
}

/**
 * Renders replaced text with strikethrough + inline replacement preview.
 * @alpha
 */
export function ReplaceSuggestionComponent(
  props: SuggestionComponentProps & {
    content: PortableTextBlock[]
    onAccept?: () => void
    onReject?: () => void
  },
): ReactElement<any> {
  // Extract plain text for rendering — rich text rendering is Phase 2B
  const displayText = getPlainTextFromSuggestion({
    type: 'replace',
    id: props.suggestionId,
    selection: {anchor: {path: [], offset: 0}, focus: {path: [], offset: 0}},
    content: props.content,
  })

  return (
    <span
      data-testid={`suggestion-${props.suggestionId}`}
      data-suggestion-id={props.suggestionId}
      data-suggestion-type="replace"
    >
      <span
        data-testid={`suggestion-${props.suggestionId}-deleted`}
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
        data-testid={`suggestion-${props.suggestionId}-inserted`}
        data-suggestion-role="inserted-text"
        style={{
          color: '#16a34a',
          textDecoration: 'none',
          backgroundColor: 'rgba(22, 163, 74, 0.1)',
          borderRadius: '2px',
          padding: '0 1px',
        }}
      >
        {displayText}
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
 * The inserted text is injected as an inline element alongside the
 * Slate leaf. Slate ignores it (no data-slate-* attributes), and
 * any keystrokes into the suggestion text still go through
 * beforeinput → behavior system → suggest mode interception.
 * @alpha
 */
export function InsertSuggestionComponent(
  props: SuggestionComponentProps & {
    content: PortableTextBlock[]
    onAccept?: () => void
    onReject?: () => void
  },
): ReactElement<any> {
  // Extract plain text for rendering — rich text rendering is Phase 2B
  const displayText = getPlainTextFromSuggestion({
    type: 'insert',
    id: props.suggestionId,
    selection: {anchor: {path: [], offset: 0}, focus: {path: [], offset: 0}},
    content: props.content,
  })

  return (
    <span
      data-testid={`suggestion-${props.suggestionId}`}
      data-suggestion-id={props.suggestionId}
      data-suggestion-type="insert"
    >
      <span
        data-testid={`suggestion-${props.suggestionId}-inserted`}
        data-suggestion-role="inserted-text"
        style={{
          color: '#16a34a',
          backgroundColor: 'rgba(22, 163, 74, 0.1)',
          borderRadius: '2px',
          padding: '0 1px',
        }}
      >
        {displayText}
      </span>
      {(props.onAccept || props.onReject) && (
        <SuggestionActionButtons
          onAccept={props.onAccept}
          onReject={props.onReject}
        />
      )}
      {props.children}
    </span>
  )
}

/**
 * Renders deleted text with strikethrough.
 * @alpha
 */
export function DeleteSuggestionComponent(
  props: SuggestionComponentProps & {
    onAccept?: () => void
    onReject?: () => void
  },
): ReactElement<any> {
  return (
    <span
      data-testid={`suggestion-${props.suggestionId}`}
      data-suggestion-id={props.suggestionId}
      data-suggestion-type="delete"
    >
      <span
        data-testid={`suggestion-${props.suggestionId}-deleted`}
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
