import {
  getPlainTextFromSuggestion,
  suggestionsToDecorations,
  useEditor,
  useEditorSelector,
  type Editor,
  type EditorSelection,
  type RangeDecoration,
  type Suggestion,
} from '@portabletext/editor'
import {SparklesIcon, Trash2Icon, ZapIcon} from 'lucide-react'
import {useCallback, useEffect, useMemo, useRef, useState} from 'react'
import {TooltipTrigger} from 'react-aria-components'
import {FakeSuggestionService} from './fake-suggestion-service'
import {Button} from './primitives/button'
import {ToggleButton} from './primitives/toggle-button'
import {Tooltip} from './primitives/tooltip'

/**
 * Apply a suggestion's change to the editor document.
 *
 * - Insert: place cursor at suggestion position, insert text
 * - Delete: select the suggestion range, delete (insert empty text)
 * - Replace: select the suggestion range, insert replacement text
 */
/**
 * Apply a suggestion's change to the editor document.
 *
 * - Insert: place cursor at suggestion position, insert text
 * - Delete: select the suggestion range, delete (insert empty text)
 * - Replace: select the suggestion range, insert replacement text
 */
function applySuggestionToEditor(editor: Editor, suggestion: Suggestion) {
  switch (suggestion.type) {
    case 'insert': {
      // Place cursor at the insert position (collapsed selection)
      const text = getPlainTextFromSuggestion(suggestion)
      editor.send({type: 'focus'})
      editor.send({type: 'select', at: suggestion.selection})
      editor.send({type: 'insert.text', text})
      break
    }
    case 'delete':
      // Select the range and delete it
      editor.send({type: 'focus'})
      editor.send({type: 'select', at: suggestion.selection})
      editor.send({type: 'insert.text', text: ''})
      break
    case 'replace': {
      // Select the range and replace with new text
      const text = getPlainTextFromSuggestion(suggestion)
      editor.send({type: 'focus'})
      editor.send({type: 'select', at: suggestion.selection})
      editor.send({type: 'insert.text', text})
      break
    }
  }
}

/**
 * Hook that manages a shared FakeSuggestionService instance.
 * Does NOT require EditorProvider — can be called at any level.
 *
 * Returns the service, raw suggestions, enabled state, and suggest mode state.
 * Each editor creates its own decorations via useSuggestionDecorations().
 */
export function useSharedSuggestionService(): {
  service: FakeSuggestionService
  suggestions: Suggestion[]
  enabled: boolean
  toggle: () => void
} {
  const [enabled, setEnabled] = useState(false)
  const serviceRef = useRef<FakeSuggestionService | null>(null)
  if (!serviceRef.current) {
    serviceRef.current = new FakeSuggestionService()
  }
  const service = serviceRef.current

  const [suggestions, setSuggestions] = useState<Suggestion[]>([])

  useEffect(() => {
    const unsubscribe = service.subscribe((newSuggestions, event) => {
      setSuggestions(newSuggestions)
      if (event) {
        const emoji = event.type === 'added' ? '✨' : '🗑️'
        const detail =
          event.type === 'added'
            ? `${event.suggestion.type} "${event.suggestion.id}"`
            : event.type === 'removed'
              ? `${event.reason} "${event.suggestionId}"`
              : `"${event.suggestion.id}"`
        console.log(`[SuggestionService] ${emoji} ${event.type}: ${detail}`)
      }
    })
    return () => {
      unsubscribe()
      service.destroy()
    }
  }, [service])

  const toggle = useCallback(() => {
    setEnabled((prev) => {
      if (prev) {
        // Turning off — clear all suggestions
        service.clear()
      }
      return !prev
    })
  }, [service])

  return {service, suggestions, enabled, toggle}
}

/**
 * Hook that creates RangeDecorations from shared suggestions.
 * Must be called inside an EditorProvider — uses useEditor() to
 * apply accepted suggestions to the document.
 *
 * Each editor instance gets its own decorations with its own onAction
 * callback, so accept/reject applies to the correct editor.
 */
