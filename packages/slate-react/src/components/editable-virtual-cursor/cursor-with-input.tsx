import React, { ChangeEvent, useCallback, useEffect, useRef } from 'react'
import { Range, Transforms, Node, Editor } from 'slate'
import { HistoryEditor } from 'slate-history'
import getDirection from 'direction'

import { useSlate } from '../../hooks/use-slate'

import { log } from '../../utils/log'
import { isEventHandled } from '../../utils/is-event-handled'
import Hotkeys from '../../utils/hotkeys'

import { VirtualCursor } from './virtual-cursor'

export const CursorWithInput: React.FC<{
  isEditorFocused: boolean
  onKeyDown?: React.KeyboardEventHandler<HTMLDivElement>
}> = props => {
  const { isEditorFocused } = props
  const editor = useSlate()
  const inputRef = useRef<HTMLInputElement>()
  useEffect(() => {
    if (inputRef.current) {
      const collapsed =
        !!editor.selection && Range.isCollapsed(editor.selection)
      if (collapsed && isEditorFocused) {
        inputRef.current.focus()
      }
    }
  }, [editor, editor.children, editor.selection, isEditorFocused])

  const handleChange = useCallback(
    (event: React.ChangeEvent<HTMLInputElement>) => {
      log(`CursorWithInput handleChange`)
      const v = event.target.value
      Transforms.insertText(editor, v)
      event.target.value = ''
    },
    [editor]
  )

  const handleKeyDown = useCallback(
    (event: React.KeyboardEvent<HTMLDivElement>) => {
      log(`CursorWithInput handleKeyDown`)

      if (!isEventHandled(event, props.onKeyDown)) {
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

          if (HistoryEditor.isHistoryEditor(editor)) {
            editor.redo()
          }

          return
        }

        if (Hotkeys.isUndo(nativeEvent)) {
          event.preventDefault()

          if (HistoryEditor.isHistoryEditor(editor)) {
            editor.undo()
          }

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

  return (
    <VirtualCursor twinkling cursorHidden={!isEditorFocused}>
      <input
        ref={inputRef}
        onChange={handleChange}
        onKeyDown={handleKeyDown}
        style={{
          width: '3em',
          opacity: 0.5,
          padding: 0,
          margin: 0,
          verticalAlign: 'top',
        }}
        data-slate-virtual-cursor-input
      />
    </VirtualCursor>
  )
}
