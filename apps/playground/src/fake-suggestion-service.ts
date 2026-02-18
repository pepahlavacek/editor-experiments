import type {EditorSelection, Suggestion} from '@portabletext/editor'
import {textToSuggestionContent} from '@portabletext/editor'

export type SuggestionServiceEvent =
  | {type: 'added'; suggestion: Suggestion}
  | {type: 'updated'; suggestion: Suggestion}
  | {
      type: 'removed'
      suggestionId: string
      reason: 'accepted' | 'rejected' | 'cancelled'
    }

export type SuggestionServiceListener = (
  suggestions: Suggestion[],
  event?: SuggestionServiceEvent,
) => void

export interface FakeSuggestionServiceConfig {
  /**
   * Minimum delay in ms before a suggestion appears (default: 200)
   */
  minDelay?: number
  /**
   * Maximum delay in ms before a suggestion appears (default: 1500)
   */
  maxDelay?: number
  /**
   * Minimum delay in ms for accept/reject round-trip (default: 100)
   */
  minActionDelay?: number
  /**
   * Maximum delay in ms for accept/reject round-trip (default: 800)
   */
  maxActionDelay?: number
}

/**
 * Simulates an async suggestion service with configurable latency.
 *
 * Suggestions are queued with a delay before they appear. Accept/reject
 * actions also have a simulated round-trip delay before the suggestion
 * is removed. This models the real-world scenario where:
 *
 * 1. AI/backend generates a suggestion (network latency)
 * 2. User sees it and clicks accept/reject
 * 3. Backend processes the action (network latency)
 * 4. Suggestion is removed from the list
 *
 * Between steps 1-2, the editor content may change — this is exactly
 * what onMoved handles.
 */
export class FakeSuggestionService {
  private suggestions: Map<string, Suggestion> = new Map()
  private pendingTimers: Map<string, ReturnType<typeof setTimeout>> = new Map()
  private listeners: Set<SuggestionServiceListener> = new Set()
  private config: Required<FakeSuggestionServiceConfig>
  private nextId = 1

  /**
   * When true, suggest mode behavior should let events pass through.
   * Used during accept/reject to prevent the behavior from intercepting
   * the editor operations that apply the suggestion's changes.
   */
  isBypassing = false

  constructor(config: FakeSuggestionServiceConfig = {}) {
    this.config = {
      minDelay: config.minDelay ?? 200,
      maxDelay: config.maxDelay ?? 1500,
      minActionDelay: config.minActionDelay ?? 100,
      maxActionDelay: config.maxActionDelay ?? 800,
    }
  }

  /**
   * Subscribe to suggestion list changes.
   * Callback receives the full current list + the event that triggered the change.
   * Returns an unsubscribe function.
   */
  subscribe(listener: SuggestionServiceListener): () => void {
    this.listeners.add(listener)
    // Emit current state immediately
    listener(this.getSnapshot())
    return () => {
      this.listeners.delete(listener)
    }
  }

  /**
   * Get the current suggestion list (snapshot).
   */
  getSnapshot(): Suggestion[] {
    return Array.from(this.suggestions.values())
  }

  /**
   * Queue a suggestion to appear after a delay.
   * Returns the suggestion ID.
   *
   * @param type - Suggestion type
   * @param selection - Editor selection for the suggestion
   * @param options - Additional options (text, delay override)
   */
  queueSuggestion(
    type: 'replace' | 'insert' | 'delete',
    selection: NonNullable<EditorSelection>,
    options: {
      text?: string
      delay?: number
      id?: string
    } = {},
  ): string {
    const id = options.id ?? `suggestion-${this.nextId++}`
    const delay = options.delay ?? this.randomDelay()

    let suggestion: Suggestion
    switch (type) {
      case 'replace':
        suggestion = {
          type: 'replace',
          id,
          selection,
          content: textToSuggestionContent(options.text ?? 'replacement'),
        }
        break
      case 'insert':
        suggestion = {
          type: 'insert',
          id,
          selection,
          content: textToSuggestionContent(options.text ?? 'inserted text'),
        }
        break
      case 'delete':
        suggestion = {
          type: 'delete',
          id,
          selection,
        }
        break
    }

    const timer = setTimeout(() => {
      this.pendingTimers.delete(id)
      this.suggestions.set(id, suggestion)
      this.notify({type: 'added', suggestion})
    }, delay)

    this.pendingTimers.set(id, timer)
    return id
  }

