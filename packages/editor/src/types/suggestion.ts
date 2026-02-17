import type {EditorSelection} from './editor'

/**
 * A content suggestion represents a proposed change to the editor content.
 * Suggestions are external objects (e.g., from AI, collaborators, or review systems)
 * that render as range decorations on the PTE surface.
 *
 * Phase 1: Read-only display — suggestions are rendered inline with accept/reject
 * affordances. The editor content is NOT modified; suggestions are purely visual
 * overlays powered by range decorations.
 *
 * @alpha
 */

/**
 * Replace existing text with new text.
 *
 * Renders as: strikethrough on original text + inline preview of replacement.
 * The selection covers the text to be replaced.
 *
 * @alpha
 */
export interface ReplaceSuggestion {
  type: 'replace'
  /**
   * Stable identifier for this suggestion.
   * Used as the RangeDecoration `id` to link decorations to suggestions.
   * Must be unique across all suggestions in the editor.
   */
  id: string
  /**
   * The editor selection covering the text to be replaced.
   * Must be non-null and expanded (anchor !== focus).
   */
  selection: NonNullable<EditorSelection>
  /**
   * The replacement text to show inline.
   */
  replacementText: string
  /**
   * Optional description of why this change is suggested.
   */
  description?: string
}

/**
 * Insert new text at a position.
 *
 * Renders as: inline preview of inserted text at a collapsed selection point.
 * Uses a zero-width range decoration — the decoration component injects
 * the preview text as a non-editable inline element.
 *
 * @alpha
 */
export interface InsertSuggestion {
  type: 'insert'
  /**
   * Stable identifier for this suggestion.
   * Used as the RangeDecoration `id` to link decorations to suggestions.
   * Must be unique across all suggestions in the editor.
   */
  id: string
  /**
   * The editor selection where text should be inserted.
   * Must be non-null and collapsed (anchor === focus).
   */
  selection: NonNullable<EditorSelection>
  /**
   * The text to insert.
   */
  insertedText: string
  /**
   * Optional description of why this insertion is suggested.
   */
  description?: string
}

/**
 * Delete existing text.
 *
 * Renders as: strikethrough on the text to be deleted.
 * The selection covers the text to be removed.
 *
 * @alpha
 */
export interface DeleteSuggestion {
  type: 'delete'
  /**
   * Stable identifier for this suggestion.
   * Used as the RangeDecoration `id` to link decorations to suggestions.
   * Must be unique across all suggestions in the editor.
   */
  id: string
  /**
   * The editor selection covering the text to be deleted.
   * Must be non-null and expanded (anchor !== focus).
   */
  selection: NonNullable<EditorSelection>
  /**
   * Optional description of why this deletion is suggested.
   */
  description?: string
}

/**
 * Union of all suggestion types.
 * @alpha
 */
export type Suggestion = ReplaceSuggestion | InsertSuggestion | DeleteSuggestion

/**
 * The result of accepting or rejecting a suggestion.
 * Emitted by the suggestion system so the consumer can update their state.
 *
 * @alpha
 */
export interface SuggestionEvent {
  /**
   * The type of action taken.
   */
  action: 'accept' | 'reject'
  /**
   * The suggestion that was acted upon.
   */
  suggestion: Suggestion
}

/**
 * Callback for when a suggestion's position changes due to edits.
 * Mirrors the RangeDecoration onMoved pattern.
 *
 * @alpha
 */
export interface SuggestionOnMovedDetails {
  /**
   * The suggestion whose position changed.
   */
  suggestion: Suggestion
  /**
   * The new selection after the edit. Null if the suggestion was invalidated
   * (e.g., the text it referenced was deleted).
   */
  newSelection: EditorSelection
  /**
   * The selection before the edit.
   */
  previousSelection: EditorSelection
  /**
   * Whether the change was from a local or remote edit.
   */
  origin: 'local' | 'remote'
}

/**
 * Configuration for the suggestion rendering system.
 *
 * @alpha
 */
export interface SuggestionConfig {
  /**
   * The suggestions to render as range decorations.
   */
  suggestions: Suggestion[]
  /**
   * Called when a suggestion is accepted or rejected.
   */
  onAction?: (event: SuggestionEvent) => void
  /**
   * Called when a suggestion's position changes due to edits.
   * Return an EditorSelection to override the auto-resolved position
   * (only honored for remote origin, same as RangeDecoration.onMoved).
   */
  onMoved?: (details: SuggestionOnMovedDetails) => EditorSelection | void
}
