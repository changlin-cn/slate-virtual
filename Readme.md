# Add virtual caret in "slate-react"

English | [中文](./Readme-zh_CN.md)

## Description of the project：

Use an input element instead of the original "contentEditable=true" element to receive user input. This can avoid some issues that may arise when using input methods in the original editor. If you open the developer tools and inspect the elements, you will find a hidden input element next to the virtual cursor.。

## Current progress:

Currently, the implementation allows the cursor to be positioned at a specific location after a mouse click, and users can enter text with or without input methods.

## Existing issues:

However, there is a problem. When the user selects a piece of text by clicking and dragging with the mouse, if the input element gains focus, the "highlighted text" style (where the background color of the selected text turns blue) will be lost. However, if the input element doesn't gain focus, users will lose the first keystroke after selecting text with input methods. This issue can be solved by manually adding "highlighted text" styling to the selected text, but this approach has some performance losses.

## Reference code

[code](https://github.com/changlin-cn/slate-virtual/tree/virtual-cursor/packages/slate-react/src/components/editable-virtual-cursor)

## Check the official documentation of slate

[Slate](https://github.com/ianstormtaylor/slate)
