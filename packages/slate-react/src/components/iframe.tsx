import React, { useState, useRef, useEffect } from 'react'
import { createPortal } from 'react-dom'

interface AutoHeightIFrameProps
  extends React.IframeHTMLAttributes<HTMLIFrameElement> {
  children: React.ReactNode
  scrollOffset?: number
  observeRootElement?: boolean
  preserveFocusStyle?: boolean // 是否保持焦点状态下的选择样式
}

export const IFrame: React.FC<AutoHeightIFrameProps> = ({
  children,
  preserveFocusStyle = true,
  observeRootElement = true,
  scrollOffset = 0,
  style = {},
  ...props
}) => {
  const [mountNode, setMountNode] = useState<HTMLElement | null>(null)
  const [htmlElement, setHtmlElement] = useState<HTMLElement | null>(null)
  const [height, setHeight] = useState<number>(0)
  const iframeRef = useRef<HTMLIFrameElement>(null)
  const resizeObserverRef = useRef<ResizeObserver | null>(null)

  // 解决焦点状态下文本选择变灰问题
  const addSelectionStyles = (document: Document) => {
    const head = document.head || document.getElementsByTagName('head')[0]
    const existingStyle = document.getElementById('selection-style')

    if (existingStyle) return

    const style = document.createElement('style')
    style.id = 'selection-style'
    style.textContent = `
      ::selection {
        background: ${preserveFocusStyle ? '#3a8af7' : '#a0c5ff'};
        color: white;
      }
      
      ::-moz-selection {
        background: ${preserveFocusStyle ? '#3a8af7' : '#a0c5ff'};
        color: white;
      }
      
      /* 覆盖非焦点状态下的选择样式 */
      :not(:focus)::selection {
        background: ${preserveFocusStyle ? '#3a8af7' : '#a0c5ff'};
        color: white;
      }
      
      :not(:focus)::-moz-selection {
        background: ${preserveFocusStyle ? '#3a8af7' : '#a0c5ff'};
        color: white;
      }
    `

    head.appendChild(style)
  }

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

      // 添加统一的文本选择样式
      addSelectionStyles(iframeDoc)

      // 设置挂载点
      setMountNode(iframeDoc.body)
      setHtmlElement(iframeDoc.documentElement)

      // 初始高度设置
      setHeight(iframeDoc.documentElement.scrollHeight + scrollOffset)
    }
  }

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
      {mountNode && createPortal(children, mountNode)}
    </iframe>
  )
}
