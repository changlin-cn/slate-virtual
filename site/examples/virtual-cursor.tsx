import React, { useCallback, useMemo, useState } from 'react'
import isHotkey from 'is-hotkey'
import { EditableVirtualCursor, withReact, useSlate, Slate } from 'slate-react'
import {
  Editor,
  Transforms,
  createEditor,
  Descendant,
  Element as SlateElement,
} from 'slate'
import { withHistory } from 'slate-history'

import { Button, Icon, Toolbar } from '../components'

const HOTKEYS = {
  'mod+b': 'bold',
  'mod+i': 'italic',
  'mod+u': 'underline',
  'mod+`': 'code',
}

const LIST_TYPES = ['numbered-list', 'bulleted-list']

const RichTextExample = () => {
  const [value, setValue] = useState<Descendant[]>(initialValue)
  const renderElement = useCallback(props => <Element {...props} />, [])
  const renderLeaf = useCallback(props => <Leaf {...props} />, [])
  const editor = useMemo(() => withHistory(withReact(createEditor())), [])

  return (
    <Slate editor={editor} value={value} onChange={value => setValue(value)}>
      <Toolbar>
        <MarkButton format="bold" icon="format_bold" />
        <MarkButton format="italic" icon="format_italic" />
        <MarkButton format="underline" icon="format_underlined" />
        <MarkButton format="code" icon="code" />
        <BlockButton format="heading-one" icon="looks_one" />
        <BlockButton format="heading-two" icon="looks_two" />
        <BlockButton format="block-quote" icon="format_quote" />
        <BlockButton format="numbered-list" icon="format_list_numbered" />
        <BlockButton format="bulleted-list" icon="format_list_bulleted" />
      </Toolbar>
      <EditableVirtualCursor
        renderElement={renderElement}
        renderLeaf={renderLeaf}
        placeholder="Enter some rich text…"
        spellCheck
        autoFocus
        onKeyDown={event => {
          for (const hotkey in HOTKEYS) {
            if (isHotkey(hotkey, event as any)) {
              event.preventDefault()
              const mark = HOTKEYS[hotkey]
              toggleMark(editor, mark)
            }
          }
        }}
      />
    </Slate>
  )
}

const toggleBlock = (editor, format) => {
  const isActive = isBlockActive(editor, format)
  const isList = LIST_TYPES.includes(format)

  Transforms.unwrapNodes(editor, {
    match: n =>
      LIST_TYPES.includes(
        !Editor.isEditor(n) && SlateElement.isElement(n) && n.type
      ),
    split: true,
  })
  const newProperties: Partial<SlateElement> = {
    type: isActive ? 'paragraph' : isList ? 'list-item' : format,
  }
  Transforms.setNodes(editor, newProperties)

  if (!isActive && isList) {
    const block = { type: format, children: [] }
    Transforms.wrapNodes(editor, block)
  }
}

const toggleMark = (editor, format) => {
  const isActive = isMarkActive(editor, format)

  if (isActive) {
    Editor.removeMark(editor, format)
  } else {
    Editor.addMark(editor, format, true)
  }
}

const isBlockActive = (editor, format) => {
  const [match] = Editor.nodes(editor, {
    match: n =>
      !Editor.isEditor(n) && SlateElement.isElement(n) && n.type === format,
  })

  return !!match
}

const isMarkActive = (editor, format) => {
  const marks = Editor.marks(editor)
  return marks ? marks[format] === true : false
}

const Element = ({ attributes, children, element }) => {
  switch (element.type) {
    case 'block-quote':
      return <blockquote {...attributes}>{children}</blockquote>
    case 'bulleted-list':
      return <ul {...attributes}>{children}</ul>
    case 'heading-one':
      return <h1 {...attributes}>{children}</h1>
    case 'heading-two':
      return <h2 {...attributes}>{children}</h2>
    case 'list-item':
      return <li {...attributes}>{children}</li>
    case 'numbered-list':
      return <ol {...attributes}>{children}</ol>
    default:
      return <p {...attributes}>{children}</p>
  }
}

const Leaf = ({ attributes, children, leaf }) => {
  if (leaf.bold) {
    children = <strong>{children}</strong>
  }

  if (leaf.code) {
    children = <code>{children}</code>
  }

  if (leaf.italic) {
    children = <em>{children}</em>
  }

  if (leaf.underline) {
    children = <u>{children}</u>
  }

  return <span {...attributes}>{children}</span>
}

const BlockButton = ({ format, icon }) => {
  const editor = useSlate()
  return (
    <Button
      active={isBlockActive(editor, format)}
      onMouseDown={event => {
        event.preventDefault()
        toggleBlock(editor, format)
      }}
    >
      <Icon>{icon}</Icon>
    </Button>
  )
}

const MarkButton = ({ format, icon }) => {
  const editor = useSlate()
  return (
    <Button
      active={isMarkActive(editor, format)}
      onMouseDown={event => {
        event.preventDefault()
        toggleMark(editor, format)
      }}
    >
      <Icon>{icon}</Icon>
    </Button>
  )
}

const initialValue: Descendant[] = [
  { type: 'paragraph', children: [{ text: '这是一个使用虚拟光标的示例：' }] },
  {
    type: 'paragraph',
    children: [
      {
        text:
          '采用了一个input元素代替原contentEditable=“true”的元素来接收用户输入，避免了原编辑器内使用输入法时导致的一些问题（如果你打开开发者工具并审查元素，你会发现虚拟光标旁边有一个隐藏的input元素）；',
      },
    ],
  },
  {
    type: 'paragraph',
    children: [
      {
        text:
          '目前实现了鼠标点击后光标定位到某个位置然后可以（使用或不使用输入法）输入；',
      },
    ],
  },
  {
    type: 'paragraph',
    children: [
      {
        text:
          '但是有一个问题，鼠标选中一段文本后，如果input元素获取焦点，则选中文本的“拖蓝”样式会丢失，但是input元素不获取焦点，用户在使用输入法输入时就会丢失“拖蓝”后第一次敲击键盘输入内容，当然，此问题可以解决，就是给选中的文本手动加上“拖蓝”的效果（只是有一定的性能损耗）；',
      },
    ],
  },
  {
    type: 'paragraph',
    children: [{ text: '由于有更好的方案，此方案目前停止继续开发；' }],
  },
  { type: 'paragraph', children: [{ text: '' }] },
  {
    type: 'paragraph',
    children: [{ text: 'This is an example of using a virtual cursor: ' }],
  },
  {
    type: 'paragraph',
    children: [
      {
        text:
          ' An input element is used instead of the original contentEditable="true" element to receive user input, avoiding some problems caused by using input methods in the original editor(If you open the developer tools and inspect the elements, you will find a hidden input element next to the virtual cursor).  ',
      },
    ],
  },
  {
    type: 'paragraph',
    children: [
      {
        text:
          'Currently, the cursor can be positioned to a certain location after clicking the mouse, and input can be entered with or without an input method.  However, there is a problem: if the mouse selects a piece of text and the input element gains focus, the "drag blue" style of the selected text will be lost. However, if the input element does not gain focus, users will lose the "drag blue" effect after the first keystroke when using an input method to enter text. Of course, this problem can be solved by manually adding the "drag blue" effect to the selected text (with some performance loss).  ',
      },
    ],
  },
  {
    type: 'paragraph',
    children: [
      {
        text:
          'Due to a better solution, this solution has stopped further development.',
      },
    ],
  },
]

export default RichTextExample
