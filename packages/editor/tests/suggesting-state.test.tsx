/**
 * Tests for the 'suggesting' state in the editor state machine.
 *
 * Phase 1 verification:
 * - Toggle suggesting mode on/off via editor.send()
 * - readOnly overrides suggesting (readOnly=true from suggesting → goes to read only)
 * - In suggesting mode, mutation events are intercepted by suggest-mode behavior
 * - In suggesting mode, non-mutation events (copy, select, click) pass through normally
 * - Existing readOnly and editable behavior is unchanged
 * - State machine snapshot exposes suggesting flag
 */
import {describe, expect, test, vi} from 'vitest'
import {createSuggestModeBehavior, type SuggestModeInterceptEvent} from '../src'
import {createTestEditor} from '../src/test/vitest'

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function helloWorldValue() {
  return [
    {
      _type: 'block',
      _key: 'b1',
      children: [{_type: 'span', _key: 's1', text: 'Hello world'}],
      markDefs: [],
    },
  ]
}

/**
 * Set up a test editor with suggest mode behavior using the state machine
 * approach (no isActive flag).
 */
async function createStateMachineSuggestEditor() {
  const interceptedEvents: SuggestModeInterceptEvent[] = []

  // No isActive — relying entirely on state machine
  const behavior = createSuggestModeBehavior({
    onIntercept: (interceptEvent) => {
      interceptedEvents.push(interceptEvent)
    },
  })

  const {editor, locator} = await createTestEditor({
    initialValue: helloWorldValue(),
  })

  const unregister = editor.registerBehavior({behavior})

  return {
    editor,
    locator,
    interceptedEvents,
    unregister,
  }
}

// ---------------------------------------------------------------------------
// Tests: State transitions
// ---------------------------------------------------------------------------

describe('Suggesting state: state transitions', () => {
  test('editor starts in editable mode, not suggesting', async () => {
    const {editor} = await createStateMachineSuggestEditor()

    const snapshot = editor.getSnapshot()
    expect(snapshot.context.readOnly).toBe(false)
    expect(snapshot.context.suggesting).toBe(false)
  })

  test('toggle suggesting mode on via state machine', async () => {
    const {editor} = await createStateMachineSuggestEditor()

    editor.send({type: 'update suggestMode', suggesting: true})

    await vi.waitFor(() => {
      const snapshot = editor.getSnapshot()
      expect(snapshot.context.suggesting).toBe(true)
      expect(snapshot.context.readOnly).toBe(false)
    })
  })

  test('toggle suggesting mode off returns to editable', async () => {
    const {editor} = await createStateMachineSuggestEditor()

    // Enable suggesting
    editor.send({type: 'update suggestMode', suggesting: true})
    await vi.waitFor(() => {
      expect(editor.getSnapshot().context.suggesting).toBe(true)
    })

    // Disable suggesting
    editor.send({type: 'update suggestMode', suggesting: false})
    await vi.waitFor(() => {
      const snapshot = editor.getSnapshot()
      expect(snapshot.context.suggesting).toBe(false)
      expect(snapshot.context.readOnly).toBe(false)
    })
  })

  test('readOnly overrides suggesting — readOnly=true from suggesting goes to read only', async () => {
    const {editor} = await createStateMachineSuggestEditor()

    // Enable suggesting
    editor.send({type: 'update suggestMode', suggesting: true})
    await vi.waitFor(() => {
      expect(editor.getSnapshot().context.suggesting).toBe(true)
    })

    // Set readOnly — should override suggesting
    editor.send({type: 'update readOnly', readOnly: true})
    await vi.waitFor(() => {
      const snapshot = editor.getSnapshot()
      expect(snapshot.context.readOnly).toBe(true)
      expect(snapshot.context.suggesting).toBe(false)
    })
  })

  test('readOnly=false from read only goes to editable, not suggesting', async () => {
    const {editor} = await createStateMachineSuggestEditor()

    // Go to read only
    editor.send({type: 'update readOnly', readOnly: true})
    await vi.waitFor(() => {
      expect(editor.getSnapshot().context.readOnly).toBe(true)
    })

    // Come back — should be editable, not suggesting
    editor.send({type: 'update readOnly', readOnly: false})
    await vi.waitFor(() => {
      const snapshot = editor.getSnapshot()
      expect(snapshot.context.readOnly).toBe(false)
      expect(snapshot.context.suggesting).toBe(false)
    })
  })

  test('update suggestMode is ignored in read only mode', async () => {
    const {editor} = await createStateMachineSuggestEditor()

    // Go to read only
    editor.send({type: 'update readOnly', readOnly: true})
    await vi.waitFor(() => {
      expect(editor.getSnapshot().context.readOnly).toBe(true)
    })

    // Try to enable suggesting — should be ignored (no transition from read only)
    editor.send({type: 'update suggestMode', suggesting: true})

    // Still read only
    await vi.waitFor(() => {
      const snapshot = editor.getSnapshot()
      expect(snapshot.context.readOnly).toBe(true)
      expect(snapshot.context.suggesting).toBe(false)
    })
  })

  test('duplicate suggestMode=true is a no-op', async () => {
    const {editor} = await createStateMachineSuggestEditor()

    editor.send({type: 'update suggestMode', suggesting: true})
    await vi.waitFor(() => {
      expect(editor.getSnapshot().context.suggesting).toBe(true)
    })

    // Send again — should not break anything
    editor.send({type: 'update suggestMode', suggesting: true})
    await vi.waitFor(() => {
      expect(editor.getSnapshot().context.suggesting).toBe(true)
    })
  })
})

