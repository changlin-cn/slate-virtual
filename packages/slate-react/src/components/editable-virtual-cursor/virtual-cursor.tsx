import React, { useEffect, useRef, useMemo, useCallback, useState } from 'react'
import { Range, BaseRange } from 'slate'

import { ReactEditor } from '../..'
import { useSlate } from '../../hooks/use-slate'

import { NODE_TO_ELEMENT, EDITOR_TO_WINDOW } from '../../utils/weak-maps'

import { log } from '../../utils/log'

export const VirtualCursor: React.FC<{
  selection?: BaseRange
  twinkling?: boolean
  cursorHidden?: boolean
}> = props => {
  const editor = useSlate()
  const containerRef = useRef<HTMLDivElement | null>()
  const cursorRef = useRef<HTMLSpanElement | null>()
  const selection = props.selection || editor.selection

  useEffect(() => {
    const rootEl = NODE_TO_ELEMENT.get(editor)
    const window = EDITOR_TO_WINDOW.get(editor)
    if (!selection || !window || !rootEl) {
      return
    }
    const collapsed = !!selection && Range.isCollapsed(selection)
    const rootElRect = rootEl.getBoundingClientRect()
    const domRange = ReactEditor.toDOMRange(editor, selection)
    log(
      `VirtualCursor useEffect domRange.startContainer:`,
      domRange.startContainer
    )

    const startContainerStyle = window.getComputedStyle(
      (domRange.startContainer.nodeType === 3
        ? domRange.startContainer.parentNode
        : domRange.startContainer) as HTMLSpanElement
    )
    const domRangeRect = domRange.getBoundingClientRect()
    const left = domRangeRect.left - rootElRect.left
    const top = domRangeRect.top - rootElRect.top
    if (containerRef.current && cursorRef.current) {
      cursorRef.current.style.height = startContainerStyle.lineHeight

      containerRef.current.style.left = `${left}px`
      containerRef.current.style.top = `${top}px`

      if (!collapsed) {
        cursorRef.current.style.opacity = '0'
      } else {
        cursorRef.current.style.opacity = '1'
      }
    }
  }, [editor, editor.children, selection])

  useEffect(() => {
    if (cursorRef.current && props.twinkling) {
      let visible = true
      const fn = () => {
        visible = !visible
        if (cursorRef.current) {
          cursorRef.current.style.visibility = visible ? 'visible' : 'hidden'
        }
      }
      const timmer = setInterval(fn, 500)
      return () => clearInterval(timmer)
    }
  }, [props.twinkling])

  return (
    <div
      ref={containerRef}
      style={{
        position: 'absolute',
        pointerEvents: 'none',
        margin: 0,
        padding: 0,
        display: props.cursorHidden ? 'none' : 'inline-block',
      }}
    >
      <span
        ref={cursorRef}
        style={{
          display: 'inline-block',
          width: '2px',
          height: '22px',
          background: 'black',
        }}
      />
      {props.children}
    </div>
  )
}
