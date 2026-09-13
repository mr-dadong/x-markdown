import assert from "node:assert/strict";
import { test } from "node:test";
import { hasMarkdownSyntax } from "./markdownDetector";

// 应识别为含 Markdown 语法（收到 md 源码的常见场景）
const mdPositiveCases: Array<[string, string]> = [
  ["标题", "# 一级标题"],
  ["二级标题", "## 二级标题\n\n正文。"],
  ["无序列表", "- 苹果\n- 香蕉\n- 橙子"],
  ["任务列表", "- [x] 已完成\n- [ ] 未完成"],
  ["有序列表", "1. 第一步\n2. 第二步"],
  ["引用块", "> 引用内容"],
  ["callout", "> [!NOTE] 提示\n> 第一行"],
  ["围栏代码", "```js\nconst a = 1;\n```"],
  ["表格", "| 名称 | 数量 |\n| --- | --- |\n| 苹果 | 3 |"],
  ["加粗", "这是 **加粗** 文本"],
  ["斜体-星号", "*斜体* 文本"],
  ["删除线", "~~删除~~"],
  ["高亮", "==高亮=="],
  ["行内代码", "使用 `npm install` 安装"],
  ["链接", "访问[官网](https://example.com)"],
  ["图片", "![封面](./cover.png)"],
  ["行内公式", "质能方程 $E = mc^2$"],
  ["块级公式", "$$\n\\int_0^1 x^2 dx\n$$"],
  ["脚注", "带脚注[^1]\n\n[^1]: 注记"],
  ["分割线", "上面\n\n---\n\n下面"],
  ["扩展块", ":::warning\n注意内容\n:::"],
];

// 应视为普通纯文本（不应误解析）
const mdNegativeCases: Array<[string, string]> = [
  ["普通句子", "这是一个普通的句子。"],
  ["英文作品", "Unit not found"],
  ["systemd 单元", "[Unit]\nDescription=My service"],
  ["路径", "C:\\Users\\xu\\Documents"],
  ["数学乘号", "2 x 3 = 6"],
  ["单词内星号", "a*b*c"],
  ["Windows 通配符", "*.txt"],
  ["文件名带括号", "report(v2).docx"],
  ["单层无序项", "- 只有一项"],
  ["单个星号", "价格 $5 起"],
  ["普通多行", "第一行\n第二行\n第三行"],
  ["空串", ""],
  ["纯空白", "   \n  "],
];

for (const [name, source] of mdPositiveCases) {
  test(`识别：${name}`, () => {
    assert.equal(hasMarkdownSyntax(source), true, `应识别 ${name} 为 Markdown`);
  });
}

for (const [name, source] of mdNegativeCases) {
  test(`不误判：${name}`, () => {
    assert.equal(hasMarkdownSyntax(source), false, `${name} 不应视为 Markdown`);
  });
}