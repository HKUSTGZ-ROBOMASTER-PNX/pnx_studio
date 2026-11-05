// Line-oriented C/C++/Rust/asm syntax highlighter producing escaped HTML.

const KEYWORDS = new Set(('auto break case char const continue default do double else enum extern float for goto if inline int long register restrict return short signed sizeof static struct switch typedef union unsigned void volatile while bool true false nullptr class namespace template typename public private protected virtual override constexpr static_assert using new delete this operator try catch throw noexcept explicit friend mutable '
  + 'fn let mut impl pub use mod trait where match loop as ref self Self crate super dyn unsafe async await move').split(' '));
const TOKEN = /(\/\/.*)|(\/\*)|("(?:\\.|[^"\\])*"?|'(?:\\.|[^'\\])*'?)|(\b0[xX][0-9a-fA-F]+[uUlL]*\b|\b\d+(?:\.\d*)?(?:[eE][+-]?\d+)?[uUlLfF]*\b)|([A-Za-z_]\w*)/g;

export function escapeHtml(text) { return text.replace(/[&<>"]/g, ch => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[ch]); }

/** Returns html for one line, plus whether a block comment is still open at its end. */
export function highlightLine(line, inComment) {
  let html = '', index = 0;
  if (inComment) {
    const end = line.indexOf('*/');
    if (end < 0) return { html: `<span class="syn-com">${escapeHtml(line)}</span>`, inComment: true };
    html += `<span class="syn-com">${escapeHtml(line.slice(0, end + 2))}</span>`;
    index = end + 2;
  }
  if (/^\s*#\s*\w+/.test(line) && index === 0) {
    const match = /^(\s*#\s*\w+)/.exec(line);
    html += `<span class="syn-pp">${escapeHtml(match[1])}</span>`;
    index = match[1].length;
  }
  TOKEN.lastIndex = index;
  let match;
  while ((match = TOKEN.exec(line))) {
    html += escapeHtml(line.slice(index, match.index));
    const [text, lineComment, blockStart, string, number, ident] = match;
    if (lineComment) html += `<span class="syn-com">${escapeHtml(text)}</span>`;
    else if (blockStart) {
      const end = line.indexOf('*/', match.index + 2);
      if (end < 0) { html += `<span class="syn-com">${escapeHtml(line.slice(match.index))}</span>`; return { html, inComment: true }; }
      html += `<span class="syn-com">${escapeHtml(line.slice(match.index, end + 2))}</span>`;
      TOKEN.lastIndex = end + 2;
      index = end + 2;
      continue;
    } else if (string) html += `<span class="syn-str">${escapeHtml(text)}</span>`;
    else if (number) html += `<span class="syn-num">${text}</span>`;
    else if (ident) {
      const cls = KEYWORDS.has(ident) ? 'syn-kw' : /_t$|^[A-Z][A-Za-z0-9]*_TypeDef$|^__[IO]+$/.test(ident) ? 'syn-type' : 'id';
      html += `<span class="${cls}">${ident}</span>`;
    }
    index = TOKEN.lastIndex;
  }
  html += escapeHtml(line.slice(index));
  return { html: html || ' ', inComment: false };
}
