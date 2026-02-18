import type {PortableTextBlock} from '@portabletext/schema'
import type {PropsWithChildren, ReactElement} from 'react'
import {getPlainTextFromSuggestion} from '../types/suggestion'

/**
 * Default suggestion rendering components.
 *
 * These are intentionally minimal — inline styles only, no framework dependencies.
 * Consumers can provide their own components via SuggestionConfig for custom styling.
 *
 * The components render colored text only — no interactive elements.
 * Accept/reject actions should be handled outside the editable area
 * (e.g., in a sidebar panel) to avoid contentEditable DOM conflicts.
 *
 * The components use data attributes for external CSS targeting:
 * - [data-suggestion-id] — unique suggestion identifier
 * - [data-suggestion-type] — 'replace' | 'insert' | 'delete'
 * - [data-suggestion-role] — 'deleted-text' | 'inserted-text'
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
        contentEditable={false}
        data-testid={`suggestion-${props.suggestionId}-inserted`}
        data-suggestion-role="inserted-text"
        style={{
          color: '#16a34a',
          textDecoration: 'none',
          backgroundColor: 'rgba(22, 163, 74, 0.1)',
          borderRadius: '2px',
          padding: '0 1px',
          userSelect: 'none',
        }}
      >
        {displayText}
      </span>
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
        contentEditable={false}
        data-testid={`suggestion-${props.suggestionId}-inserted`}
        data-suggestion-role="inserted-text"
        style={{
          color: '#16a34a',
          backgroundColor: 'rgba(22, 163, 74, 0.1)',
          borderRadius: '2px',
          padding: '0 1px',
          userSelect: 'none',
        }}
      >
        {displayText}
      </span>
      {props.children}
    </span>
  )
}

/**
 * Renders deleted text with strikethrough.
 * @alpha
 */
export function DeleteSuggestionComponent(
  props: SuggestionComponentProps,
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
    </span>
  )
}
