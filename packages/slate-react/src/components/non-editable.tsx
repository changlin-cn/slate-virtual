import getDirection from 'direction'
import debounce from 'lodash/debounce'
import throttle from 'lodash/throttle'
import React, {
  useCallback,
  useEffect,
  useMemo,
  useReducer,
  useRef,
  useState,
  forwardRef,
  ForwardedRef,
} from 'react'
import { JSX } from 'react'
import scrollIntoView from 'scroll-into-view-if-needed'
import {
  Editor,
  Element,
  Node,
  NodeEntry,
  Path,
  Range,
  Text,
  Transforms,
  DecoratedRange,
  LeafPosition,
} from 'slate'
import useChildren from '../hooks/use-children'
import { DecorateContext, useDecorateContext } from '../hooks/use-decorations'
import { useIsomorphicLayoutEffect } from '../hooks/use-isomorphic-layout-effect'
import { ReadOnlyContext } from '../hooks/use-read-only'
import { useSlate } from '../hooks/use-slate'
import { useTrackUserInput } from '../hooks/use-track-user-input'
import { ReactEditor } from '../plugin/react-editor'
import { TRIPLE_CLICK } from 'slate-dom'
import {
  DOMElement,
  DOMRange,
  getActiveElement,
  getDefaultView,
  getSelection,
  isDOMElement,
  isDOMNode,
} from 'slate-dom'
import {
  CAN_USE_DOM,
  HAS_BEFORE_INPUT_SUPPORT,
  IS_ANDROID,
  IS_FIREFOX,
  IS_WEBKIT,
} from 'slate-dom'
import {
  IS_NODE_MAP_DIRTY,
  EDITOR_TO_ELEMENT,
  EDITOR_TO_FORCE_RENDER,
  EDITOR_TO_PENDING_INSERTION_MARKS,
  EDITOR_TO_WINDOW,
  ELEMENT_TO_NODE,
  IS_FOCUSED,
  IS_READ_ONLY,
  MARK_PLACEHOLDER_SYMBOL,
  NODE_TO_ELEMENT,
  PLACEHOLDER_SYMBOL,
} from 'slate-dom'
import { RestoreDOM } from './restore-dom/restore-dom'
import { ComposingContext } from '../hooks/use-composing'
import { useFlushDeferredSelectorsOnRender } from '../hooks/use-slate-selector'
import { IFrame } from './iframe'
import { VirtualInput } from './virtual-input'

type DeferredOperation = () => void

const Children = (props: Parameters<typeof useChildren>[0]) => (
  <React.Fragment>{useChildren(props)}</React.Fragment>
)

/**
 * `RenderElementProps` are passed to the `renderElement` handler.
 */

export interface RenderElementProps {
  children: any
  element: Element
  attributes: {
    'data-slate-node': 'element'
    'data-slate-inline'?: true
    'data-slate-void'?: true
    dir?: 'rtl'
    ref: any
  }
}

/**
 * `RenderChunkProps` are passed to the `renderChunk` handler
 */
export interface RenderChunkProps {
  highest: boolean
  lowest: boolean
  children: any
  attributes: {
    'data-slate-chunk': true
  }
}

/**
 * `RenderLeafProps` are passed to the `renderLeaf` handler.
 */

export interface RenderLeafProps {
  children: any
  /**
   * The leaf node with any applied decorations.
   * If no decorations are applied, it will be identical to the `text` property.
   */
  leaf: Text
  text: Text
  attributes: {
    'data-slate-leaf': true
  }
  /**
   * The position of the leaf within the Text node, only present when the text node is split by decorations.
   */
  leafPosition?: LeafPosition
}

/**
 * `RenderTextProps` are passed to the `renderText` handler.
 */
export interface RenderTextProps {
  text: Text
  children: any
  attributes: {
    'data-slate-node': 'text'
    ref: any
  }
}

/**
 * `EditableProps` are passed to the `<Editable>` component.
 */

