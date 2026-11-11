// Script HTML cleanup. Everything (Google Docs pastes, stored content, editor output)
// goes through one intermediate form — a list of blocks with formatted text runs — and
// comes back out as HTML limited to: p, br, strong, em, u, ul, ol, li.

const BLOCK_TAGS = new Set([
  'P', 'DIV', 'H1', 'H2', 'H3', 'H4', 'H5', 'H6', 'BLOCKQUOTE', 'PRE', 'TABLE', 'THEAD',
  'TBODY', 'TFOOT', 'TR', 'TD', 'TH', 'CAPTION', 'SECTION', 'ARTICLE', 'HEADER', 'FOOTER',
  'MAIN', 'ASIDE', 'NAV', 'DL', 'DT', 'DD', 'FIGURE', 'FIGCAPTION', 'ADDRESS',
]);
const SKIP_TAGS = new Set([
  'SCRIPT', 'STYLE', 'HEAD', 'TITLE', 'META', 'LINK', 'IMG', 'SVG', 'VIDEO', 'AUDIO', 'IFRAME',
  'OBJECT', 'EMBED', 'CANVAS', 'NOSCRIPT', 'TEMPLATE', 'BUTTON', 'INPUT', 'SELECT', 'TEXTAREA',
  'HR', 'PICTURE', 'SOURCE', 'MATH',
]);
const MAX_LEVEL = 8;

/**
 * Block: { type: 'p' | 'li', listType?: 'ul' | 'ol', level?: number, runs: Run[] }
 * Run:   { text, b, i, u } or { br: true }
 */
export function htmlToBlocks(html) {
  const doc = new DOMParser().parseFromString(`<!doctype html><body>${html || ''}</body>`, 'text/html');
  const blocks = [];
  let cur = null;

  const flush = () => {
    if (cur) blocks.push(cur);
    cur = null;
  };

  function marksFor(el, parent, inLink) {
    let { b, i, u } = parent;
    const tag = el.tagName;
    if (tag === 'B' || tag === 'STRONG') b = true;
    if (tag === 'I' || tag === 'EM' || tag === 'CITE') i = true;
    if (tag === 'U' || tag === 'INS') u = true;
    const st = el.style;
    if (st) {
      const fw = st.fontWeight;
      if (fw) {
        const n = parseInt(fw, 10);
        if (fw === 'bold' || fw === 'bolder' || n >= 600) b = true;
        else if (fw === 'normal' || fw === 'lighter' || n < 600) b = false; // Docs' outer <b style="font-weight:normal">
      }
      if (st.fontStyle) i = st.fontStyle === 'italic' || st.fontStyle === 'oblique';
      const td = `${st.textDecorationLine || ''} ${st.textDecoration || ''}`;
      // Docs styles links as underlined; links become plain text.
      if (td.includes('underline') && !inLink) u = true;
    }
    return { b, i, u };
  }

  function walkChildren(node, marks, ctx) {
    for (const child of node.childNodes) walk(child, marks, ctx);
  }

  function walk(node, marks, ctx) {
    if (node.nodeType === Node.TEXT_NODE) {
      const text = node.nodeValue.replace(/ /g, ' ').replace(/[ \t\n\r\f]+/g, ' ');
      if (!text) return;
      if (!cur && !text.trim()) return; // whitespace between blocks
      if (!cur) cur = { type: 'p', runs: [] };
      cur.runs.push({ text, b: marks.b, i: marks.i, u: marks.u });
      return;
    }
    if (node.nodeType !== Node.ELEMENT_NODE) return;
    const tag = node.tagName;
    if (SKIP_TAGS.has(tag)) return;

    if (tag === 'BR') {
      if (node.classList.contains('Apple-interchange-newline')) return; // copy artifact, not content
      if (cur) cur.runs.push({ br: true });
      else blocks.push({ type: 'p', runs: [] }); // a bare <br> between blocks is a blank line
      return;
    }

    const inLink = ctx.inLink || tag === 'A';
    const m = marksFor(node, marks, inLink);
    const nextCtx = inLink !== ctx.inLink ? { ...ctx, inLink } : ctx;

    if (tag === 'UL' || tag === 'OL') {
      flush();
      walkChildren(node, m, { ...nextCtx, level: (ctx.level || 0) + 1, listType: tag.toLowerCase(), inLi: false });
      flush();
      return;
    }

    if (tag === 'LI') {
      flush();
      const aria = parseInt(node.getAttribute('aria-level'), 10); // Google Docs nesting hint
      const level = Math.min(MAX_LEVEL, aria > 0 ? aria : ctx.level || 1);
      cur = { type: 'li', listType: ctx.listType || 'ul', level, runs: [] };
      walkChildren(node, m, { ...nextCtx, level, inLi: true });
      flush();
      return;
    }

    if (BLOCK_TAGS.has(tag)) {
      // Docs wraps list item text in <p>: keep it inside the list item.
      if (ctx.inLi && cur && cur.type === 'li') {
        if (cur.runs.length) cur.runs.push({ br: true });
        walkChildren(node, m, nextCtx);
        return;
      }
      // An empty block that is still open here is a wrapper (div, table, tr…) around
      // this one, not a blank line: drop it instead of emitting an empty paragraph.
      if (cur && cur.fromBlock && cur.runs.length === 0) cur = null;
      flush();
      cur = { type: 'p', runs: [], fromBlock: true };
      const isHeading = /^H[1-6]$/.test(tag);
      walkChildren(node, m, { ...nextCtx, inLi: false });
      if (isHeading && cur) for (const r of cur.runs) if (!r.br) r.b = true; // headings → bold paragraphs
      flush();
      return;
    }

    walkChildren(node, m, nextCtx); // inline element: keep its text and marks only
  }

  walkChildren(doc.body, { b: false, i: false, u: false }, { level: 0, inLi: false, inLink: false });
  flush();
  return blocks.map(({ fromBlock, ...b }) => tidyBlock(b));
}