// ---------------------------------------------------------------------------
// Tests: Behavior interception via state machine
// ---------------------------------------------------------------------------

describe('Suggesting state: behavior interception', () => {
  test('in suggesting mode, mutation events are intercepted', async () => {
    const {editor, locator, interceptedEvents} =
      await createStateMachineSuggestEditor()

    await locator.click()
    editor.send({
      type: 'select',
      at: {
        anchor: {path: [{_key: 'b1'}, 'children', {_key: 's1'}], offset: 5},
        focus: {path: [{_key: 'b1'}, 'children', {_key: 's1'}], offset: 5},
      },
    })

    // Enable suggesting via state machine
    editor.send({type: 'update suggestMode', suggesting: true})
    await vi.waitFor(() => {
      expect(editor.getSnapshot().context.suggesting).toBe(true)
    })

    // Type — should be intercepted
    editor.send({type: 'insert.text', text: 'X'})

    expect(interceptedEvents).toHaveLength(1)
    expect(interceptedEvents[0]!.event.type).toBe('insert.text')

    // Base document unchanged
    await vi.waitFor(() => {
      expect(locator).toHaveTextContent('Hello world')
    })
  })

  test('in suggesting mode, non-mutation events pass through', async () => {
    const {editor, locator, interceptedEvents} =
      await createStateMachineSuggestEditor()

    await locator.click()

    // Enable suggesting via state machine
    editor.send({type: 'update suggestMode', suggesting: true})
    await vi.waitFor(() => {
      expect(editor.getSnapshot().context.suggesting).toBe(true)
    })

    // Select — should pass through, not intercepted
    editor.send({
      type: 'select',
      at: {
        anchor: {path: [{_key: 'b1'}, 'children', {_key: 's1'}], offset: 3},
        focus: {path: [{_key: 'b1'}, 'children', {_key: 's1'}], offset: 3},
      },
    })

    // No interception for select events
    expect(interceptedEvents).toHaveLength(0)
  })

  test('disabling suggesting mode restores normal editing', async () => {
    const {editor, locator, interceptedEvents} =
      await createStateMachineSuggestEditor()

    await locator.click()
    editor.send({
      type: 'select',
      at: {
        anchor: {path: [{_key: 'b1'}, 'children', {_key: 's1'}], offset: 5},
        focus: {path: [{_key: 'b1'}, 'children', {_key: 's1'}], offset: 5},
      },
    })

    // Enable then disable suggesting
    editor.send({type: 'update suggestMode', suggesting: true})
    await vi.waitFor(() => {
      expect(editor.getSnapshot().context.suggesting).toBe(true)
    })
    editor.send({type: 'update suggestMode', suggesting: false})
    await vi.waitFor(() => {
      expect(editor.getSnapshot().context.suggesting).toBe(false)
    })

    // Type — should edit document normally
    editor.send({type: 'insert.text', text: 'X'})

    // No interception
    expect(interceptedEvents).toHaveLength(0)

    // Document was edited
    await vi.waitFor(() => {
      expect(locator).toHaveTextContent('HelloX world')
    })
  })
})

