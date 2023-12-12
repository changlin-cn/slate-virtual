import React, { useEffect, useRef, useMemo, useCallback, useState } from 'react'
import {
  Editor,
  // Element,
  NodeEntry,
  Node,
  Range,
  Transforms,
  Path,
  BaseRange,
} from 'slate'
// import getDirection from 'direction'
// import { HistoryEditor } from 'slate-history'
import throttle from 'lodash/throttle'
import scrollIntoView from 'scroll-into-view-if-needed'

import useChildren from '../../hooks/use-children'
import Hotkeys from '../../utils/hotkeys'
import {
  IS_FIREFOX,
  IS_SAFARI,
  IS_EDGE_LEGACY,
  IS_CHROME_LEGACY,
} from '../../utils/environment'
import { ReactEditor } from '../..'
import { ReadOnlyContext } from '../../hooks/use-read-only'
import { useSlate } from '../../hooks/use-slate'
import { useIsomorphicLayoutEffect } from '../../hooks/use-isomorphic-layout-effect'
import { DecorateContext } from '../../hooks/use-decorate'
import {
  DOMElement,
  DOMNode,
  DOMRange,
  getDefaultView,
  isDOMElement,
  isDOMNode,
  isPlainTextOnlyPaste,
} from '../../utils/dom'

import {
  EDITOR_TO_ELEMENT,
  ELEMENT_TO_NODE,
  IS_READ_ONLY,
  NODE_TO_ELEMENT,
  IS_FOCUSED,
  PLACEHOLDER_SYMBOL,
  EDITOR_TO_WINDOW,
  EDITABLE_VIRTUAL_CURSOR_SET_FOCUSED,
} from '../../utils/weak-maps'
import {
  RenderElementProps,
  RenderLeafProps,
  RenderPlaceholderProps,
  DefaultPlaceholder,
  EditableProps,
} from '../editable'
import { CursorWithInput } from './cursor-with-input'
import { isEventHandled } from '../../utils/is-event-handled'

import { log } from '../../utils/log'

// COMPAT: Firefox/Edge Legacy don't support the `beforeinput` event
// Chrome Legacy doesn't support `beforeinput` correctly
const HAS_BEFORE_INPUT_SUPPORT =
  !IS_CHROME_LEGACY &&
  !IS_EDGE_LEGACY &&
  globalThis.InputEvent &&
  // @ts-ignore The `getTargetRanges` property isn't recognized.
  typeof globalThis.InputEvent.prototype.getTargetRanges === 'function'

/**
 * EditableVirtualCursor.
 */

