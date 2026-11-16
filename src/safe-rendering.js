(function initializeSafeRendering(root, factory) {
  const rules = typeof module === 'object' && module.exports
    ? require('../shared/expression-rules')
    : root.ExpressionRules;
  const api = factory(rules);

  if (typeof module === 'object' && module.exports) {
    module.exports = api;
  } else {
    root.SafeRendering = api;
  }
})(typeof globalThis !== 'undefined' ? globalThis : this, (rules) => {
  'use strict';

  if (!rules) throw new Error('Expression rules are required');
  const categories = [['filler','填充词'],['hedge','犹豫词'],['vague','笼统词']];
  const wordKinds = new Map();
  [rules.FILLER_WORDS,rules.HEDGE_WORDS,Object.keys(rules.VAGUE_TO_PRECISE)].forEach((words,index)=>{
    for (const word of words) wordKinds.set(word,(wordKinds.get(word)||0)|(1<<index));
  });

  function escapeRegExp(text) {
    return text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  }

  const wordPattern = new RegExp([...wordKinds.keys()].sort((a,b)=>b.length-a.length).map(escapeRegExp).join('|'),'g');

  function* matchSubtitleWords(text) {
    for (const match of text.matchAll(wordPattern)) {
      yield {start:match.index,end:match.index+match[0].length,kinds:wordKinds.get(match[0])};
    }
  }

  function tokenizeHighlightedText(text,matches) {
    const input = String(text ?? '');
    const tokens = [];
    let cursor = 0;
    for (const {start,end,kinds} of matches ?? matchSubtitleWords(input)) {
      if (start > cursor) tokens.push({type:'text',text:input.slice(cursor,start)});
      const types = categories.filter((_,index)=>kinds & (1<<index)).map(([type])=>type);
      tokens.push({type:types.length===1?types[0]:'multiple',text:input.slice(start,end),
        ...(types.length>1?{kinds}:{})});
      cursor = end;
    }
    if (cursor < input.length) tokens.push({type:'text',text:input.slice(cursor)});
    return tokens;
  }

  function renderHighlightedText(container, text, matches) {
    const document = container.ownerDocument;
    container.replaceChildren();

    for (const token of tokenizeHighlightedText(text,matches)) {
      if (token.type === 'text') {
        container.appendChild(document.createTextNode(token.text));
        continue;
      }

      const mark = document.createElement('mark');
      mark.className = token.type;
      const labels = categories.filter(([type],index)=>token.kinds ? token.kinds & (1<<index) : token.type===type);
      mark.title = labels.map(([,label])=>label).join('、')+' · 词表命中，需结合语境判断';
      mark.appendChild(document.createTextNode(token.text));
      container.appendChild(mark);
    }
  }

  function tokenizeInlineMarkdown(text) {
    const input = String(text ?? '');
    const pattern = /(\*\*[^*\n]+\*\*|`[^`\n]+`)/g;
    const tokens = [];
    let cursor = 0;

    for (const match of input.matchAll(pattern)) {
      if (match.index > cursor) {
        tokens.push({ type: 'text', text: input.slice(cursor, match.index) });
      }
      if (match[0].startsWith('**')) {
        tokens.push({ type: 'strong', text: match[0].slice(2, -2) });
      } else {
        tokens.push({ type: 'code', text: match[0].slice(1, -1) });
      }
      cursor = match.index + match[0].length;
    }

    if (cursor < input.length) {
      tokens.push({ type: 'text', text: input.slice(cursor) });
    }
    return tokens;
  }

  function appendInlineMarkdown(document, container, text) {
    for (const token of tokenizeInlineMarkdown(text)) {
      if (token.type === 'text') {
        container.appendChild(document.createTextNode(token.text));
        continue;
      }

      const element = document.createElement(token.type);
      element.appendChild(document.createTextNode(token.text));
      container.appendChild(element);
    }
  }

  function renderReportContent(container, report) {
    const document = container.ownerDocument;
    const lines = String(report ?? '').replace(/\r\n?/g, '\n').split('\n');
    container.replaceChildren();

    for (const line of lines) {
      let tagName = 'div';
      let content = line;

      if (line.startsWith('### ')) {
        tagName = 'h3';
        content = line.slice(4);
      } else if (line.startsWith('## ')) {
        tagName = 'h2';
        content = line.slice(3);
      } else if (line.startsWith('> ')) {
        tagName = 'blockquote';
        content = line.slice(2);
      } else if (line === '') {
        container.appendChild(document.createElement('br'));
        continue;
      }

      const block = document.createElement(tagName);
      appendInlineMarkdown(document, block, content);
      container.appendChild(block);
    }
  }

  return {
    renderHighlightedText,
    renderReportContent,
    tokenizeHighlightedText
  };
});
