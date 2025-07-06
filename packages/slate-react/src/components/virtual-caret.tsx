import React, { useRef } from 'react'
import { Range, Selection } from 'slate'

import { ReactEditor } from '../plugin/react-editor'

import { useSlateStatic } from '../hooks/use-slate-static'
import { useIsomorphicLayoutEffect } from '../hooks/use-isomorphic-layout-effect'

export const VirtualCaret = (props: {
  selection?: Selection
  twinkling?: boolean
  children?: React.ReactNode
}) => {
  const { selection, twinkling, children } = props
  const editor = useSlateStatic()

  const wrapperRef = useRef<HTMLDivElement | null>(null)
  const cursorRef = useRef<HTMLSpanElement | null>(null)

  useIsomorphicLayoutEffect(() => {
    if (cursorRef.current && props.twinkling) {
      let visible = true
      cursorRef.current.style.visibility = 'visible'
      const fn = () => {
        visible = !visible
        if (cursorRef.current) {
          cursorRef.current.style.visibility = visible ? 'visible' : 'hidden'
        }
      }
      const timmer = setInterval(fn, 500)
      return () => clearInterval(timmer)
    }
  }, [twinkling, selection])

  useIsomorphicLayoutEffect(() => {
    const window = ReactEditor.getWindow(editor)
    if (!selection) {
      return
    }

    const collapsed = Range.isCollapsed(selection)

    if (wrapperRef.current && cursorRef.current) {
      if (!collapsed) {
        cursorRef.current.style.opacity = '0'
        return
      }

      const domRange = ReactEditor.toDOMRange(editor, selection)

      const startContainerStyle = window.getComputedStyle(
        (domRange.startContainer.nodeType === 3
          ? domRange.startContainer.parentNode
          : domRange.startContainer) as HTMLSpanElement
      )
      const domRangeRect = domRange.getBoundingClientRect()
      const left = domRangeRect.left
      const top = domRangeRect.top

      cursorRef.current.style.height = startContainerStyle.lineHeight

      wrapperRef.current.style.left = `${left}px`
      wrapperRef.current.style.top = `${top}px`

      cursorRef.current.style.opacity = '1'
    }
  }, [editor, editor.children, selection])

  return (
    <div
      ref={wrapperRef}
      style={{
        position: 'absolute',
        pointerEvents: 'none',
        margin: 0,
        padding: 0,
        display: 'inline-block',
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
      {children}
    </div>
  )
}
