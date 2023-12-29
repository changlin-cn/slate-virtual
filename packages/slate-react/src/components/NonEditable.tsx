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
} from 'slate'
import { useAndroidInputManager } from '../hooks/android-input-manager/use-android-input-manager'
import useChildren from '../hooks/use-children'
import { DecorateContext } from '../hooks/use-decorate'
import { useIsomorphicLayoutEffect } from '../hooks/use-isomorphic-layout-effect'
import { ReadOnlyContext } from '../hooks/use-read-only'
import { useSlate } from '../hooks/use-slate'
import { useTrackUserInput } from '../hooks/use-track-user-input'
import { ReactEditor } from '../plugin/react-editor'
import { TRIPLE_CLICK } from '../utils/constants'
import {
  DOMElement,
  DOMRange,
  DOMText,
  getDefaultView,
  isDOMElement,
  isDOMNode,
  isPlainTextOnlyPaste,
} from '../utils/dom'
import {
  CAN_USE_DOM,
  HAS_BEFORE_INPUT_SUPPORT,
  IS_ANDROID,
  IS_CHROME,
  IS_FIREFOX,
  IS_FIREFOX_LEGACY,
  IS_IOS,
  IS_WEBKIT,
  IS_UC_MOBILE,
  IS_WECHATBROWSER,
} from '../utils/environment'
import Hotkeys from '../utils/hotkeys'
import {
  EDITOR_TO_ELEMENT,
  EDITOR_TO_FORCE_RENDER,
  EDITOR_TO_PENDING_INSERTION_MARKS,
  EDITOR_TO_USER_MARKS,
  EDITOR_TO_USER_SELECTION,
  EDITOR_TO_WINDOW,
  ELEMENT_TO_NODE,
  IS_COMPOSING,
  IS_FOCUSED,
  IS_READ_ONLY,
  MARK_PLACEHOLDER_SYMBOL,
  NODE_TO_ELEMENT,
  PLACEHOLDER_SYMBOL,
} from '../utils/weak-maps'
import { RestoreDOM } from './restore-dom/restore-dom'
import { AndroidInputManager } from '../hooks/android-input-manager/android-input-manager'
import {
  DefaultPlaceholder,
  EditableProps,
  RenderPlaceholderProps,
  defaultDecorate,
  isDOMEventTargetInput,
  isEventHandled,
} from './editable'

type DeferredOperation = () => void

const Children = (props: Parameters<typeof useChildren>[0]) => (
  <React.Fragment>{useChildren(props)}</React.Fragment>
)

/**
 * `EditableProps` are passed to the `<Editable>` component.
 */

export type NonEditableProps = EditableProps

/**
 * NonEditable.
 */

