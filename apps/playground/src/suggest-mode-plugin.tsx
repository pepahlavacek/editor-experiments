import {
  createSuggestModeBehavior,
  textToSuggestionContent,
  useEditor,
  useEditorSelector,
  type SuggestModeInterceptEvent,
} from '@portabletext/editor'
import {useCallback, useEffect, useRef} from 'react'
import type {FakeSuggestionService} from './fake-suggestion-service'

/**
 * Plugin component that registers the suggest mode behavior with the editor.
 *
 * Must be rendered inside an EditorProvider. When suggest mode is active,
 * typing creates suggestions instead of editing the base document.
 *
 * The behavior intercepts mutation events (insert.text, delete, etc.) and
 * redirects them to the suggestion service.
 */
export function SuggestModePlugin(props: {
  active: boolean
  service: FakeSuggestionService
}) {
  const editor = useEditor()
  const activeRef = useRef(props.active)
  activeRef.current = props.active

  const serviceRef = useRef(props.service)
  serviceRef.current = props.service

  const nextIdRef = useRef(1)

  const onIntercept = useCallback(
    ({event, snapshot}: SuggestModeInterceptEvent) => {
      const selection = snapshot.context.selection
      if (!selection) return

      const id = `suggest-${nextIdRef.current++}`

      switch (event.type) {
        case 'insert.text': {
          if (!('text' in event) || !event.text) return
          // Create an insert suggestion at the current cursor position
          const collapsedSelection = {
            anchor: selection.anchor,
            focus: selection.anchor,
          }
          serviceRef.current.addSuggestionImmediate({
            type: 'insert',
            id,
            selection: collapsedSelection,
            content: textToSuggestionContent(event.text),
          })
          break
        }
        case 'delete':
        case 'delete.backward':
        case 'delete.forward':
        case 'delete.text': {
          // For delete events with an expanded selection, create a delete suggestion
          const isExpanded =
            selection.anchor.offset !== selection.focus.offset ||
            JSON.stringify(selection.anchor.path) !==
              JSON.stringify(selection.focus.path)
          if (isExpanded) {
            serviceRef.current.addSuggestionImmediate({
              type: 'delete',
              id,
              selection,
            })
          }
          // For collapsed selection deletes (backspace/forward delete),
          // we'd need to compute the affected range — Phase 2B
          break
        }
        case 'insert.break':
        case 'insert.soft break':
        case 'split': {
          // Create an insert suggestion with a newline
          const collapsedSelection = {
            anchor: selection.anchor,
            focus: selection.anchor,
          }
          serviceRef.current.addSuggestionImmediate({
            type: 'insert',
            id,
            selection: collapsedSelection,
            content: textToSuggestionContent('\n'),
          })
          break
        }
        default:
          // Other mutation events (style, decorator, annotation, etc.)
          // are intercepted but not yet handled — they don't modify the doc
          console.log(
            `[SuggestMode] Intercepted ${event.type} — not yet handled`,
          )
          break
      }
    },
    [],
  )

  useEffect(() => {
    const behavior = createSuggestModeBehavior({
      isActive: () => activeRef.current,
      onIntercept,
    })

    const unregister = editor.registerBehavior({behavior})
    return unregister
  }, [editor, onIntercept])

  return null
}