export function useSuggestionDecorations(props: {
  service: FakeSuggestionService
  suggestions: Suggestion[]
  enabled: boolean
}): RangeDecoration[] {
  const editor = useEditor()

  const onAction = useCallback(
    (event: {action: 'accept' | 'reject'; suggestion: Suggestion}) => {
      if (event.action === 'accept') {
        // Bypass suggest mode so the editor operations don't get intercepted
        // and turned into more suggestions.
        props.service.isBypassing = true
        try {
          applySuggestionToEditor(editor, event.suggestion)
        } finally {
          props.service.isBypassing = false
        }
        props.service.acceptSuggestion(event.suggestion.id)
      } else {
        props.service.rejectSuggestion(event.suggestion.id)
      }
    },
    [editor, props.service],
  )

  return useMemo(() => {
    if (!props.enabled || props.suggestions.length === 0) return []
    return suggestionsToDecorations({
      suggestions: props.suggestions,
      onAction,
    })
  }, [props.enabled, props.suggestions, onAction])
}

/**
 * Footer toggle button for the suggestion service.
 */
export function SuggestionServiceToggle(props: {
  enabled: boolean
  suggestionCount: number
  onToggle: () => void
}) {
  return (
    <TooltipTrigger>
      <ToggleButton
        variant="ghost"
        size="sm"
        isSelected={props.enabled}
        onChange={props.onToggle}
      >
        <SparklesIcon className="size-3" />
        {props.enabled && props.suggestionCount > 0 && (
          <span className="text-[10px] font-mono ml-0.5">
            {props.suggestionCount}
          </span>
        )}
      </ToggleButton>
      <Tooltip>
        {props.enabled
          ? `Suggestions ON (${props.suggestionCount} active)`
          : 'Suggestions OFF — click to enable'}
      </Tooltip>
    </TooltipTrigger>
  )
}

/**
 * Panel for creating and managing suggestions.
 * Must be rendered inside an EditorProvider.
 */
