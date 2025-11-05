const md = window.markdownit({
  html: false,
  linkify: true,
  typographer: true,
  highlight(code, lang) {
    try {
      const highlightJs = window.hljs;
      if (lang && highlightJs && highlightJs.getLanguage(lang)) {
        return `<pre class="hljs"><code>${highlightJs.highlight(code, { language: lang }).value}</code></pre>`;
      }
      if (highlightJs) {
        return `<pre class="hljs"><code>${highlightJs.highlightAuto(code).value}</code></pre>`;
      }
      return `<pre class="hljs"><code>${code}</code></pre>`;
    } catch (error) {
      return `<pre class="hljs"><code>${code}</code></pre>`;
    }
  }
});

export default md;
