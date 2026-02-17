import {
  useEditor,
  type EditorSelection,
  type EditorSelectionPoint,
  type PortableTextBlock,
  type RangeDecoration,
} from '@portabletext/editor'
import {AnchorIcon, ShuffleIcon} from 'lucide-react'
import {useCallback, useRef, useState} from 'react'
import {TooltipTrigger} from 'react-aria-components'
import {Button} from './primitives/button'
import {Tooltip} from './primitives/tooltip'

/**
 * Shift an EditorSelectionPoint's offset by `delta`, clamped to [0, maxOffset].
 */
function shiftPoint(
  point: EditorSelectionPoint,
  delta: number,
  maxOffset: number,
): EditorSelectionPoint {
  return {
    ...point,
    offset: Math.max(0, Math.min(maxOffset, point.offset + delta)),
  }
}

/**
 * Get the text length of the block containing a given point.
 * Returns 0 if the block can't be found.
 */
function getBlockTextLength(
  value: Array<PortableTextBlock> | undefined,
  point: EditorSelectionPoint,
): number {
  if (!value) return 0

  const blockKey =
    point.path[0] &&
    typeof point.path[0] === 'object' &&
    '_key' in point.path[0]
      ? point.path[0]._key
      : undefined

  if (!blockKey) return 0

  const block = value.find(
    (b) => '_key' in b && b._key === blockKey,
  ) as PortableTextBlock & {children?: Array<{text?: string}>}

  if (!block?.children) return 0

  return block.children.reduce(
    (sum, child) => sum + (child.text ?? '').length,
    0,
  )
}

/**
 * Create a shifted copy of a selection with random offset deltas.
 * Offsets are clamped to valid ranges based on actual block text lengths.
 */
function shiftSelection(
  selection: EditorSelection,
  value: Array<PortableTextBlock> | undefined,
): EditorSelection {
  if (!selection) return selection

  const anchorMax = getBlockTextLength(value, selection.anchor)
  const focusMax = getBlockTextLength(value, selection.focus)

  // Random shift between -3 and +3, but at least ±1
  const anchorDelta = randomNonZeroDelta(-3, 3)
  const focusDelta = randomNonZeroDelta(-3, 3)

  return {
    anchor: shiftPoint(selection.anchor, anchorDelta, anchorMax),
    focus: shiftPoint(selection.focus, focusDelta, focusMax),
  }
}

function randomNonZeroDelta(min: number, max: number): number {
  const range = max - min + 1
  let delta = 0
  while (delta === 0) {
    delta = Math.floor(Math.random() * range) + min
  }
  return delta
}

function randomDelay(min: number, max: number): number {
  return Math.floor(Math.random() * (max - min + 1)) + min
}

export function ReanchorButtons(props: {
  rangeDecorations: Array<RangeDecoration>
  onReanchor: (
    decoration: RangeDecoration,
    newSelection: EditorSelection,
  ) => void
}) {
  const editor = useEditor()
  const [pendingCount, setPendingCount] = useState(0)
  const pendingTimers = useRef<Set<ReturnType<typeof setTimeout>>>(new Set())

  const reanchorOne = useCallback(() => {
    const decorations = props.rangeDecorations.filter(
      (d) => d.selection !== null,
    )
    if (decorations.length === 0) return

    const target = decorations[Math.floor(Math.random() * decorations.length)]
    const value = editor.getSnapshot().context.value

    const delay = randomDelay(200, 1500)
    setPendingCount((c) => c + 1)

    const timer = setTimeout(() => {
      pendingTimers.current.delete(timer)
      setPendingCount((c) => c - 1)

      // Re-read the decoration's current selection at fire time
      // (it may have moved since the button was clicked)
      const shifted = shiftSelection(target.selection!, value)
      props.onReanchor(target, shifted)
    }, delay)

    pendingTimers.current.add(timer)
  }, [editor, props])

  const driftAll = useCallback(() => {
    const decorations = props.rangeDecorations.filter(
      (d) => d.selection !== null,
    )
    if (decorations.length === 0) return

    const value = editor.getSnapshot().context.value

    decorations.forEach((target, index) => {
      // Stagger: 200-500ms between each decoration
      const delay = randomDelay(200, 800) + index * randomDelay(200, 500)
      setPendingCount((c) => c + 1)

      const timer = setTimeout(() => {
        pendingTimers.current.delete(timer)
        setPendingCount((c) => c - 1)

        const shifted = shiftSelection(target.selection!, value)
        props.onReanchor(target, shifted)
      }, delay)

      pendingTimers.current.add(timer)
    })
  }, [editor, props])

  const hasDecorations = props.rangeDecorations.some(
    (d) => d.selection !== null,
  )

  return (
    <>
      <TooltipTrigger>
        <Button
          variant="ghost"
          size="sm"
          isDisabled={!hasDecorations}
          onPress={reanchorOne}
        >
          <AnchorIcon className="size-3" />
          {pendingCount > 0 && (
            <span className="text-[10px] text-orange-500 font-mono">
              {pendingCount}
            </span>
          )}
        </Button>
        <Tooltip>
          Reanchor — shift a random decoration&apos;s position after a delay
        </Tooltip>
      </TooltipTrigger>
      <TooltipTrigger>
        <Button
          variant="ghost"
          size="sm"
          isDisabled={!hasDecorations}
          onPress={driftAll}
        >
          <ShuffleIcon className="size-3" />
        </Button>
        <Tooltip>
          Drift All — shift all decorations with staggered delays
        </Tooltip>
      </TooltipTrigger>
    </>
  )
}
