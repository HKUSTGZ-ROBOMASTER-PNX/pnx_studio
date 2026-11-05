import test from 'node:test';
import assert from 'node:assert/strict';
import { highlightLine, escapeHtml } from '../renderer/js/lib/highlight.js';
import { hex, parseNumber, formatValue } from '../renderer/js/lib/dom.js';

test('highlighter tags keywords, numbers, strings and comments', () => {
  const { html, inComment } = highlightLine('static int x = 0x10; // note', false);
  assert.match(html, /<span class="syn-kw">static<\/span>/);
  assert.match(html, /<span class="syn-num">0x10<\/span>/);
  assert.match(html, /<span class="syn-com">\/\/ note<\/span>/);
  assert.equal(inComment, false);
});

test('highlighter carries block comments across lines and escapes html', () => {
  const first = highlightLine('a = 1; /* start <b>', false);
  assert.equal(first.inComment, true);
  assert.match(first.html, /&lt;b&gt;/);
  const second = highlightLine('still */ b', true);
  assert.equal(second.inComment, false);
  assert.match(second.html, /<span class="id">b<\/span>/);
  assert.equal(escapeHtml('"<&>"'), '&quot;&lt;&amp;&gt;&quot;');
});

test('preprocessor lines and strings', () => {
  const { html } = highlightLine('#include "main.h"', false);
  assert.match(html, /syn-pp/);
  assert.match(html, /<span class="syn-str">&quot;main.h&quot;<\/span>|<span class="syn-str">"main.h"<\/span>/);
});

test('number helpers', () => {
  assert.equal(hex(255, 4), '0x00FF');
  assert.equal(hex(-1, 8), '0xFFFFFFFF');
  assert.equal(parseNumber('0x20000000'), 0x20000000);
  assert.equal(parseNumber('-0x10'), -16);
  assert.equal(parseNumber('0b101'), 5);
  assert.equal(parseNumber('1_000'), 1000);
  assert.equal(parseNumber('abc'), null);
  assert.equal(formatValue(0.000012345), '1.234e-5');
  assert.equal(formatValue(3), '3');
});