export const EditableVirtualCursor = (props: EditableProps) => {
  const {
    autoFocus,
    decorate = defaultDecorate,
    onDOMBeforeInput: propsOnDOMBeforeInput,
    placeholder,
    readOnly = false,
    renderElement,
    renderLeaf,
    renderPlaceholder = props => <DefaultPlaceholder {...props} />,
    style = {},
    as: Component = 'div',
    ...attributes
  } = props
  const editor = useSlate()
  const ref = useRef<HTMLDivElement>(null)
  log(`EditableVirtualCursor render editor.selection:`, editor.selection)

  // Update internal state on each render.
  IS_READ_ONLY.set(editor, readOnly)

  // isFocusd
  const [isFocused, setFocusedState] = useState<boolean>(() => {
    IS_FOCUSED.set(editor, !!autoFocus)
    return !!autoFocus
  })

  const setFocused = useCallback(
    (b: boolean) => {
      IS_FOCUSED.set(editor, b)
      setFocusedState(b)
    },
    [setFocusedState, editor]
  )

  EDITABLE_VIRTUAL_CURSOR_SET_FOCUSED.set(editor, setFocused)

  // Keep track of some state for the event handler logic.
  const state = useMemo(
    () => ({
      isComposing: false,
      isUpdatingSelection: false,
      latestElement: null as DOMElement | null,
      isDragging: false,
    }),
    []
  )

  // Update element-related weak maps with the DOM element ref.
  useIsomorphicLayoutEffect(() => {
    let window
    if (ref.current && (window = getDefaultView(ref.current))) {
      EDITOR_TO_WINDOW.set(editor, window)
      EDITOR_TO_ELEMENT.set(editor, ref.current)
      NODE_TO_ELEMENT.set(editor, ref.current)
      ELEMENT_TO_NODE.set(ref.current, editor)
    } else {
      NODE_TO_ELEMENT.delete(editor)
    }
  })

  // Listen on the native `selectionchange` event to be able to update any time
  // the selection changes. This is required because React's `onSelect` is leaky
  // and non-standard so it doesn't fire until after a selection has been
  // released. This causes issues in situations where another change happens
  // while a selection is being dragged.
  const onDOMSelectionChange = useCallback(
    throttle(() => {
      if (1) {
        const root = ReactEditor.findDocumentOrShadowRoot(editor)
        const { activeElement } = root

        const domSelection = root.getSelection()

        // if (activeElement === el) {
        //   state.latestElement = activeElement
        //   IS_FOCUSED.set(editor, true)
        // } else {
        //   IS_FOCUSED.delete(editor)
        // }

        if (!domSelection) {
          setFocused(false)
          return
        }

        if (
          hasTarget(editor, activeElement) &&
          activeElement.tagName.toLowerCase() === 'input' &&
          activeElement.hasAttribute('data-slate-virtual-cursor-input')
        ) {
          setFocused(true)
          return
        }

        const { anchorNode, focusNode } = domSelection

        const anchorNodeSelectable =
          hasEditableTarget(editor, anchorNode) ||
          isTargetInsideVoid(editor, anchorNode)

        const focusNodeSelectable =
          hasEditableTarget(editor, focusNode) ||
          isTargetInsideVoid(editor, focusNode)

        if (anchorNodeSelectable && focusNodeSelectable) {
          const range = ReactEditor.toSlateRange(editor, domSelection, {
            exactMatch: false,
          })
          Transforms.select(editor, range)
          log(
            `EditableVirtualCursor onDOMSelectionChange Transforms.select(editor, range),range`,
            range
          )
          setFocused(true)
        } else {
          log(
            `EditableVirtualCursor onDOMSelectionChange Transforms.deselect(editor)`
          )
          // Transforms.deselect(editor)
          setFocused(false)
        }
      }
    }, 100),
    [readOnly]
  )

  // Attach a native DOM event handler for `selectionchange`, because React's
  // built-in `onSelect` handler doesn't fire for all selection changes. It's a
  // leaky polyfill that only fires on keypresses or clicks. Instead, we want to
  // fire for any change to the selection inside the editor. (2019/11/04)
  // https://github.com/facebook/react/issues/5785
  useIsomorphicLayoutEffect(() => {
    const window = ReactEditor.getWindow(editor)
    window.document.addEventListener('selectionchange', onDOMSelectionChange)

    return () => {
      window.document.removeEventListener(
        'selectionchange',
        onDOMSelectionChange
      )
    }
  }, [onDOMSelectionChange])

  useIsomorphicLayoutEffect(() => {
    if (autoFocus) {
      Transforms.select(editor, {
        anchor: { path: [0, 0], offset: 0 },
        focus: { path: [0, 0], offset: 0 },
      })
    }
  }, [])

  const decorations = decorate([editor, []])

  if (
    placeholder &&
    editor.children.length === 1 &&
    Array.from(Node.texts(editor)).length === 1 &&
    Node.string(editor) === ''
  ) {
    const start = Editor.start(editor, [])
    decorations.push({
      [PLACEHOLDER_SYMBOL]: true,
      placeholder,
      anchor: start,
      focus: start,
    })
  }

  return (
    <ReadOnlyContext.Provider value={readOnly}>
      <DecorateContext.Provider value={decorate}>
        <div
          style={{ display: 'flex', position: 'relative' }}
          ref={ref}
          data-slate-editor
          data-slate-node="value"
        >
          <Component
            // COMPAT: The Grammarly Chrome extension works by changing the DOM
            // out from under `contenteditable` elements, which leads to weird
            // behaviors so we have to disable it like editor. (2017/04/24)
            data-gramm={false}
            role={readOnly ? undefined : 'textbox'}
            {...attributes}
            // COMPAT: Certain browsers don't support the `beforeinput` event, so we'd
            // have to use hacks to make these replacement-based features work.
            spellCheck={
              !HAS_BEFORE_INPUT_SUPPORT ? false : attributes.spellCheck
            }
            autoCorrect={
              !HAS_BEFORE_INPUT_SUPPORT ? false : attributes.autoCorrect
            }
            autoCapitalize={
              !HAS_BEFORE_INPUT_SUPPORT ? false : attributes.autoCapitalize
            }
            style={{
              // Allow positioning relative to the editable element.
              position: 'relative',
              // Prevent the default outline styles.
              outline: 'none',
              // Preserve adjacent whitespace and new lines.
              whiteSpace: 'pre-wrap',
              // Allow words to break if they are too long.
              wordWrap: 'break-word',
              flex: 'auto',
              // Allow for passed-in styles to override anything.
              ...style,
            }}
            onClick={useCallback(
              (event: React.MouseEvent<HTMLDivElement>) => {
                if (
                  !readOnly &&
                  hasTarget(editor, event.target) &&
                  !isEventHandled(event, attributes.onClick) &&
                  isDOMNode(event.target)
                ) {
                  const node = ReactEditor.toSlateNode(editor, event.target)
                  const path = ReactEditor.findPath(editor, node)
                  const start = Editor.start(editor, path)
                  const end = Editor.end(editor, path)

                  const startVoid = Editor.void(editor, { at: start })
                  const endVoid = Editor.void(editor, { at: end })

                  let range: BaseRange
                  if (
                    startVoid &&
                    endVoid &&
                    Path.equals(startVoid[1], endVoid[1])
                  ) {
                    range = Editor.range(editor, start)
                  } else {
                    // range = ReactEditor.findEventRange(editor, event)
                  }
                  if (range) {
                    log(
                      `EditableVirtualCursor onClick : Transforms.select(editor,range),range:`,
                      range
                    )

                    Transforms.select(editor, range)
                  }
                }
              },
              [readOnly, attributes.onClick]
            )}
            onDragOver={useCallback(
              (event: React.DragEvent<HTMLDivElement>) => {
                if (
                  hasTarget(editor, event.target) &&
                  !isEventHandled(event, attributes.onDragOver)
                ) {
                  event.preventDefault()
                }
              },
              [attributes.onDragOver]
            )}
            onDragStart={useCallback(
              (event: React.DragEvent<HTMLDivElement>) => {
                state.isDragging = true
                if (
                  hasTarget(editor, event.target) &&
                  !isEventHandled(event, attributes.onDragStart)
                ) {
                  const node = ReactEditor.toSlateNode(editor, event.target)
                  const path = ReactEditor.findPath(editor, node)
                  const voidMatch = Editor.void(editor, { at: path })

                  // If starting a drag on a void node, make sure it is selected
                  // so that it shows up in the selection's fragment.
                  if (voidMatch) {
                    const range = Editor.range(editor, path)
                    Transforms.select(editor, range)
                  }

                  ReactEditor.setFragmentData(editor, event.dataTransfer)
                }
              },
              [attributes.onDragStart]
            )}
            onDrop={useCallback(
              (event: React.DragEvent<HTMLDivElement>) => {
                // debugger
                if (
                  hasTarget(editor, event.target) &&
                  !readOnly &&
                  !isEventHandled(event, attributes.onDrop)
                ) {
                  event.preventDefault()

                  const range = ReactEditor.findEventRange(editor, event)
                  if (
                    state.isDragging &&
                    editor.selection &&
                    Range.includes(editor.selection, range)
                  ) {
                    return
                  }

                  Editor.deleteFragment(editor)

                  const data = event.dataTransfer
                  Transforms.select(editor, range)
                  ReactEditor.insertData(editor, data)
                }
              },
              [readOnly, attributes.onDrop]
            )}
            onDragEnd={useCallback(() => {
              state.isDragging = false
            }, [])}
          >
            {useChildren({
              decorations,
              node: editor,
              renderElement,
              renderPlaceholder,
              renderLeaf,
              selection: editor.selection,
            })}
          </Component>
          <CursorWithInput isEditorFocused={isFocused} />
        </div>
      </DecorateContext.Provider>
    </ReadOnlyContext.Provider>
  )
}

