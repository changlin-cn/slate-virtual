import React, { useEffect, useRef, useMemo, useCallback } from 'react'
import {
  Editor,
  // Element,
  NodeEntry,
  Node,
  Range,
  Transforms,
  Path,
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
} from '../../utils/weak-maps'
import {
  RenderElementProps,
  RenderLeafProps,
  RenderPlaceholderProps,
  DefaultPlaceholder,
  EditableProps,
} from '../editable'

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

  // Update internal state on each render.
  IS_READ_ONLY.set(editor, readOnly)

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

  // Whenever the editor updates, make sure the DOM selection state is in sync.
  useIsomorphicLayoutEffect(() => {
    const { selection } = editor
    const root = ReactEditor.findDocumentOrShadowRoot(editor)
    const domSelection = root.getSelection()

    if (state.isComposing || !domSelection || !ReactEditor.isFocused(editor)) {
      return
    }

    const hasDomSelection = domSelection.type !== 'None'

    // If the DOM selection is properly unset, we're done.
    if (!selection && !hasDomSelection) {
      return
    }

    // verify that the dom selection is in the editor
    const editorElement = EDITOR_TO_ELEMENT.get(editor)!
    let hasDomSelectionInEditor = false
    if (
      editorElement.contains(domSelection.anchorNode) &&
      editorElement.contains(domSelection.focusNode)
    ) {
      hasDomSelectionInEditor = true
    }

    // If the DOM selection is in the editor and the editor selection is already correct, we're done.
    if (hasDomSelection && hasDomSelectionInEditor && selection) {
      const slateRange = ReactEditor.toSlateRange(editor, domSelection, {
        exactMatch: true,
      })
      if (slateRange && Range.equals(slateRange, selection)) {
        return
      }
    }

    // when <Editable/> is being controlled through external value
    // then its children might just change - DOM responds to it on its own
    // but Slate's value is not being updated through any operation
    // and thus it doesn't transform selection on its own
    if (selection && !ReactEditor.hasRange(editor, selection)) {
      editor.selection = ReactEditor.toSlateRange(editor, domSelection, {
        exactMatch: false,
      })
      return
    }

    // Otherwise the DOM selection is out of sync, so update it.
    const el = ReactEditor.toDOMNode(editor, editor)
    state.isUpdatingSelection = true

    const newDomRange = selection && ReactEditor.toDOMRange(editor, selection)

    if (newDomRange) {
      if (Range.isBackward(selection!)) {
        domSelection.setBaseAndExtent(
          newDomRange.endContainer,
          newDomRange.endOffset,
          newDomRange.startContainer,
          newDomRange.startOffset
        )
      } else {
        domSelection.setBaseAndExtent(
          newDomRange.startContainer,
          newDomRange.startOffset,
          newDomRange.endContainer,
          newDomRange.endOffset
        )
      }
      const leafEl = newDomRange.startContainer.parentElement!
      leafEl.getBoundingClientRect = newDomRange.getBoundingClientRect.bind(
        newDomRange
      )
      scrollIntoView(leafEl, {
        scrollMode: 'if-needed',
        boundary: el,
      })
      // @ts-ignore
      delete leafEl.getBoundingClientRect
    } else {
      domSelection.removeAllRanges()
    }

    setTimeout(() => {
      // COMPAT: In Firefox, it's not enough to create a range, you also need
      // to focus the contenteditable element too. (2016/11/16)
      if (newDomRange && IS_FIREFOX) {
        el.focus()
      }

      state.isUpdatingSelection = false
    })
  })

  // The autoFocus TextareaHTMLAttribute doesn't do anything on a div, so it
  // needs to be manually focused.
  useEffect(() => {
    if (ref.current && autoFocus) {
      ref.current.focus()
    }
  }, [autoFocus])

  // Listen on the native `beforeinput` event to get real "Level 2" events. This
  // is required because React's `beforeinput` is fake and never really attaches
  // to the real event sadly. (2019/11/01)
  // https://github.com/facebook/react/issues/11211
  const onDOMBeforeInput = useCallback(
    (event: InputEvent) => {
      if (
        !readOnly &&
        hasEditableTarget(editor, event.target) &&
        !isDOMEventHandled(event, propsOnDOMBeforeInput)
      ) {
        const { selection } = editor
        const { inputType: type } = event
        const data = (event as any).dataTransfer || event.data || undefined

        // These two types occur while a user is composing text and can't be
        // cancelled. Let them through and wait for the composition to end.
        if (
          type === 'insertCompositionText' ||
          type === 'deleteCompositionText'
        ) {
          return
        }

        event.preventDefault()

        // COMPAT: For the deleting forward/backward input types we don't want
        // to change the selection because it is the range that will be deleted,
        // and those commands determine that for themselves.
        if (!type.startsWith('delete') || type.startsWith('deleteBy')) {
          const [targetRange] = (event as any).getTargetRanges()

          if (targetRange) {
            const range = ReactEditor.toSlateRange(editor, targetRange, {
              exactMatch: false,
            })

            if (!selection || !Range.equals(selection, range)) {
              Transforms.select(editor, range)
            }
          }
        }

        // COMPAT: If the selection is expanded, even if the command seems like
        // a delete forward/backward command it should delete the selection.
        if (
          selection &&
          Range.isExpanded(selection) &&
          type.startsWith('delete')
        ) {
          const direction = type.endsWith('Backward') ? 'backward' : 'forward'
          Editor.deleteFragment(editor, { direction })
          return
        }

        switch (type) {
          case 'deleteByComposition':
          case 'deleteByCut':
          case 'deleteByDrag': {
            Editor.deleteFragment(editor)
            break
          }

          case 'deleteContent':
          case 'deleteContentForward': {
            Editor.deleteForward(editor)
            break
          }

          case 'deleteContentBackward': {
            Editor.deleteBackward(editor)
            break
          }

          case 'deleteEntireSoftLine': {
            Editor.deleteBackward(editor, { unit: 'line' })
            Editor.deleteForward(editor, { unit: 'line' })
            break
          }

          case 'deleteHardLineBackward': {
            Editor.deleteBackward(editor, { unit: 'block' })
            break
          }

          case 'deleteSoftLineBackward': {
            Editor.deleteBackward(editor, { unit: 'line' })
            break
          }

          case 'deleteHardLineForward': {
            Editor.deleteForward(editor, { unit: 'block' })
            break
          }

          case 'deleteSoftLineForward': {
            Editor.deleteForward(editor, { unit: 'line' })
            break
          }

          case 'deleteWordBackward': {
            Editor.deleteBackward(editor, { unit: 'word' })
            break
          }

          case 'deleteWordForward': {
            Editor.deleteForward(editor, { unit: 'word' })
            break
          }

          case 'insertLineBreak':
          case 'insertParagraph': {
            Editor.insertBreak(editor)
            break
          }

          case 'insertFromComposition':
          case 'insertFromDrop':
          case 'insertFromPaste':
          case 'insertFromYank':
          case 'insertReplacementText':
          case 'insertText': {
            if (type === 'insertFromComposition') {
              // COMPAT: in Safari, `compositionend` is dispatched after the
              // `beforeinput` for "insertFromComposition". But if we wait for it
              // then we will abort because we're still composing and the selection
              // won't be updated properly.
              // https://www.w3.org/TR/input-events-2/
              state.isComposing = false
            }

            const window = ReactEditor.getWindow(editor)
            if (data instanceof window.DataTransfer) {
              ReactEditor.insertData(editor, data as DataTransfer)
            } else if (typeof data === 'string') {
              Editor.insertText(editor, data)
            }

            break
          }
        }
      }
    },
    [readOnly, propsOnDOMBeforeInput]
  )

  // Attach a native DOM event handler for `beforeinput` events, because React's
  // built-in `onBeforeInput` is actually a leaky polyfill that doesn't expose
  // real `beforeinput` events sadly... (2019/11/04)
  // https://github.com/facebook/react/issues/11211
  useIsomorphicLayoutEffect(() => {
    if (ref.current && HAS_BEFORE_INPUT_SUPPORT) {
      // @ts-ignore The `beforeinput` event isn't recognized.
      ref.current.addEventListener('beforeinput', onDOMBeforeInput)
    }

    return () => {
      if (ref.current && HAS_BEFORE_INPUT_SUPPORT) {
        // @ts-ignore The `beforeinput` event isn't recognized.
        ref.current.removeEventListener('beforeinput', onDOMBeforeInput)
      }
    }
  }, [onDOMBeforeInput])

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
        const el = ReactEditor.toDOMNode(editor, editor)
        const domSelection = root.getSelection()

        // if (activeElement === el) {
        //   state.latestElement = activeElement
        //   IS_FOCUSED.set(editor, true)
        // } else {
        //   IS_FOCUSED.delete(editor)
        // }

        if (!domSelection) {
          return Transforms.deselect(editor)
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
        } else {
          Transforms.deselect(editor)
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
        <Component
          // COMPAT: The Grammarly Chrome extension works by changing the DOM
          // out from under `contenteditable` elements, which leads to weird
          // behaviors so we have to disable it like editor. (2017/04/24)
          data-gramm={false}
          role={readOnly ? undefined : 'textbox'}
          {...attributes}
          // COMPAT: Certain browsers don't support the `beforeinput` event, so we'd
          // have to use hacks to make these replacement-based features work.
          spellCheck={!HAS_BEFORE_INPUT_SUPPORT ? false : attributes.spellCheck}
          autoCorrect={
            !HAS_BEFORE_INPUT_SUPPORT ? false : attributes.autoCorrect
          }
          autoCapitalize={
            !HAS_BEFORE_INPUT_SUPPORT ? false : attributes.autoCapitalize
          }
          data-slate-editor
          data-slate-node="value"
          ref={ref}
          style={{
            // Allow positioning relative to the editable element.
            position: 'relative',
            // Prevent the default outline styles.
            outline: 'none',
            // Preserve adjacent whitespace and new lines.
            whiteSpace: 'pre-wrap',
            // Allow words to break if they are too long.
            wordWrap: 'break-word',
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

                if (
                  startVoid &&
                  endVoid &&
                  Path.equals(startVoid[1], endVoid[1])
                ) {
                  const range = Editor.range(editor, start)
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

/**
 * Check if an event is overrided by a handler.
 */

const isEventHandled = <
  EventType extends React.SyntheticEvent<unknown, unknown>
>(
  event: EventType,
  handler?: (event: EventType) => void
) => {
  if (!handler) {
    return false
  }

  handler(event)
  return event.isDefaultPrevented() || event.isPropagationStopped()
}

/**
 * Check if a DOM event is overrided by a handler.
 */

const isDOMEventHandled = <E extends Event>(
  event: E,
  handler?: (event: E) => void
) => {
  if (!handler) {
    return false
  }

  handler(event)
  return event.defaultPrevented
}