function tidyBlock(block) {
  const runs = block.runs.slice();
  while (runs.length && runs[runs.length - 1].br) runs.pop(); // trailing <br> is an editor artifact
  // Trim outer whitespace.
  const firstText = runs.find((r) => !r.br);
  if (firstText) firstText.text = firstText.text.replace(/^ +/, '');
  for (let k = runs.length - 1; k >= 0; k--) {
    if (!runs[k].br) {
      runs[k].text = runs[k].text.replace(/ +$/, '');
      break;
    }
  }
  const merged = [];
  for (const r of runs) {
    if (!r.br && !r.text) continue;
    const prev = merged[merged.length - 1];
    if (prev && !prev.br && !r.br && prev.b === r.b && prev.i === r.i && prev.u === r.u) {
      prev.text += r.text;
    } else {
      merged.push({ ...r });
    }
  }
  return { ...block, runs: merged };
}

function escapeHtml(s) {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

function runsToHtml(runs) {
  let out = '';
  for (const r of runs) {
    if (r.br) {
      out += '<br>';
      continue;
    }
    let s = escapeHtml(r.text);
    if (r.u) s = `<u>${s}</u>`;
    if (r.i) s = `<em>${s}</em>`;
    if (r.b) s = `<strong>${s}</strong>`;
    out += s;
  }
  return out || '<br>';
}

export function blocksToHtml(blocks) {
  let out = '';
  const stack = []; // open lists: { type, liOpen }

  const closeTop = () => {
    const top = stack.pop();
    if (top.liOpen) out += '</li>';
    out += `</${top.type}>`;
  };

  for (const b of blocks) {
    if (b.type === 'li') {
      const level = Math.max(1, Math.min(MAX_LEVEL, b.level || 1));
      const type = b.listType === 'ol' ? 'ol' : 'ul';
      while (stack.length > level) closeTop();
      if (stack.length === level && stack[level - 1].type !== type) closeTop();
      while (stack.length < level) {
        const top = stack[stack.length - 1];
        if (top && !top.liOpen) {
          out += '<li>';
          top.liOpen = true;
        }
        out += `<${type}>`;
        stack.push({ type, liOpen: false });
      }
      const top = stack[level - 1];
      if (top.liOpen) out += '</li>';
      out += `<li>${runsToHtml(b.runs)}`;
      top.liOpen = true;
    } else {
      while (stack.length) closeTop();
      out += `<p>${runsToHtml(b.runs)}</p>`;
    }
  }
  while (stack.length) closeTop();
  return out;
}

/** Clean any HTML down to the allowed tags. Idempotent. */
export function sanitizeHtml(html) {
  return blocksToHtml(htmlToBlocks(html));
}

/** Plain text, for search. */
export function htmlToText(html) {
  return htmlToBlocks(html)
    .map((b) => b.runs.map((r) => (r.br ? ' ' : r.text)).join(''))
    .join('\n');
}