// ---------------------------------------------------------------------------
// Tests: Backwards compatibility with isActive flag
// ---------------------------------------------------------------------------

describe('Suggesting state: backwards compatibility', () => {
  test('isActive flag still works when state machine is not in suggesting mode', async () => {
    let suggestModeActive = false
    const interceptedEvents: SuggestModeInterceptEvent[] = []

    const behavior = createSuggestModeBehavior({
      isActive: () => suggestModeActive,
      onIntercept: (interceptEvent) => {
        interceptedEvents.push(interceptEvent)
      },
    })

    const {editor, locator} = await createTestEditor({
      initialValue: helloWorldValue(),
    })

    editor.registerBehavior({behavior})

    await locator.click()
    editor.send({
      type: 'select',
      at: {
        anchor: {path: [{_key: 'b1'}, 'children', {_key: 's1'}], offset: 5},
        focus: {path: [{_key: 'b1'}, 'children', {_key: 's1'}], offset: 5},
      },
    })

    // Enable via legacy flag
    suggestModeActive = true

    editor.send({type: 'insert.text', text: 'X'})

    expect(interceptedEvents).toHaveLength(1)
    expect(interceptedEvents[0]!.event.type).toBe('insert.text')

    // Base document unchanged
    await vi.waitFor(() => {
      expect(locator).toHaveTextContent('Hello world')
    })
  })

  test('existing readOnly behavior is unchanged', async () => {
    const {editor, locator} = await createTestEditor({
      initialValue: helloWorldValue(),
    })

    // Set readOnly
    editor.send({type: 'update readOnly', readOnly: true})
    await vi.waitFor(() => {
      expect(editor.getSnapshot().context.readOnly).toBe(true)
    })

    // Unset readOnly
    editor.send({type: 'update readOnly', readOnly: false})
    await vi.waitFor(() => {
      expect(editor.getSnapshot().context.readOnly).toBe(false)
    })

    // Edit normally
    await locator.click()
    editor.send({
      type: 'select',
      at: {
        anchor: {path: [{_key: 'b1'}, 'children', {_key: 's1'}], offset: 5},
        focus: {path: [{_key: 'b1'}, 'children', {_key: 's1'}], offset: 5},
      },
    })
    editor.send({type: 'insert.text', text: 'X'})

    await vi.waitFor(() => {
      expect(locator).toHaveTextContent('HelloX world')
    })
  })
})

// ---------------------------------------------------------------------------
// Tests: Emitted events
// ---------------------------------------------------------------------------

describe('Suggesting state: emitted events', () => {
  test('emits "suggesting" event when entering suggesting mode', async () => {
    const {editor} = await createStateMachineSuggestEditor()
    const events: string[] = []

    editor.on('suggesting', () => {
      events.push('suggesting')
    })

    editor.send({type: 'update suggestMode', suggesting: true})

    await vi.waitFor(() => {
      expect(events).toContain('suggesting')
    })
  })

  test('emits "editable" event when leaving suggesting mode', async () => {
    const {editor} = await createStateMachineSuggestEditor()
    const events: string[] = []

    editor.on('editable', () => {
      events.push('editable')
    })

    // Enter suggesting
    editor.send({type: 'update suggestMode', suggesting: true})
    await vi.waitFor(() => {
      expect(editor.getSnapshot().context.suggesting).toBe(true)
    })

    // Leave suggesting
    editor.send({type: 'update suggestMode', suggesting: false})

    await vi.waitFor(() => {
      expect(events).toContain('editable')
    })
  })

  test('emits "read only" event when readOnly overrides suggesting', async () => {
    const {editor} = await createStateMachineSuggestEditor()
    const events: string[] = []

    editor.on('read only', () => {
      events.push('read only')
    })

    // Enter suggesting
    editor.send({type: 'update suggestMode', suggesting: true})
    await vi.waitFor(() => {
      expect(editor.getSnapshot().context.suggesting).toBe(true)
    })

    // Override with readOnly
    editor.send({type: 'update readOnly', readOnly: true})

    await vi.waitFor(() => {
      expect(events).toContain('read only')
    })
  })
})
