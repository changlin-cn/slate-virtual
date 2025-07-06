import React, { useState, useRef, useEffect, useMemo } from 'react'
import { createPortal } from 'react-dom'
import { useIsomorphicLayoutEffect } from '../hooks/use-isomorphic-layout-effect'
import { EDITOR_TO_WINDOW } from 'slate-dom'
import { useSlate } from '../hooks/use-slate'

interface AutoHeightIFrameProps
  extends React.IframeHTMLAttributes<HTMLIFrameElement> {
  children: React.ReactNode
  scrollOffset?: number
  observeRootElement?: boolean
  preserveFocusStyle?: boolean // 是否保持焦点状态下的选择样式
  onRendered?: () => void
}

export const IFrame: React.FC<AutoHeightIFrameProps> = ({
  children,
  preserveFocusStyle = true,
  observeRootElement = true,
  scrollOffset = 0,
  style = {},
  onRendered = () => {},
  ...props
}) => {
  const [mountNode, setMountNode] = useState<HTMLElement | null>(null)
  const [htmlElement, setHtmlElement] = useState<HTMLElement | null>(null)
  const [height, setHeight] = useState<number>(0)
  const iframeRef = useRef<HTMLIFrameElement>(null)
  const resizeObserverRef = useRef<ResizeObserver | null>(null)

  const styleContent = useMemo(() => {
    const str = `
      ${
        preserveFocusStyle
          ? `
      :not(:focus)::selection {
        background: #3a8af7;
        color: white;
      }
      :not(:focus)::-moz-selection {
        background: #3a8af7;
        color: white;
      }
        `
          : ''
      }
    `
    return str
  }, [preserveFocusStyle])

  // 处理 iframe 加载完成
  const handleLoad = (e: React.SyntheticEvent<HTMLIFrameElement>) => {
    const iframe = e.currentTarget
    const iframeDoc = iframe.contentDocument || iframe.contentWindow?.document

    if (iframeDoc) {
      // 重置文档样式
      iframeDoc.documentElement.style.margin = '0'
      iframeDoc.documentElement.style.padding = '0'
      iframeDoc.body.style.margin = '0'
      iframeDoc.body.style.padding = '0'

      // 设置挂载点
      setMountNode(iframeDoc.body)
      setHtmlElement(iframeDoc.documentElement)

      // 初始高度设置
      setHeight(iframeDoc.documentElement.scrollHeight + scrollOffset)
    }
  }

  const editor = useSlate()
  useIsomorphicLayoutEffect(() => {
    EDITOR_TO_WINDOW.set(editor, iframeRef.current?.contentWindow!)
  }, [])

  // 自动高度逻辑
  useEffect(() => {
    if (!htmlElement || !mountNode || !iframeRef.current) return

    // 清理旧观察者
    if (resizeObserverRef.current) {
      resizeObserverRef.current.disconnect()
      resizeObserverRef.current = null
    }

    // 创建新的 ResizeObserver
    resizeObserverRef.current = new ResizeObserver(entries => {
      for (const entry of entries) {
        // 基于html元素的scrollHeight计算高度
        const contentHeight = observeRootElement
          ? htmlElement.scrollHeight
          : entry.target.scrollHeight

        // 添加偏移以消除滚动条
        const computedHeight = Math.max(10, contentHeight + scrollOffset)

        if (Math.abs(computedHeight - height) > 1) {
          setHeight(computedHeight)
        }
      }
    })

    // 开始观察元素
    const observeTarget = observeRootElement ? htmlElement : mountNode
    resizeObserverRef.current.observe(observeTarget)

    // 清理函数
    return () => {
      if (resizeObserverRef.current) {
        resizeObserverRef.current.disconnect()
        resizeObserverRef.current = null
      }
    }
  }, [htmlElement, mountNode, height, observeRootElement, scrollOffset])

  useEffect(() => {
    if (mountNode && onRendered) {
      onRendered()
    }
  }, [mountNode, onRendered])

  const content = (
    <>
      <style>{styleContent}</style>
      {children}
    </>
  )

  return (
    <iframe
      ref={iframeRef}
      srcDoc="<!DOCTYPE html>"
      {...props}
      style={{
        width: '100%',
        border: 'none',
        overflow: 'hidden',
        display: 'block',
        ...style,
        height: `${height}px`,
        transition: 'height 0.2s ease-in-out',
      }}
      onLoad={handleLoad}
      title={props.title || 'Auto-height iframe'}
    >
      {mountNode && createPortal(content, mountNode)}
    </iframe>
  )
}
