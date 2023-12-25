<h1 align='center'>Add virtual caret to "slate-react"</h1>
<p  align='center'><a href='./Readme.md'>中文</a> | English</p>
<p  align='center'>
<a href='https://lin150.fun/spa/slate-virtual-cursor-demo/examples/virtual-cursor' target='_blank'>Online Examples</a> ·
<a href='#Why ?'>Why ?</a> ·
<a href='#How ？'>How ？</a> ·
<a href='#Goal'>Goal</a> ·
<a href='#Progress'>Progress</a>

</p>

## Why？

1. Due to some existing issues with the current framework:
<ul>
<li><a href='https://changlin-cn.github.io/some-problems/baiduIME.html' target="_blank">When using certain input methods to enter content, abnormalities occur when trying to control the cursor position </a>(this may be a problem with the input method, but to the user, it may appear as an issue with the framework);</li>
<li>
During input using an input method, the user may suddenly encounter a white screen, and the console displays the following errors:
<ul>
<li>Failed to execute 'insertBefore' on 'Node': The node before which the new node is to be inserted is not a child of this node；</li>
</li>
<li>Cannot resolve a DOM point from Slate point: xxxxxx；</li>
</ul>
</li>
<li><a href='https://github.com/ianstormtaylor/slate/issues?q=is%3Aissue+is%3Aopen+IME' target="_blank">There are still many open issues related to input methods in the official framework repository;</a></li>
</ul>

2. When trying to implement a feature similar to Word's track changes mode on the current framework, you may find it challenging due to issues with input methods;

3. Although the aforementioned problems can be mitigated using 'ErrorBoundary' for exception recovery, they cannot be completely resolved. The root cause of the issue is that when using elements with contentEditable='true' for input, if the cursor selection is expanded, the content within the selection will be deleted during input. This behavior cannot be prevented with JavaScript, leading to exceptions when React updates the DOM node content, causing problems with the editor. (For a detailed analysis, please refer to this article.)

## Goal

To add a new component that can replace the original Editable component, which avoids the aforementioned issues and improves editor stability.

## How ？

Instead of using elements with contentEditable='true' to capture user input, we will use a "virtual cursor + input" approach. Specific steps are outlined below in "Progress".

## Progress

- [ ] Add a new "NoEditable" component;
- [ ] Remove unnecessary code from the "NoEditable" component (according to the new solution);
- [ ] Add a VirtualCaret component;
- [ ] Add a VirtualInput component to accept user input;
- [ ] Implement vertical movement of the "virtual cursor";
- [ ] Implement drag-related functionalities;

## Online Examples

## Slate

[Slate](https://github.com/ianstormtaylor/slate)
