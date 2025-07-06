import React, { useCallback, useEffect, useRef, useMemo } from 'react'
import {
  Range,
  Transforms,
  Node,
  Editor,
  BaseRange,
  Path,
  Selection,
} from 'slate'
// import { HistoryEditor } from 'slate-history'
import getDirection from 'direction'

import { useSlate } from '../hooks/use-slate'

import { log } from '../utils/log'
import { isEventHandled } from '../utils/is-event-handled'
import { Hotkeys } from 'slate-dom'

import { VirtualCaret } from './virtual-caret'
import { ReactEditor } from '../plugin/react-editor'

export const VirtualInput: React.FC<{
  isEditorFocused: boolean
  onKeyDown?: React.KeyboardEventHandler<HTMLDivElement>
  onBlur?: React.FocusEventHandler
  onFocus?: React.FocusEventHandler
}> = props => {
  const { isEditorFocused } = props
  const editor = useSlate()
  const inputRef = useRef<HTMLInputElement>(null)
  const state = useMemo(
    () => ({
      isComposing: false,
      historyStrs: [''],
      isMouseDown: false,
    }),
    []
  )

  const handleChange = useCallback(
    (event: React.ChangeEvent<HTMLInputElement>) => {
      const v = event.target.value
      log(`CursorWithInput handleChange.value:${v}`)
      if (!state.isComposing) {
        Transforms.insertText(editor, v)
        event.target.value = ''
        return
      }
      state.historyStrs.push(v)
      if (state.historyStrs.length === 1) {
        Transforms.insertText(editor, v)
        return
      }
      const pre = state.historyStrs[state.historyStrs.length - 2]
      const { anchor, focus } = editor.selection as BaseRange
      Transforms.insertText(editor, v, {
        at: {
          focus,
          anchor: { path: anchor.path, offset: anchor.offset - pre.length },
        },
      })
    },
    [editor]
  )

  const handleKeyDown = useCallback(
    (event: React.KeyboardEvent<HTMLDivElement>) => {
      log(`CursorWithInput handleKeyDown`)

      if (!state.isComposing && !isEventHandled(event, props.onKeyDown)) {
        const { nativeEvent } = event
        const { selection } = editor

        const element =
          editor.children[selection !== null ? selection.focus.path[0] : 0]
        const isRTL = getDirection(Node.string(element)) === 'rtl'

        // COMPAT: Since we prevent the default behavior on
        // `beforeinput` events, the browser doesn't think there's ever
        // any history stack to undo or redo, so we have to manage these
        // hotkeys ourselves. (2019/11/06)
        if (Hotkeys.isRedo(nativeEvent)) {
          event.preventDefault()

          // if (HistoryEditor.isHistoryEditor(editor)) {
          //   editor.redo()
          // }

          return
        }

        if (Hotkeys.isUndo(nativeEvent)) {
          event.preventDefault()

          // if (HistoryEditor.isHistoryEditor(editor)) {
          //   editor.undo()
          // }

          return
        }

        // COMPAT: Certain browsers don't handle the selection updates
        // properly. In Chrome, the selection isn't properly extended.
        // And in Firefox, the selection isn't properly collapsed.
        // (2017/10/17)
        if (Hotkeys.isMoveLineBackward(nativeEvent)) {
          event.preventDefault()
          Transforms.move(editor, { unit: 'line', reverse: true })
          return
        }

        if (Hotkeys.isMoveLineForward(nativeEvent)) {
          event.preventDefault()
          Transforms.move(editor, { unit: 'line' })
          return
        }

        if (Hotkeys.isExtendLineBackward(nativeEvent)) {
          event.preventDefault()
          Transforms.move(editor, {
            unit: 'line',
            edge: 'focus',
            reverse: true,
          })
          return
        }

        if (Hotkeys.isExtendLineForward(nativeEvent)) {
          event.preventDefault()
          Transforms.move(editor, { unit: 'line', edge: 'focus' })
          return
        }

        // COMPAT: If a void node is selected, or a zero-width text node
        // adjacent to an inline is selected, we need to handle these
        // hotkeys manually because browsers won't be able to skip over
        // the void node with the zero-width space not being an empty
        // string.
        if (Hotkeys.isMoveBackward(nativeEvent)) {
          event.preventDefault()

          if (selection && Range.isCollapsed(selection)) {
            Transforms.move(editor, { reverse: !isRTL })
          } else {
            Transforms.collapse(editor, { edge: 'start' })
          }

          return
        }

        if (Hotkeys.isMoveForward(nativeEvent)) {
          event.preventDefault()

          if (selection && Range.isCollapsed(selection)) {
            Transforms.move(editor, { reverse: isRTL })
          } else {
            Transforms.collapse(editor, { edge: 'end' })
          }

          return
        }

        if (Hotkeys.isMoveWordBackward(nativeEvent)) {
          event.preventDefault()

          if (selection && Range.isExpanded(selection)) {
            Transforms.collapse(editor, { edge: 'focus' })
          }

          Transforms.move(editor, { unit: 'word', reverse: !isRTL })
          return
        }

        if (Hotkeys.isMoveWordForward(nativeEvent)) {
          event.preventDefault()

          if (selection && Range.isExpanded(selection)) {
            Transforms.collapse(editor, { edge: 'focus' })
          }

          Transforms.move(editor, { unit: 'word', reverse: isRTL })
          return
        }

        if (
          Hotkeys.isBold(nativeEvent) ||
          Hotkeys.isItalic(nativeEvent) ||
          Hotkeys.isTransposeCharacter(nativeEvent)
        ) {
          event.preventDefault()
          return
        }

        if (Hotkeys.isSplitBlock(nativeEvent)) {
          event.preventDefault()
          Editor.insertBreak(editor)
          return
        }

        if (Hotkeys.isDeleteBackward(nativeEvent)) {
          event.preventDefault()

          if (selection && Range.isExpanded(selection)) {
            Editor.deleteFragment(editor, { direction: 'backward' })
          } else {
            Editor.deleteBackward(editor)
          }

          return
        }

        if (Hotkeys.isDeleteForward(nativeEvent)) {
          event.preventDefault()

          if (selection && Range.isExpanded(selection)) {
            Editor.deleteFragment(editor, { direction: 'forward' })
          } else {
            Editor.deleteForward(editor)
          }

          return
        }

        if (Hotkeys.isDeleteLineBackward(nativeEvent)) {
          event.preventDefault()

          if (selection && Range.isExpanded(selection)) {
            Editor.deleteFragment(editor, { direction: 'backward' })
          } else {
            Editor.deleteBackward(editor, { unit: 'line' })
          }

          return
        }

        if (Hotkeys.isDeleteLineForward(nativeEvent)) {
          event.preventDefault()

          if (selection && Range.isExpanded(selection)) {
            Editor.deleteFragment(editor, { direction: 'forward' })
          } else {
            Editor.deleteForward(editor, { unit: 'line' })
          }

          return
        }

        if (Hotkeys.isDeleteWordBackward(nativeEvent)) {
          event.preventDefault()

          if (selection && Range.isExpanded(selection)) {
            Editor.deleteFragment(editor, { direction: 'backward' })
          } else {
            Editor.deleteBackward(editor, { unit: 'word' })
          }

          return
        }

        if (Hotkeys.isDeleteWordForward(nativeEvent)) {
          event.preventDefault()

          if (selection && Range.isExpanded(selection)) {
            Editor.deleteFragment(editor, { direction: 'forward' })
          } else {
            Editor.deleteForward(editor, { unit: 'word' })
          }

          return
        }
      }
    },
    [props.onKeyDown]
  )

  const handleCompositionStart = useCallback(
    (event: React.CompositionEvent<HTMLInputElement>) => {
      //   log(`CursorWithInput handleCompositionStart`)
      state.historyStrs.length = 0
      state.isComposing = true
    },
    [editor]
  )

  const handleCompositionEnd = useCallback(
    (event: React.CompositionEvent<HTMLInputElement>) => {
      //   log(`CursorWithInput handleCompositionEnd`)
      state.isComposing = false
      // @ts-ignore
      event.target.value = ''
    },
    [editor]
  )

  const handleBlur = (event: React.FocusEvent) => {
    // console.log(event.relatedTarget,document.activeElement)
    if (state.isMouseDown) {
      return
    }
    props.onBlur?.(event)
  }

  useEffect(() => {
    const window = ReactEditor.getWindow(editor)
    const mdfn = () => {
      state.isMouseDown = true
    }
    const mufn = (event: MouseEvent) => {
      state.isMouseDown = false

      const selection = window.getSelection()
      const domRange = selection!.getRangeAt(0)
      if (domRange) {
        try {
          const range = ReactEditor.toSlateRange(editor, domRange, {
            exactMatch: true,
            suppressThrow: true,
          })
          // console.log('range',range)
          if (range) {
            inputRef.current?.focus()
          }
        } catch (e) {
          // do nothing
        }
      }
    }
    window.addEventListener('mousedown', mdfn, true)
    window.addEventListener('mouseup', mufn, true)
    return () => {
      window.removeEventListener('mousedown', mdfn, true)
      window.removeEventListener('mouseup', mufn, true)
    }
  }, [editor])

  useEffect(() => {
    if (inputRef.current) {
      if (!editor.selection && isEditorFocused) {
        const p = Editor.start(editor, [])
        Transforms.select(editor, p)
        inputRef.current.focus()
        return
      }

      const collapsed =
        !!editor.selection && Range.isCollapsed(editor.selection)
      if (collapsed && isEditorFocused && !state.isMouseDown) {
        // inputRef.current.focus()
      }
    }
  }, [editor, editor.children, editor.selection, isEditorFocused])

  return (
    <VirtualCaret twinkling={isEditorFocused} selection={editor.selection}>
      <input
        ref={inputRef}
        onChange={handleChange}
        onKeyDown={handleKeyDown}
        onCompositionStart={handleCompositionStart}
        onCompositionEnd={handleCompositionEnd}
        onBlur={handleBlur}
        onFocus={props.onFocus}
        style={{
          width: '5px',
          opacity: 0,
          padding: 0,
          margin: 0,
          verticalAlign: 'top',
          outline: 'none',
          position: 'absolute',
          left: 0,
          top: 0,
        }}
        placeholder="this is input"
        data-slate-virtual-cursor-input
      />
    </VirtualCaret>
  )
}