/**
 * A default memoized decorate function.
 */

const defaultDecorate: (entry: NodeEntry) => Range[] = () => []

/**
 * Check if two DOM range objects are equal.
 */

const isRangeEqual = (a: DOMRange, b: DOMRange) => {
  return (
    (a.startContainer === b.startContainer &&
      a.startOffset === b.startOffset &&
      a.endContainer === b.endContainer &&
      a.endOffset === b.endOffset) ||
    (a.startContainer === b.endContainer &&
      a.startOffset === b.endOffset &&
      a.endContainer === b.startContainer &&
      a.endOffset === b.startOffset)
  )
}

/**
 * Check if the target is in the editor.
 */

const hasTarget = (
  editor: ReactEditor,
  target: EventTarget | null
): target is DOMNode => {
  return isDOMNode(target) && ReactEditor.hasDOMNode(editor, target)
}

/**
 * Check if the target is editable and in the editor.
 */

const hasEditableTarget = (
  editor: ReactEditor,
  target: EventTarget | null
): target is DOMNode => {
  return (
    isDOMNode(target) &&
    ReactEditor.hasDOMNode(editor, target, { editable: true })
  )
}

/**
 * Check if the target is inside void and in the editor.
 */

const isTargetInsideVoid = (
  editor: ReactEditor,
  target: EventTarget | null
): boolean => {
  const slateNode =
    hasTarget(editor, target) && ReactEditor.toSlateNode(editor, target)
  return Editor.isVoid(editor, slateNode)
}
