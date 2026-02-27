import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { htmlToMarkdown } from "./types";

// ---------------------------------------------------------------------------
// htmlToMarkdown — shared utility used primarily by the Confluence importer
// ---------------------------------------------------------------------------

describe("htmlToMarkdown headings", () => {
  it("converts h1", () => {
    assert.ok(htmlToMarkdown("<h1>Hello World</h1>").includes("# Hello World"));
  });

  it("converts h2", () => {
    assert.ok(htmlToMarkdown("<h2>Section</h2>").includes("## Section"));
  });

  it("converts h3", () => {
    assert.ok(htmlToMarkdown("<h3>Sub</h3>").includes("### Sub"));
  });

  it("converts h4", () => {
    assert.ok(htmlToMarkdown("<h4>Deep</h4>").includes("#### Deep"));
  });

  it("converts h5 and h6 to #####", () => {
    assert.ok(htmlToMarkdown("<h5>Small</h5>").includes("##### Small"));
    assert.ok(htmlToMarkdown("<h6>Tiny</h6>").includes("##### Tiny"));
  });
});

describe("htmlToMarkdown paragraphs and breaks", () => {
  it("converts <p> tags to content with newlines", () => {
    const result = htmlToMarkdown("<p>First</p><p>Second</p>");
    assert.ok(result.includes("First") && result.includes("Second"));
  });

  it("converts <br> to newline", () => {
    const result = htmlToMarkdown("Line 1<br/>Line 2");
    assert.ok(result.includes("Line 1"));
    assert.ok(result.includes("Line 2"));
  });
});

describe("htmlToMarkdown lists", () => {
  it("converts unordered lists", () => {
    const result = htmlToMarkdown("<ul><li>Item A</li><li>Item B</li></ul>");
    assert.ok(result.includes("- Item A"));
    assert.ok(result.includes("- Item B"));
  });

  it("converts ordered lists to bullet items", () => {
    const result = htmlToMarkdown("<ol><li>First</li><li>Second</li></ol>");
    assert.ok(result.includes("- First"));
    assert.ok(result.includes("- Second"));
  });
});

describe("htmlToMarkdown code", () => {
  it("converts inline code", () => {
    const result = htmlToMarkdown("Run <code>npm install</code> first");
    assert.ok(result.includes("`npm install`"));
  });

  it("converts pre/code blocks", () => {
    const result = htmlToMarkdown("<pre><code>const x = 1;\n</code></pre>");
    assert.ok(result.includes("```"));
    assert.ok(result.includes("const x = 1;"));
  });

  it("converts bare pre blocks", () => {
    const result = htmlToMarkdown("<pre>raw text</pre>");
    assert.ok(result.includes("```"));
    assert.ok(result.includes("raw text"));
  });
});

describe("htmlToMarkdown inline formatting", () => {
  it("converts <strong> to bold", () => {
    assert.ok(htmlToMarkdown("<strong>Bold</strong>").includes("**Bold**"));
  });

  it("converts <b> to bold", () => {
    assert.ok(htmlToMarkdown("<b>Also bold</b>").includes("**Also bold**"));
  });

  it("converts <em> to italic", () => {
    assert.ok(htmlToMarkdown("<em>Italic</em>").includes("_Italic_"));
  });

  it("converts <i> to italic", () => {
    assert.ok(htmlToMarkdown("<i>Also italic</i>").includes("_Also italic_"));
  });
});

describe("htmlToMarkdown links", () => {
  it("converts links with href and text", () => {
    const result = htmlToMarkdown('<a href="https://example.com">Click here</a>');
    assert.ok(result.includes("[Click here](https://example.com)"));
  });
});

describe("htmlToMarkdown HTML entities", () => {
  it("decodes &amp;", () => {
    assert.ok(htmlToMarkdown("Tom &amp; Jerry").includes("Tom & Jerry"));
  });

  it("decodes &lt; and &gt;", () => {
    assert.ok(htmlToMarkdown("a &lt; b &gt; c").includes("a < b > c"));
  });

  it("decodes &quot;", () => {
    assert.ok(htmlToMarkdown("say &quot;hello&quot;").includes('say "hello"'));
  });

  it("decodes &nbsp; to space", () => {
    assert.ok(htmlToMarkdown("hello&nbsp;world").includes("hello world"));
  });

  it("decodes numeric entities", () => {
    assert.ok(htmlToMarkdown("&#65;").includes("A"));
  });
});

describe("htmlToMarkdown unwanted element removal", () => {
  it("removes <script> blocks", () => {
    const result = htmlToMarkdown("<p>content</p><script>alert('xss')</script>");
    assert.ok(!result.includes("alert"));
    assert.ok(result.includes("content"));
  });

  it("removes <style> blocks", () => {
    const result = htmlToMarkdown("<style>body { color: red }</style><p>text</p>");
    assert.ok(!result.includes("color: red"));
    assert.ok(result.includes("text"));
  });

  it("removes <nav> blocks", () => {
    const result = htmlToMarkdown("<nav><a href='/'>Home</a></nav><p>Page content</p>");
    assert.ok(!result.includes("Home"));
    assert.ok(result.includes("Page content"));
  });
});

describe("htmlToMarkdown misc", () => {
  it("converts <hr> to ---", () => {
    assert.ok(htmlToMarkdown("<hr/>").includes("---"));
  });

  it("collapses 3+ blank lines to at most 2", () => {
    const result = htmlToMarkdown("<p>A</p>\n\n\n\n<p>B</p>");
    assert.ok(!/\n{3,}/.test(result), "should not have 3+ consecutive newlines");
  });

  it("trims leading and trailing whitespace", () => {
    const result = htmlToMarkdown("  <p>Hello</p>  ");
    assert.equal(result, result.trim());
  });

  it("handles nested tags in headings", () => {
    const result = htmlToMarkdown("<h2><strong>Bold heading</strong></h2>");
    assert.ok(result.includes("## Bold heading"));
  });

  it("handles empty input", () => {
    assert.equal(htmlToMarkdown(""), "");
  });
});
