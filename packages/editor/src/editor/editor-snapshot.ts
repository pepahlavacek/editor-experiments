import type {PortableTextBlock} from '@portabletext/schema'
import type {Converter} from '../converters/converter.types'
import {slateRangeToSelection} from '../internal-utils/slate-utils'
import type {EditorSelection} from '../types/editor'
import type {PortableTextSlateEditor} from '../types/slate-editor'
import type {EditorSchema} from './editor-schema'

/**
 * @public
 */
export type EditorContext = {
  converters: Array<Converter>
  keyGenerator: () => string
  readOnly: boolean
  /**
   * Whether the editor is in suggesting mode.
   * When true, mutation events are intercepted by the suggest-mode behavior
   * instead of modifying the document directly.
   *
   * @alpha
   */
  suggesting: boolean
  schema: EditorSchema
  selection: EditorSelection
  value: Array<PortableTextBlock>
}

/**
 * @public
 */
export type EditorSnapshot = {
  context: EditorContext
  blockIndexMap: Map<string, number>
  /**
   * @beta
   * Subject to change
   */
  decoratorState: Record<string, boolean | undefined>
}

export function createEditorSnapshot({
  converters,
  editor,
  keyGenerator,
  readOnly,
  suggesting,
  schema,
}: {
  converters: Array<Converter>
  editor: PortableTextSlateEditor
  keyGenerator: () => string
  readOnly: boolean
  suggesting: boolean
  schema: EditorSchema
}) {
  const selection = editor.selection
    ? slateRangeToSelection({
        schema,
        editor,
        range: editor.selection,
      })
    : null

  const context = {
    converters,
    keyGenerator,
    readOnly,
    suggesting,
    schema,
    selection,
    value: editor.value,
  } satisfies EditorContext

  return {
    blockIndexMap: editor.blockIndexMap,
    context,
    decoratorState: editor.decoratorState,
  } satisfies EditorSnapshot
}
