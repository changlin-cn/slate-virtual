# “slate-react”改用用虚拟光标方案验证

[English](./Readme.md) | 中文

## 方案描述：

采用了一个 input 元素代替原先使用 contentEditable=true 的元素来接收用户的输入。这样做的好处是，可以避免在原编辑器内使用输入法时导致的一些问题。如果你打开开发者工具并审查元素，你会发现在虚拟光标的旁边有一个隐藏的 input 元素。

## 目前实现的进度：

现在已经做到了当用户点击鼠标后，光标可以定位到指定的位置，然后用户可以在此位置进行输入，无论是否使用输入法都可以。

## 存在的问题：

该方案存在一个明显的问题。当用户使用鼠标拖动选中一段文本后，如果此时 input 元素获取了焦点，那么选中文本的“拖蓝”样式（即文本的背景变为蓝色，表示被选中）会丢失。但是，如果 input 元素不获取焦点，用户在使用输入法进行输入时，又会丢失“拖蓝”后的第一次敲击键盘的输入内容。当然，这个问题是可以解决的，方法是给选中的文本手动加上“拖蓝”的效果，但这样做会有一定的性能损耗。

## 最终决定：

由于出现了更好的解决方案，目前这个方案已经停止继续开发。

## 在线示例
[点击查看](https://lin150.fun/spa/slate-virtual-cursor-demo/examples/virtual-cursor)

## 相关代码

[code](https://github.com/changlin-cn/slate-virtual/tree/virtual-cursor/packages/slate-react/src/components/editable-virtual-cursor)

## Slate

[Slate](https://github.com/ianstormtaylor/slate)