export const NonEditable = (props: EditableProps) => {
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
    renderLeaf,
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
  useEffect(() => {
    if (ref.current && autoFocus) {
      ref.current.focus()
    }
  }, [autoFocus])

  /**
   * The AndroidInputManager object has a cyclical dependency on onDOMSelectionChange
   *
   * It is defined as a reference to simplify hook dependencies and clarify that
   * it needs to be initialized.
   */
  const androidInputManagerRef = useRef<
    AndroidInputManager | null | undefined
  >()

  // Listen on the native `selectionchange` event to be able to update any time
  // the selection changes. This is required because React's `onSelect` is leaky
  // and non-standard so it doesn't fire until after a selection has been
  // released. This causes issues in situations where another change happens
  // while a selection is being dragged.
  const onDOMSelectionChange = useMemo(
    () =>
      throttle(() => {
        const androidInputManager = androidInputManagerRef.current
        if (
          (IS_ANDROID || !ReactEditor.isComposing(editor)) &&
          (!state.isUpdatingSelection || androidInputManager?.isFlushing()) &&
          !state.isDraggingInternally
        ) {
          const root = ReactEditor.findDocumentOrShadowRoot(editor)
          const { activeElement } = root
          const el = ReactEditor.toDOMNode(editor, editor)
          const domSelection = root.getSelection()

          if (activeElement === el) {
            state.latestElement = activeElement
            IS_FOCUSED.set(editor, true)
          } else {
            IS_FOCUSED.delete(editor)
          }

          if (!domSelection) {
            return Transforms.deselect(editor)
          }

          const { anchorNode, focusNode } = domSelection

          const anchorNodeSelectable =
            anchorNode &&
            (ReactEditor.hasDOMNode(editor, anchorNode) ||
              ReactEditor.isTargetInsideNonReadonlyVoid(editor, anchorNode))

          const focusNodeSelectable =
            focusNode &&
            (ReactEditor.hasDOMNode(editor, focusNode!) ||
              ReactEditor.isTargetInsideNonReadonlyVoid(editor, focusNode))

          if (anchorNodeSelectable && focusNodeSelectable) {
            const range = ReactEditor.toSlateRange(editor, domSelection, {
              exactMatch: false,
              suppressThrow: true,
            })

            if (range) {
              if (
                !ReactEditor.isComposing(editor) &&
                !androidInputManager?.hasPendingChanges() &&
                !androidInputManager?.isFlushing()
              ) {
                Transforms.select(editor, range)
              } else {
                androidInputManager?.handleUserSelect(range)
              }
            }
          }

          // Deselect the editor if the dom selection is not selectable in readonly mode
          if (readOnly && (!anchorNodeSelectable || !focusNodeSelectable)) {
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

  androidInputManagerRef.current = useAndroidInputManager({
    node: ref,
    onDOMSelectionChange,
    scheduleOnDOMSelectionChange,
  })

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
    const domSelection = root.getSelection()

    if (
      !domSelection ||
      !ReactEditor.isFocused(editor) ||
      androidInputManagerRef.current?.hasPendingAction()
    ) {
      return
    }

    const setDomSelection = (forceChange?: boolean) => {
      const hasDomSelection = domSelection.type !== 'None'

      // If the DOM selection is properly unset, we're done.
      if (!selection && !hasDomSelection) {
        return
      }

      // Get anchorNode and focusNode
      const focusNode = domSelection.focusNode
      let anchorNode

      // COMPAT: In firefox the normal seletion way does not work
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

      const newDomRange: DOMRange | null =
        selection && ReactEditor.toDOMRange(editor, selection)

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

    const ensureSelection =
      androidInputManagerRef.current?.isFlushing() === 'action'

    if (!IS_ANDROID || !ensureSelection) {
      setTimeout(() => {
        state.isUpdatingSelection = false
      })
      return
    }

    let timeoutId: ReturnType<typeof setTimeout> | null = null
    const animationFrameId = requestAnimationFrame(() => {
      if (ensureSelection) {
        const ensureDomSelection = (forceChange?: boolean) => {
          try {
            const el = ReactEditor.toDOMNode(editor, editor)
            el.focus()

            setDomSelection(forceChange)
          } catch (e) {
            // Ignore, dom and state might be out of sync
          }
        }

        // Compat: Android IMEs try to force their selection by manually re-applying it even after we set it.
        // This essentially would make setting the slate selection during an update meaningless, so we force it
        // again here. We can't only do it in the setTimeout after the animation frame since that would cause a
        // visible flicker.
        ensureDomSelection()

        timeoutId = setTimeout(() => {
          // COMPAT: While setting the selection in an animation frame visually correctly sets the selection,
          // it doesn't update GBoards spellchecker state. We have to manually trigger a selection change after
          // the animation frame to ensure it displays the correct state.
          ensureDomSelection(true)
          state.isUpdatingSelection = false
        })
      }
    })

    return () => {
      cancelAnimationFrame(animationFrameId)
      if (timeoutId) {
        clearTimeout(timeoutId)
      }
    }
  })

  const callbackRef = useCallback(
    (node: HTMLDivElement | null) => {
      if (node == null) {
        onDOMSelectionChange.cancel()
        scheduleOnDOMSelectionChange.cancel()

        EDITOR_TO_ELEMENT.delete(editor)
        NODE_TO_ELEMENT.delete(editor)
      }

      ref.current = node
    },
    [onDOMSelectionChange, scheduleOnDOMSelectionChange, editor]
  )

  // Attach a native DOM event handler for `selectionchange`, because React's
  // built-in `onSelect` handler doesn't fire for all selection changes. It's a
  // leaky polyfill that only fires on keypresses or clicks. Instead, we want to
  // fire for any change to the selection inside the editor. (2019/11/04)
  // https://github.com/facebook/react/issues/5785
  useIsomorphicLayoutEffect(() => {
    const window = ReactEditor.getWindow(editor)

    window.document.addEventListener(
      'selectionchange',
      scheduleOnDOMSelectionChange
    )

    return () => {
      window.document.removeEventListener(
        'selectionchange',
        scheduleOnDOMSelectionChange
      )
    }
  }, [scheduleOnDOMSelectionChange])

  const decorations = decorate([editor, []])

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

  return (
    <ReadOnlyContext.Provider value={readOnly}>
      <DecorateContext.Provider value={decorate}>
        <RestoreDOM node={ref} receivedUserInput={receivedUserInput}>
          <Component
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
            tabIndex="0"
            ref={callbackRef}
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
                  const domSelection = root.getSelection()
                  domSelection?.removeAllRanges()
                }

                IS_FOCUSED.delete(editor)
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
                      !(Element.isElement(node) && Editor.isBlock(editor, node))
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
            onCopy={useCallback(
              (event: React.ClipboardEvent<HTMLDivElement>) => {
                if (
                  ReactEditor.hasSelectableTarget(editor, event.target) &&
                  !isEventHandled(event, attributes.onCopy) &&
                  !isDOMEventTargetInput(event)
                ) {
                  event.preventDefault()
                  ReactEditor.setFragmentData(
                    editor,
                    event.clipboardData,
                    'copy'
                  )
                }
              },
              [attributes.onCopy, editor]
            )}
            onCut={useCallback(
              (event: React.ClipboardEvent<HTMLDivElement>) => {
                if (
                  !readOnly &&
                  ReactEditor.hasSelectableTarget(editor, event.target) &&
                  !isEventHandled(event, attributes.onCut) &&
                  !isDOMEventTargetInput(event)
                ) {
                  event.preventDefault()
                  ReactEditor.setFragmentData(
                    editor,
                    event.clipboardData,
                    'cut'
                  )
                  const { selection } = editor

                  if (selection) {
                    if (Range.isExpanded(selection)) {
                      Editor.deleteFragment(editor)
                    } else {
                      const node = Node.parent(editor, selection.anchor.path)
                      if (Editor.isVoid(editor, node)) {
                        Transforms.delete(editor)
                      }
                    }
                  }
                }
              },
              [readOnly, editor, attributes.onCut]
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

                  if (Element.isElement(node) && Editor.isVoid(editor, node)) {
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
                    (Element.isElement(node) && Editor.isVoid(editor, node)) ||
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

                state.isDraggingInternally = false
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

                // When dropping on a different droppable element than the current editor,
                // `onDrop` is not called. So we need to clean up in `onDragEnd` instead.
                // Note: `onDragEnd` is only called when `onDrop` is not called
                state.isDraggingInternally = false
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

                  IS_FOCUSED.set(editor, true)
                }
              },
              [readOnly, state, editor, attributes.onFocus]
            )}
          >
            <Children
              decorations={decorations}
              node={editor}
              renderElement={renderElement}
              renderPlaceholder={renderPlaceholder}
              renderLeaf={renderLeaf}
              selection={editor.selection}
            />
          </Component>
        </RestoreDOM>
      </DecorateContext.Provider>
    </ReadOnlyContext.Provider>
  )
}

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
    leafEl.getBoundingClientRect = domRange.getBoundingClientRect.bind(domRange)
    scrollIntoView(leafEl, {
      scrollMode: 'if-needed',
    })

    // @ts-expect-error an unorthodox delete D:
    delete leafEl.getBoundingClientRect
  }
}
