<h1 align='center'>“slate-react”改用虚拟光标</h1>
<p  align='center'>中文 | <a href='./Readme-EN.md'>English</a></p>
<p  align='center'>
<a href='https://lin150.fun/spa/slate-virtual-cursor-demo/examples/virtual-cursor' target='_blank'>在线示例</a> ·
<a href='#为什么要改？'>为什么要改？</a> ·
<a href='#改动的目标'>改动的目标</a> ·
<a href='#怎么改？'>怎么改？</a> ·
<a href='#怎么改？'>进度</a>

</p>

## 为什么要改？

1、因为当前框架存在的一些问题：

<ul>
<li><a href='https://changlin-cn.github.io/some-problems/baiduIME.html' target="_blank">当使用某些输入法，在输入内容时，需要控制光标的位置,出现异常</a>（这可能是某些输入法的问题，但对用户来说可能就是框架的问题）；</li>
<li>
用户在使用输入法输入过程中，突然白屏，控制台显示下面这些错误：
<ul>
<li>Failed to execute 'insertBefore' on 'Node': The node before which the new node is to be inserted is not a child of this node；</li>
<li>Cannot resolve a DOM point from Slate point: xxxxxx；</li>
</ul>
</li>
<li><a href='https://github.com/ianstormtaylor/slate/issues?q=is%3Aissue+is%3Aopen+IME' target="_blank">框架官方仓库仍有许多关于输入法的问题未关闭；</a></li>
</ul>

2、当你想在目前的框架上实现一个类似word的修订模式的功能时，由于输入法的原因，你会发现实现起来并不简单；

3、上面提到的问题，虽然可以使用‘ErrorBoundary’来做异常恢复，但不能彻底解决。问题产生的根本原因是，在使用contentEditable='true'的元素进行输入时，如果光标选区是展开的，选区中的内容会在输入过程中被删除。这个行为无法通过JavaScript来阻止，进而导致React在更新DOM节点内容时产生异常，从而使编辑器出现问题。（<a href='https://zhuanlan.zhihu.com/p/262209236' target='_blank'>详细分析可参考这篇文章</a>）

## 改动的目标

添加一个能替换原Editable组件的新组件，新组件能够避免上述问题，提高编辑器稳定性。

## 怎么改？

不使用contentEditable='true'的元素来获取用户输入，改使用“虚拟光标 + input”。
具体步骤详见下面“进度”。

## 进度

- [ ] 添加新的“NoEditable”组件；
- [ ] “NoEditable”组件去掉一些无用（新方案中）代码；
- [ ] 添加虚拟光标组件（VirtualCaret）；
- [ ] 添加VirtualInput组件，接受用户输入；
- [ ] “虚拟光标”上下移动；
- [ ] 拖动相关；

## 在线示例

## Slate

[Slate](https://github.com/ianstormtaylor/slate)