export type NonEditableProps = {
  decorate?: (entry: NodeEntry) => DecoratedRange[]
  onDOMBeforeInput?: (event: InputEvent) => void
  placeholder?: string
  readOnly?: boolean
  role?: string
  style?: React.CSSProperties
  renderElement?: (props: RenderElementProps) => JSX.Element
  renderChunk?: (props: RenderChunkProps) => JSX.Element
  renderLeaf?: (props: RenderLeafProps) => JSX.Element
  renderText?: (props: RenderTextProps) => JSX.Element
  renderPlaceholder?: (props: RenderPlaceholderProps) => JSX.Element
  scrollSelectionIntoView?: (editor: ReactEditor, domRange: DOMRange) => void
  as?: React.ElementType
  disableDefaultStyles?: boolean
} & React.TextareaHTMLAttributes<HTMLDivElement>

/**
 * Editable.
 */

export const NonEditableInner = forwardRef(
  (props: NonEditableProps, forwardedRef: ForwardedRef<HTMLDivElement>) => {
    const defaultRenderPlaceholder = useCallback(
      (props: RenderPlaceholderProps) => <DefaultPlaceholder {...props} />,
      []
    )
    const {
      autoFocus,
      decorate = defaultDecorate,
      onDOMBeforeInput: propsOnDOMBeforeInput,
      placeholder,
      readOnly = false,
      renderElement,
      renderChunk,
      renderLeaf,
      renderText,
      renderPlaceholder = defaultRenderPlaceholder,
      scrollSelectionIntoView = defaultScrollSelectionIntoView,
      style: userStyle = {},
      as: Component = 'div',
      disableDefaultStyles = false,
      ...attributes
    } = props
    const editor = useSlate()
    // Rerender editor when composition status changed
    const [isComposing, setIsComposing] = useState(false)
    const ref = useRef<HTMLDivElement | null>(null)
    const deferredOperations = useRef<DeferredOperation[]>([])
    const [placeholderHeight, setPlaceholderHeight] = useState<
      number | undefined
    >()
    const processing = useRef(false)

    const { onUserInput, receivedUserInput } = useTrackUserInput()

    const [, forceRender] = useReducer(s => s + 1, 0)
    EDITOR_TO_FORCE_RENDER.set(editor, forceRender)

    // Update internal state on each render.
    IS_READ_ONLY.set(editor, readOnly)

    // Keep track of some state for the event handler logic.
    const state = useMemo(
      () => ({
        isDraggingInternally: false,
        isUpdatingSelection: false,
        latestElement: null as DOMElement | null,
        hasMarkPlaceholder: false,
      }),
      []
    )

    // The autoFocus TextareaHTMLAttribute doesn't do anything on a div, so it
    // needs to be manually focused.
    //
    // If this stops working in Firefox, make sure nothing is causing this
    // component to re-render during the initial mount. If the DOM selection is
    // set by `useIsomorphicLayoutEffect` before `onDOMSelectionChange` updates
    // `editor.selection`, the DOM selection can be removed accidentally.
    useEffect(() => {
      if (ref.current && autoFocus) {
        ref.current.focus()
      }
    }, [autoFocus])

    // Listen on the native `selectionchange` event to be able to update any time
    // the selection changes. This is required because React's `onSelect` is leaky
    // and non-standard so it doesn't fire until after a selection has been
    // released. This causes issues in situations where another change happens
    // while a selection is being dragged.
    const onDOMSelectionChange = useMemo(
      () =>
        throttle(() => {
          // debugger
          if (IS_NODE_MAP_DIRTY.get(editor)) {
            onDOMSelectionChange()
            return
          }

          const el = ReactEditor.toDOMNode(editor, editor)
          const root = el.getRootNode()

          if (!processing.current && IS_WEBKIT && root instanceof ShadowRoot) {
            processing.current = true

            const active = getActiveElement()

            if (active) {
              document.execCommand('indent')
            } else {
              Transforms.deselect(editor)
            }

            processing.current = false
            return
          }

          if (
            (IS_ANDROID || !ReactEditor.isComposing(editor)) &&
            !state.isUpdatingSelection &&
            !state.isDraggingInternally
          ) {
            const root = ReactEditor.findDocumentOrShadowRoot(editor)
            const { activeElement } = root
            const el = ReactEditor.toDOMNode(editor, editor)
            const domSelection = getSelection(root)

            if (activeElement === el) {
              state.latestElement = activeElement
            }

            if (!domSelection) {
              return Transforms.deselect(editor)
            }

            const { anchorNode, focusNode } = domSelection

            const anchorNodeSelectable =
              anchorNode && ReactEditor.hasDOMNode(editor, anchorNode)

            const focusNodeInEditor =
              focusNode && ReactEditor.hasTarget(editor, focusNode)

            if (anchorNodeSelectable && focusNodeInEditor) {
              const range = ReactEditor.toSlateRange(editor, domSelection, {
                exactMatch: false,
                suppressThrow: true,
              })

              if (range) {
                if (!ReactEditor.isComposing(editor)) {
                  Transforms.select(editor, range)
                }
              }
            }

            // Deselect the editor if the dom selection is not selectable in readonly mode
            if (readOnly && (!anchorNodeSelectable || !focusNodeInEditor)) {
              Transforms.deselect(editor)
            }
          }
        }, 100),
      [editor, readOnly, state]
    )

    const scheduleOnDOMSelectionChange = useMemo(
      () => debounce(onDOMSelectionChange, 0),
      [onDOMSelectionChange]
    )

    useIsomorphicLayoutEffect(() => {
      // Update element-related weak maps with the DOM element ref.
      let window
      if (ref.current && (window = getDefaultView(ref.current))) {
        EDITOR_TO_WINDOW.set(editor, window)
        EDITOR_TO_ELEMENT.set(editor, ref.current)
        NODE_TO_ELEMENT.set(editor, ref.current)
        ELEMENT_TO_NODE.set(ref.current, editor)
      } else {
        NODE_TO_ELEMENT.delete(editor)
      }

      // Make sure the DOM selection state is in sync.
      const { selection } = editor
      const root = ReactEditor.findDocumentOrShadowRoot(editor)
      const domSelection = getSelection(root)

      if (!domSelection) {
        return
      }
      // debugger
      const setDomSelection = (forceChange?: boolean) => {
        const hasDomSelection = domSelection.type !== 'None'

        // If the DOM selection is properly unset, we're done.
        if (!selection && !hasDomSelection) {
          return
        }

        // Get anchorNode and focusNode
        const focusNode = domSelection.focusNode
        let anchorNode

        // COMPAT: In firefox the normal selection way does not work
        // (https://github.com/ianstormtaylor/slate/pull/5486#issue-1820720223)
        if (IS_FIREFOX && domSelection.rangeCount > 1) {
          const firstRange = domSelection.getRangeAt(0)
          const lastRange = domSelection.getRangeAt(domSelection.rangeCount - 1)

          // Right to left
          if (firstRange.startContainer === focusNode) {
            anchorNode = lastRange.endContainer
          } else {
            // Left to right
            anchorNode = firstRange.startContainer
          }
        } else {
          anchorNode = domSelection.anchorNode
        }

        // verify that the dom selection is in the editor
        const editorElement = EDITOR_TO_ELEMENT.get(editor)!
        let hasDomSelectionInEditor = false
        if (
          editorElement.contains(anchorNode) &&
          editorElement.contains(focusNode)
        ) {
          hasDomSelectionInEditor = true
        }

        // If the DOM selection is in the editor and the editor selection is already correct, we're done.
        if (
          hasDomSelection &&
          hasDomSelectionInEditor &&
          selection &&
          !forceChange
        ) {
          const slateRange = ReactEditor.toSlateRange(editor, domSelection, {
            exactMatch: true,

            // domSelection is not necessarily a valid Slate range
            // (e.g. when clicking on contentEditable:false element)
            suppressThrow: true,
          })

          if (slateRange && Range.equals(slateRange, selection)) {
            if (!state.hasMarkPlaceholder) {
              return
            }

            // Ensure selection is inside the mark placeholder
            if (
              anchorNode?.parentElement?.hasAttribute(
                'data-slate-mark-placeholder'
              )
            ) {
              return
            }
          }
        }

        // when <Editable/> is being controlled through external value
        // then its children might just change - DOM responds to it on its own
        // but Slate's value is not being updated through any operation
        // and thus it doesn't transform selection on its own
        if (selection && !ReactEditor.hasRange(editor, selection)) {
          editor.selection = ReactEditor.toSlateRange(editor, domSelection, {
            exactMatch: false,
            suppressThrow: true,
          })
          return
        }

        // Otherwise the DOM selection is out of sync, so update it.
        state.isUpdatingSelection = true

        let newDomRange: DOMRange | null = null

        try {
          newDomRange = selection && ReactEditor.toDOMRange(editor, selection)
        } catch (e) {
          // Ignore, dom and state might be out of sync
        }

        if (newDomRange) {
          if (ReactEditor.isComposing(editor) && !IS_ANDROID) {
            domSelection.collapseToEnd()
          } else if (Range.isBackward(selection!)) {
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
          scrollSelectionIntoView(editor, newDomRange)
        } else {
          domSelection.removeAllRanges()
        }

        return newDomRange
      }

      // In firefox if there is more then 1 range and we call setDomSelection we remove the ability to select more cells in a table
      if (domSelection.rangeCount <= 1) {
        setDomSelection()
      }

      setTimeout(() => {
        state.isUpdatingSelection = false
      })
      return
    })

    useIsomorphicLayoutEffect(() => {
      const window = ReactEditor.getWindow(editor)

      // COMPAT: In Chrome, `selectionchange` events can fire when <input> and
      // <textarea> elements are appended to the DOM, causing
      // `editor.selection` to be overwritten in some circumstances.
      // (2025/01/16) https://issues.chromium.org/issues/389368412
      const onSelectionChange = ({ target }: Event) => {
        // debugger
        const targetElement = target instanceof HTMLElement ? target : null
        const targetTagName = targetElement?.tagName
        if (targetTagName === 'INPUT' || targetTagName === 'TEXTAREA') {
          return
        }
        scheduleOnDOMSelectionChange()
      }

      // Attach a native DOM event handler for `selectionchange`, because React's
      // built-in `onSelect` handler doesn't fire for all selection changes. It's
      // a leaky polyfill that only fires on keypresses or clicks. Instead, we
      // want to fire for any change to the selection inside the editor.
      // (2019/11/04) https://github.com/facebook/react/issues/5785
      window.document.addEventListener('selectionchange', onSelectionChange)

      // Listen for dragend and drop globally. In Firefox, if a drop handler
      // initiates an operation that causes the originally dragged element to
      // unmount, that element will not emit a dragend event. (2024/06/21)
      const stoppedDragging = () => {
        state.isDraggingInternally = false
      }
      window.document.addEventListener('dragend', stoppedDragging)
      window.document.addEventListener('drop', stoppedDragging)

      return () => {
        window.document.removeEventListener(
          'selectionchange',
          onSelectionChange
        )
        window.document.removeEventListener('dragend', stoppedDragging)
        window.document.removeEventListener('drop', stoppedDragging)
      }
    }, [scheduleOnDOMSelectionChange, state])

    const decorations = decorate([editor, []])
    const decorateContext = useDecorateContext(decorate)

    const showPlaceholder =
      placeholder &&
      editor.children.length === 1 &&
      Array.from(Node.texts(editor)).length === 1 &&
      Node.string(editor) === '' &&
      !isComposing

    const placeHolderResizeHandler = useCallback(
      (placeholderEl: HTMLElement | null) => {
        if (placeholderEl && showPlaceholder) {
          setPlaceholderHeight(placeholderEl.getBoundingClientRect()?.height)
        } else {
          setPlaceholderHeight(undefined)
        }
      },
      [showPlaceholder]
    )

    if (showPlaceholder) {
      const start = Editor.start(editor, [])
      decorations.push({
        [PLACEHOLDER_SYMBOL]: true,
        placeholder,
        onPlaceholderResize: placeHolderResizeHandler,
        anchor: start,
        focus: start,
      })
    }

    const { marks } = editor
    state.hasMarkPlaceholder = false

    if (editor.selection && Range.isCollapsed(editor.selection) && marks) {
      const { anchor } = editor.selection
      const leaf = Node.leaf(editor, anchor.path)
      const { text, ...rest } = leaf

      // While marks isn't a 'complete' text, we can still use loose Text.equals
      // here which only compares marks anyway.
      if (!Text.equals(leaf, marks as Text, { loose: true })) {
        state.hasMarkPlaceholder = true

        const unset = Object.fromEntries(
          Object.keys(rest).map(mark => [mark, null])
        )

        decorations.push({
          [MARK_PLACEHOLDER_SYMBOL]: true,
          ...unset,
          ...marks,

          anchor,
          focus: anchor,
        })
      }
    }

    // Update EDITOR_TO_MARK_PLACEHOLDER_MARKS in setTimeout useEffect to ensure we don't set it
    // before we receive the composition end event.
    useEffect(() => {
      setTimeout(() => {
        const { selection } = editor
        if (selection) {
          const { anchor } = selection
          const text = Node.leaf(editor, anchor.path)

          // While marks isn't a 'complete' text, we can still use loose Text.equals
          // here which only compares marks anyway.
          if (marks && !Text.equals(text, marks as Text, { loose: true })) {
            EDITOR_TO_PENDING_INSERTION_MARKS.set(editor, marks)
            return
          }
        }

        EDITOR_TO_PENDING_INSERTION_MARKS.delete(editor)
      })
    })

    useFlushDeferredSelectorsOnRender()

    return (
      <ReadOnlyContext.Provider value={readOnly}>
        <ComposingContext.Provider value={isComposing}>
          <DecorateContext.Provider value={decorateContext}>
            <Component
              // tabIndex='0'
              role={readOnly ? undefined : 'textbox'}
              aria-multiline={readOnly ? undefined : true}
              {...attributes}
              // COMPAT: Certain browsers don't support the `beforeinput` event, so we'd
              // have to use hacks to make these replacement-based features work.
              // For SSR situations HAS_BEFORE_INPUT_SUPPORT is false and results in prop
              // mismatch warning app moves to browser. Pass-through consumer props when
              // not CAN_USE_DOM (SSR) and default to falsy value
              spellCheck={
                HAS_BEFORE_INPUT_SUPPORT || !CAN_USE_DOM
                  ? attributes.spellCheck
                  : false
              }
              autoCorrect={
                HAS_BEFORE_INPUT_SUPPORT || !CAN_USE_DOM
                  ? attributes.autoCorrect
                  : 'false'
              }
              autoCapitalize={
                HAS_BEFORE_INPUT_SUPPORT || !CAN_USE_DOM
                  ? attributes.autoCapitalize
                  : 'false'
              }
              data-slate-editor
              data-slate-node="value"
              // in some cases, a decoration needs access to the range / selection to decorate a text node,
              // then you will select the whole text node when you select part the of text
              // this magic zIndex="-1" will fix it
              zindex={-1}
              style={{
                ...(disableDefaultStyles
                  ? {}
                  : {
                      // Allow positioning relative to the editable element.
                      position: 'relative',
                      // Preserve adjacent whitespace and new lines.
                      whiteSpace: 'pre-wrap',
                      // Allow words to break if they are too long.
                      wordWrap: 'break-word',
                      // Make the minimum height that of the placeholder.
                      ...(placeholderHeight
                        ? { minHeight: placeholderHeight }
                        : {}),
                    }),
                // Allow for passed-in styles to override anything.
                ...userStyle,
              }}
              onBlur={useCallback(
                (event: React.FocusEvent<HTMLDivElement>) => {
                  if (
                    readOnly ||
                    state.isUpdatingSelection ||
                    !ReactEditor.hasSelectableTarget(editor, event.target) ||
                    isEventHandled(event, attributes.onBlur)
                  ) {
                    return
                  }

                  // COMPAT: If the current `activeElement` is still the previous
                  // one, this is due to the window being blurred when the tab
                  // itself becomes unfocused, so we want to abort early to allow to
                  // editor to stay focused when the tab becomes focused again.
                  const root = ReactEditor.findDocumentOrShadowRoot(editor)
                  if (state.latestElement === root.activeElement) {
                    return
                  }

                  const { relatedTarget } = event
                  const el = ReactEditor.toDOMNode(editor, editor)

                  // COMPAT: The event should be ignored if the focus is returning
                  // to the editor from an embedded editable element (eg. an <input>
                  // element inside a void node).
                  if (relatedTarget === el) {
                    return
                  }

                  // COMPAT: The event should be ignored if the focus is moving from
                  // the editor to inside a void node's spacer element.
                  if (
                    isDOMElement(relatedTarget) &&
                    relatedTarget.hasAttribute('data-slate-spacer')
                  ) {
                    return
                  }

                  // COMPAT: The event should be ignored if the focus is moving to a
                  // non- editable section of an element that isn't a void node (eg.
                  // a list item of the check list example).
                  if (
                    relatedTarget != null &&
                    isDOMNode(relatedTarget) &&
                    ReactEditor.hasDOMNode(editor, relatedTarget)
                  ) {
                    const node = ReactEditor.toSlateNode(editor, relatedTarget)

                    if (Element.isElement(node) && !editor.isVoid(node)) {
                      return
                    }
                  }

                  // COMPAT: Safari doesn't always remove the selection even if the content-
                  // editable element no longer has focus. Refer to:
                  // https://stackoverflow.com/questions/12353247/force-contenteditable-div-to-stop-accepting-input-after-it-loses-focus-under-web
                  if (IS_WEBKIT) {
                    const domSelection = getSelection(root)
                    domSelection?.removeAllRanges()
                  }
                },
                [
                  readOnly,
                  state.isUpdatingSelection,
                  state.latestElement,
                  editor,
                  attributes.onBlur,
                ]
              )}
              onClick={useCallback(
                (event: React.MouseEvent<HTMLDivElement>) => {
                  if (
                    ReactEditor.hasTarget(editor, event.target) &&
                    !isEventHandled(event, attributes.onClick) &&
                    isDOMNode(event.target)
                  ) {
                    const node = ReactEditor.toSlateNode(editor, event.target)
                    const path = ReactEditor.findPath(editor, node)

                    // At this time, the Slate document may be arbitrarily different,
                    // because onClick handlers can change the document before we get here.
                    // Therefore we must check that this path actually exists,
                    // and that it still refers to the same node.
                    if (
                      !Editor.hasPath(editor, path) ||
                      Node.get(editor, path) !== node
                    ) {
                      return
                    }

                    if (event.detail === TRIPLE_CLICK && path.length >= 1) {
                      let blockPath = path
                      if (
                        !(
                          Element.isElement(node) &&
                          Editor.isBlock(editor, node)
                        )
                      ) {
                        const block = Editor.above(editor, {
                          match: n =>
                            Element.isElement(n) && Editor.isBlock(editor, n),
                          at: path,
                        })

                        blockPath = block?.[1] ?? path.slice(0, 1)
                      }

                      const range = Editor.range(editor, blockPath)
                      Transforms.select(editor, range)
                      return
                    }

                    if (readOnly) {
                      return
                    }

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
                [editor, attributes.onClick, readOnly]
              )}
              onDragOver={useCallback(
                (event: React.DragEvent<HTMLDivElement>) => {
                  if (
                    ReactEditor.hasTarget(editor, event.target) &&
                    !isEventHandled(event, attributes.onDragOver)
                  ) {
                    // Only when the target is void, call `preventDefault` to signal
                    // that drops are allowed. Editable content is droppable by
                    // default, and calling `preventDefault` hides the cursor.
                    const node = ReactEditor.toSlateNode(editor, event.target)

                    if (
                      Element.isElement(node) &&
                      Editor.isVoid(editor, node)
                    ) {
                      event.preventDefault()
                    }
                  }
                },
                [attributes.onDragOver, editor]
              )}
              onDragStart={useCallback(
                (event: React.DragEvent<HTMLDivElement>) => {
                  if (
                    !readOnly &&
                    ReactEditor.hasTarget(editor, event.target) &&
                    !isEventHandled(event, attributes.onDragStart)
                  ) {
                    const node = ReactEditor.toSlateNode(editor, event.target)
                    const path = ReactEditor.findPath(editor, node)
                    const voidMatch =
                      (Element.isElement(node) &&
                        Editor.isVoid(editor, node)) ||
                      Editor.void(editor, { at: path, voids: true })

                    // If starting a drag on a void node, make sure it is selected
                    // so that it shows up in the selection's fragment.
                    if (voidMatch) {
                      const range = Editor.range(editor, path)
                      Transforms.select(editor, range)
                    }

                    state.isDraggingInternally = true

                    ReactEditor.setFragmentData(
                      editor,
                      event.dataTransfer,
                      'drag'
                    )
                  }
                },
                [readOnly, editor, attributes.onDragStart, state]
              )}
              onDrop={useCallback(
                (event: React.DragEvent<HTMLDivElement>) => {
                  if (
                    !readOnly &&
                    ReactEditor.hasTarget(editor, event.target) &&
                    !isEventHandled(event, attributes.onDrop)
                  ) {
                    event.preventDefault()

                    // Keep a reference to the dragged range before updating selection
                    const draggedRange = editor.selection

                    // Find the range where the drop happened
                    const range = ReactEditor.findEventRange(editor, event)
                    const data = event.dataTransfer

                    Transforms.select(editor, range)

                    if (state.isDraggingInternally) {
                      if (
                        draggedRange &&
                        !Range.equals(draggedRange, range) &&
                        !Editor.void(editor, { at: range, voids: true })
                      ) {
                        Transforms.delete(editor, {
                          at: draggedRange,
                        })
                      }
                    }

                    ReactEditor.insertData(editor, data)

                    // When dragging from another source into the editor, it's possible
                    // that the current editor does not have focus.
                    if (!ReactEditor.isFocused(editor)) {
                      ReactEditor.focus(editor)
                    }
                  }
                },
                [readOnly, editor, attributes.onDrop, state]
              )}
              onDragEnd={useCallback(
                (event: React.DragEvent<HTMLDivElement>) => {
                  if (
                    !readOnly &&
                    state.isDraggingInternally &&
                    attributes.onDragEnd &&
                    ReactEditor.hasTarget(editor, event.target)
                  ) {
                    attributes.onDragEnd(event)
                  }
                },
                [readOnly, state, attributes, editor]
              )}
              onFocus={useCallback(
                (event: React.FocusEvent<HTMLDivElement>) => {
                  if (
                    !readOnly &&
                    !state.isUpdatingSelection &&
                    ReactEditor.hasEditableTarget(editor, event.target) &&
                    !isEventHandled(event, attributes.onFocus)
                  ) {
                    const el = ReactEditor.toDOMNode(editor, editor)
                    const root = ReactEditor.findDocumentOrShadowRoot(editor)
                    state.latestElement = root.activeElement

                    // COMPAT: If the editor has nested editable elements, the focus
                    // can go to them. In Firefox, this must be prevented because it
                    // results in issues with keyboard navigation. (2017/03/30)
                    if (IS_FIREFOX && event.target !== el) {
                      el.focus()
                      return
                    }
                  }
                },
                [readOnly, state, editor, attributes.onFocus]
              )}
              ref={ref}
            >
              <Children
                decorations={decorations}
                node={editor}
                renderElement={renderElement}
                renderChunk={renderChunk}
                renderPlaceholder={renderPlaceholder}
                renderLeaf={renderLeaf}
                renderText={renderText}
              />
            </Component>
          </DecorateContext.Provider>
        </ComposingContext.Provider>
      </ReadOnlyContext.Provider>
    )
  }
)

/**
 * NonEditable.
 */
export const NonEditable = React.forwardRef<HTMLDivElement, NonEditableProps>(
  (props, ref) => {
    const { as: Component = 'div', autoFocus } = props
    const editor = useSlate()

    const [isFocused, setFocusedState] = useState<boolean>(() => {
      IS_FOCUSED.set(editor, !!autoFocus)
      return !!autoFocus
    })

    const [contentRendered, setContentRendered] = useState(false)

    const handleBlur: React.FocusEventHandler = (event: any) => {
      setFocusedState(false)
      IS_FOCUSED.delete(editor)
      props.onBlur && props.onBlur(event)
    }

    const handleFocus = (event: any) => {
      if (!isFocused) {
        setFocusedState(true)
        IS_FOCUSED.set(editor, true)
        props.onFocus?.(event)
      }
    }

    return (
      <Component data-editor-popup-container style={{ position: 'relative' }}>
        <IFrame
          preserveFocusStyle={isFocused}
          onRendered={() => {
            setContentRendered(true)
          }}
        >
          <NonEditableInner ref={ref} {...props} onFocus={handleFocus} />
        </IFrame>
        {contentRendered && (
          <VirtualInput
            isEditorFocused={isFocused}
            onBlur={handleBlur}
            onFocus={handleFocus}
          />
        )}
      </Component>
    )
  }
)

/**
 * The props that get passed to renderPlaceholder
 */
export type RenderPlaceholderProps = {
  children: any
  attributes: {
    'data-slate-placeholder': boolean
    dir?: 'rtl'
    contentEditable: boolean
    ref: React.RefCallback<any>
    style: React.CSSProperties
  }
}

/**
 * The default placeholder element
 */

export const DefaultPlaceholder = ({
  attributes,
  children,
}: RenderPlaceholderProps) => (
  // COMPAT: Artificially add a line-break to the end on the placeholder element
  // to prevent Android IMEs to pick up its content in autocorrect and to auto-capitalize the first letter
  <span {...attributes}>
    {children}
    {IS_ANDROID && <br />}
  </span>
)

/**
 * A default memoized decorate function.
 */

export const defaultDecorate: (entry: NodeEntry) => DecoratedRange[] = () => []

/**
 * A default implement to scroll dom range into view.
 */

const defaultScrollSelectionIntoView = (
  editor: ReactEditor,
  domRange: DOMRange
) => {
  // This was affecting the selection of multiple blocks and dragging behavior,
  // so enabled only if the selection has been collapsed.
  if (
    domRange.getBoundingClientRect &&
    (!editor.selection ||
      (editor.selection && Range.isCollapsed(editor.selection)))
  ) {
    const leafEl = domRange.startContainer.parentElement!

    // COMPAT: In Chrome, domRange.getBoundingClientRect() can return zero dimensions for valid ranges (e.g. line breaks).
    // When this happens, do not scroll like most editors do.
    const domRect = domRange.getBoundingClientRect()
    const isZeroDimensionRect =
      domRect.width === 0 &&
      domRect.height === 0 &&
      domRect.x === 0 &&
      domRect.y === 0

    if (isZeroDimensionRect) {
      const leafRect = leafEl.getBoundingClientRect()
      const leafHasDimensions = leafRect.width > 0 || leafRect.height > 0

      if (leafHasDimensions) {
        return
      }
    }

    // Default behavior: use domRange's getBoundingClientRect
    leafEl.getBoundingClientRect = domRange.getBoundingClientRect.bind(domRange)
    scrollIntoView(leafEl, {
      scrollMode: 'if-needed',
    })

    // @ts-expect-error an unorthodox delete D:
    delete leafEl.getBoundingClientRect
  }
}

/**
 * Check if an event is overrided by a handler.
 */

export const isEventHandled = <
  EventType extends React.SyntheticEvent<unknown, unknown>,
>(
  event: EventType,
  handler?: (event: EventType) => void | boolean
) => {
  if (!handler) {
    return false
  }
  // The custom event handler may return a boolean to specify whether the event
  // shall be treated as being handled or not.
  const shouldTreatEventAsHandled = handler(event)

  if (shouldTreatEventAsHandled != null) {
    return shouldTreatEventAsHandled
  }

  return event.isDefaultPrevented() || event.isPropagationStopped()
}

/**
 * Check if the event's target is an input element
 */
export const isDOMEventTargetInput = <
  EventType extends React.SyntheticEvent<unknown, unknown>,
>(
  event: EventType
) => {
  return (
    isDOMNode(event.target) &&
    (event.target instanceof HTMLInputElement ||
      event.target instanceof HTMLTextAreaElement)
  )
}

/**
 * Check if a DOM event is overrided by a handler.
 */

export const isDOMEventHandled = <E extends Event>(
  event: E,
  handler?: (event: E) => void | boolean
) => {
  if (!handler) {
    return false
  }

  // The custom event handler may return a boolean to specify whether the event
  // shall be treated as being handled or not.
  const shouldTreatEventAsHandled = handler(event)

  if (shouldTreatEventAsHandled != null) {
    return shouldTreatEventAsHandled
  }

  return event.defaultPrevented
}

const handleNativeHistoryEvents = (editor: Editor, event: InputEvent) => {
  const maybeHistoryEditor: any = editor
  if (
    event.inputType === 'historyUndo' &&
    typeof maybeHistoryEditor.undo === 'function'
  ) {
    maybeHistoryEditor.undo()
    return
  }
  if (
    event.inputType === 'historyRedo' &&
    typeof maybeHistoryEditor.redo === 'function'
  ) {
    maybeHistoryEditor.redo()
    return
  }
}
