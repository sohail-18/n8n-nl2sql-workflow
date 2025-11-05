// 导入 markdown-it 和 highlight.js（ESM）
import MarkdownIt from 'markdown-it';
import hljs from 'highlight.js';

// 创建 markdown-it 实例
const md = new MarkdownIt({
  html: false,
  linkify: true,
  typographer: true,
  highlight: function (code, lang) {
    if (lang && hljs.getLanguage(lang)) {
      return `<pre class="hljs"><code>${hljs.highlight(code, { language: lang }).value}</code></pre>`;
    }
    return `<pre class="hljs"><code>${hljs.highlightAuto(code).value}</code></pre>`;
  }
});

// 示例 Markdown 文本
const markdown = `
# Hello Markdown-it 👋\n\n**加粗**、*斜体*、\`行内代码\`\n\n\`\`\`js\nconsole.log("Hello World!");\n\`\`\`\n\n> 支持语法高亮
`;

const html = md.render(markdown);
console.log(html);