  /**
   * Add a suggestion immediately (no delay).
   */
  addSuggestionImmediate(suggestion: Suggestion): void {
    // Cancel any pending timer for this ID
    const existing = this.pendingTimers.get(suggestion.id)
    if (existing) {
      clearTimeout(existing)
      this.pendingTimers.delete(suggestion.id)
    }
    this.suggestions.set(suggestion.id, suggestion)
    this.notify({type: 'added', suggestion})
  }

  /**
   * Update an existing suggestion in-place.
   * Used by suggest mode continuation to extend/shrink suggestions.
   * Notifies listeners with an 'updated' event.
   */
  updateSuggestion(suggestion: Suggestion): void {
    if (!this.suggestions.has(suggestion.id)) {
      throw new Error(`Cannot update suggestion "${suggestion.id}" — not found`)
    }
    this.suggestions.set(suggestion.id, suggestion)
    this.notify({type: 'updated', suggestion})
  }

  /**
   * Accept a suggestion with simulated round-trip delay.
   * The suggestion is removed after the delay.
   */
  acceptSuggestion(id: string, delay?: number): void {
    const actualDelay = delay ?? this.randomActionDelay()
    setTimeout(() => {
      this.suggestions.delete(id)
      this.notify({type: 'removed', suggestionId: id, reason: 'accepted'})
    }, actualDelay)
  }

  /**
   * Reject a suggestion with simulated round-trip delay.
   */
  rejectSuggestion(id: string, delay?: number): void {
    const actualDelay = delay ?? this.randomActionDelay()
    setTimeout(() => {
      this.suggestions.delete(id)
      this.notify({type: 'removed', suggestionId: id, reason: 'rejected'})
    }, actualDelay)
  }

  /**
   * Remove a suggestion immediately (cancel).
   */
  removeSuggestion(id: string): void {
    // Cancel pending timer if it hasn't fired yet
    const timer = this.pendingTimers.get(id)
    if (timer) {
      clearTimeout(timer)
      this.pendingTimers.delete(id)
    }
    if (this.suggestions.delete(id)) {
      this.notify({type: 'removed', suggestionId: id, reason: 'cancelled'})
    }
  }

  /**
   * Remove all suggestions and cancel all pending timers.
   */
  clear(): void {
    for (const timer of this.pendingTimers.values()) {
      clearTimeout(timer)
    }
    this.pendingTimers.clear()
    const hadSuggestions = this.suggestions.size > 0
    this.suggestions.clear()
    if (hadSuggestions) {
      this.notify()
    }
  }

  /**
   * Update the latency configuration.
   */
  updateConfig(config: Partial<FakeSuggestionServiceConfig>): void {
    Object.assign(this.config, config)
  }

  /**
   * Get the number of pending (not yet visible) suggestions.
   */
  get pendingCount(): number {
    return this.pendingTimers.size
  }

  /**
   * Destroy the service — clear all state and listeners.
   */
  destroy(): void {
    this.clear()
    this.listeners.clear()
  }

  private notify(event?: SuggestionServiceEvent): void {
    const snapshot = this.getSnapshot()
    for (const listener of this.listeners) {
      listener(snapshot, event)
    }
  }

  private randomDelay(): number {
    return (
      this.config.minDelay +
      Math.random() * (this.config.maxDelay - this.config.minDelay)
    )
  }

  private randomActionDelay(): number {
    return (
      this.config.minActionDelay +
      Math.random() * (this.config.maxActionDelay - this.config.minActionDelay)
    )
  }
}