export function SuggestionPanel(props: {
  service: FakeSuggestionService
  suggestions: Suggestion[]
  enabled: boolean
}) {
  const editor = useEditor()
  const selection = useEditorSelector(editor, (s) => s.context.selection)
  const [inputText, setInputText] = useState('')
  const [pendingCount, setPendingCount] = useState(0)

  // Track pending count with a timer
  useEffect(() => {
    if (!props.enabled) return
    const interval = setInterval(() => {
      setPendingCount(props.service.pendingCount)
    }, 100)
    return () => clearInterval(interval)
  }, [props.service, props.enabled])

  const hasExpandedSelection = selection
    ? selection.anchor.offset !== selection.focus.offset ||
      JSON.stringify(selection.anchor.path) !==
        JSON.stringify(selection.focus.path)
    : false

  const collapsedSelection: NonNullable<EditorSelection> | null = selection
    ? {anchor: selection.anchor, focus: selection.anchor}
    : null

  const handleInsert = useCallback(() => {
    if (!collapsedSelection) return
    props.service.queueSuggestion('insert', collapsedSelection, {
      text: inputText || 'suggested text',
    })
    setInputText('')
  }, [props.service, collapsedSelection, inputText])

  const handleReplace = useCallback(() => {
    if (!selection || !hasExpandedSelection) return
    props.service.queueSuggestion('replace', selection, {
      text: inputText || 'replacement',
    })
    setInputText('')
  }, [props.service, selection, hasExpandedSelection, inputText])

  const handleDelete = useCallback(() => {
    if (!selection || !hasExpandedSelection) return
    props.service.queueSuggestion('delete', selection)
  }, [props.service, selection, hasExpandedSelection])

  const handleChaos = useCallback(() => {
    if (!selection) return
    // Fire 3-5 random suggestions with varying delays
    const count = 3 + Math.floor(Math.random() * 3)
    const types = ['insert', 'replace', 'delete'] as const
    for (let i = 0; i < count; i++) {
      const type = types[Math.floor(Math.random() * types.length)]!
      const delay = 100 + Math.random() * 2000
      if (type === 'insert') {
        const words = [
          'however',
          'additionally',
          'furthermore',
          'notably',
          'importantly',
        ]
        const word = words[Math.floor(Math.random() * words.length)]!
        props.service.queueSuggestion(
          'insert',
          {
            anchor: selection.anchor,
            focus: selection.anchor,
          },
          {text: ` ${word}`, delay},
        )
      } else if (type === 'replace' && hasExpandedSelection) {
        const replacements = [
          'improved version',
          'better text',
          'revised content',
        ]
        const text =
          replacements[Math.floor(Math.random() * replacements.length)]!
        props.service.queueSuggestion('replace', selection, {text, delay})
      } else if (type === 'delete' && hasExpandedSelection) {
        props.service.queueSuggestion('delete', selection, {delay})
      }
    }
  }, [props.service, selection, hasExpandedSelection])

  const handleClear = useCallback(() => {
    props.service.clear()
  }, [props.service])

  if (!props.enabled) return null

  return (
    <div className="border-t border-gray-200 dark:border-gray-700 pt-2 mt-2">
      <div className="flex items-center gap-2 mb-2">
        <SparklesIcon className="size-3 text-gray-400" />
        <span className="text-xs font-medium text-gray-500 dark:text-gray-400">
          Suggestion Service
        </span>
        {!selection && (
          <span className="text-[10px] text-gray-400 italic">
            Click in editor to place cursor
          </span>
        )}
        {pendingCount > 0 && (
          <span className="text-[10px] text-amber-500 font-mono">
            {pendingCount} pending…
          </span>
        )}
        <div className="flex-1" />
        {props.suggestions.length > 0 && (
          <TooltipTrigger>
            <Button variant="ghost" size="sm" onPress={handleClear}>
              <Trash2Icon className="size-3" />
            </Button>
            <Tooltip>Clear all suggestions</Tooltip>
          </TooltipTrigger>
        )}
      </div>

      <div className="flex items-center gap-1.5 mb-1.5">
        <input
          type="text"
          value={inputText}
          onChange={(e) => setInputText(e.target.value)}
          placeholder="Text for insert/replace…"
          className="flex-1 text-xs px-2 py-1 rounded border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-800 text-gray-900 dark:text-gray-100 placeholder:text-gray-400 outline-none focus:border-blue-400 dark:focus:border-blue-500"
          onKeyDown={(e) => {
            // Prevent editor from capturing keystrokes
            e.stopPropagation()
          }}
        />
      </div>

      <div className="flex items-center gap-1">
        <TooltipTrigger>
          <Button
            variant="secondary"
            size="sm"
            onPress={handleInsert}
            isDisabled={!selection}
          >
            <span className="text-xs">+ Insert</span>
          </Button>
          <Tooltip>
            Insert text at cursor position (collapsed selection)
          </Tooltip>
        </TooltipTrigger>

        <TooltipTrigger>
          <Button
            variant="secondary"
            size="sm"
            onPress={handleReplace}
            isDisabled={!hasExpandedSelection}
          >
            <span className="text-xs">↔ Replace</span>
          </Button>
          <Tooltip>Replace selected text (requires expanded selection)</Tooltip>
        </TooltipTrigger>

        <TooltipTrigger>
          <Button
            variant="secondary"
            size="sm"
            onPress={handleDelete}
            isDisabled={!hasExpandedSelection}
          >
            <span className="text-xs">− Delete</span>
          </Button>
          <Tooltip>Delete selected text (requires expanded selection)</Tooltip>
        </TooltipTrigger>

        <div className="w-px h-4 bg-gray-300 dark:bg-gray-600 mx-0.5" />

        <TooltipTrigger>
          <Button
            variant="ghost"
            size="sm"
            onPress={handleChaos}
            isDisabled={!selection}
          >
            <ZapIcon className="size-3" />
            <span className="text-xs">Chaos</span>
          </Button>
          <Tooltip>
            Fire 3-5 random suggestions with random delays (stress test)
          </Tooltip>
        </TooltipTrigger>
      </div>

      {props.suggestions.length > 0 && (
        <div className="mt-2 space-y-1">
          <span className="text-[10px] text-gray-400 uppercase tracking-wider">
            Active ({props.suggestions.length})
          </span>
          {props.suggestions.map((s) => (
            <div
              key={s.id}
              className="flex items-center gap-1.5 text-xs text-gray-600 dark:text-gray-400"
            >
              <SuggestionTypeBadge type={s.type} />
              <span className="font-mono text-[10px] truncate flex-1">
                {s.id}
              </span>
              <button
                type="button"
                className="text-red-400 hover:text-red-600 text-[10px]"
                onClick={() => props.service.removeSuggestion(s.id)}
              >
                ✗
              </button>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}

function SuggestionTypeBadge(props: {type: Suggestion['type']}) {
  const colors = {
    insert:
      'bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-400',
    replace: 'bg-blue-100 text-blue-700 dark:bg-blue-900/30 dark:text-blue-400',
    delete: 'bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-400',
  }
  return (
    <span
      className={`text-[10px] px-1 rounded font-medium ${colors[props.type]}`}
    >
      {props.type}
    </span>
  )
}
