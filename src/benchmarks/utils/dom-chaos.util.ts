/** biome-ignore-all lint/suspicious/noExplicitAny: easier */

import * as cheerio from 'cheerio';

export function messUpDom(html: string): string {
  const $ = cheerio.load(html);

  // 1. TEXT OBFUSCATION: Recursive Zero-Width Space (ZWSP) Injection
  // We use text node traversal. This fixes the bug where text alongside nested tags was ignored.
  // Breaks parser regexes for dates, times, and exact keyword matches.
  const zwsPatterns = [
    /(sciopero)/gi,
    /(gennaio|febbraio|marzo|aprile|maggio|giugno|luglio|agosto|settembre|ottobre|novembre|dicembre)/gi,
    /(\d{1,2})\/(\d{1,2})\/(\d{4})/g, // Numeric dates
    /(24\s*ore|24\s*h|intera\s*giornata)/gi, // 24h checks
    /(dalle\s+(?:ore\s+)?\d{1,2}[:.]\d{2})/gi, // Time extraction regex
    /(4\s*ore|2\s*ore|ridotto\s*a)/gi,
  ];

  function walkTextNodes(node: any) {
    if (node.type === 'text' && node.data) {
      let text = node.data;
      zwsPatterns.forEach((pattern) => {
        text = text.replace(pattern, (match) => {
          const mid = Math.floor(match.length / 2);
          return `${match.slice(0, mid)}\u200B${match.slice(mid)}`;
        });
      });
      node.data = text;
    } else if (node.type === 'tag' && node.children) {
      node.children.forEach(walkTextNodes);
    }
  }

  // Apply ZWSP everywhere
  $('body, head').each((_, el) => walkTextNodes(el));

  // 2. OBFUSCATION: Rename the specific classes EavManualParser looks for
  const targetClasses = [
    'titolo-sezione',
    'entry-content',
    'contenuto',
    'breadcrumb',
    'breadcrumb-item',
    'post',
    'hentry',
  ];

  targetClasses.forEach((cls) => {
    $(`.${cls}`).each((_, el) => {
      const $el = $(el);
      $el.removeClass(cls);
      $el.addClass(`css-${Math.random().toString(36).substring(7)}`);
    });
  });

  // 3. SEMANTIC DESTRUCTION: Neutralize specific targeted tags
  // Replaces tags to break $('h1, h2, title, p, li') while PRESERVING visual styling attributes
  const tagsToNuke = ['h1', 'h2', 'title', 'p', 'li', 'ul'];

  tagsToNuke.forEach((tagName) => {
    $(tagName).each((_, el) => {
      const $el = $(el);
      const content = $el.html() || '';

      // Convert block elements to div, inline elements to span
      const newTag = ['p', 'h1', 'h2', 'ul', 'li'].includes(tagName)
        ? 'div'
        : 'span';

      // Preserve all attributes (styles, classes, dataset) to maintain visual appearance
      const attribs = (el as any).attribs || {};
      const attrString = Object.entries(attribs)
        .map(([k, v]) => `${k}="${v}"`)
        .join(' ');

      $el.replaceWith(
        `<${newTag} ${attrString} data-obf="${tagName}">${content}</${newTag}>`,
      );
    });
  });

  // 4. THE POISON PILL: Weaponize the Parser's own filtering logic against it.
  // Because cheerio doesn't process CSS, the parser will extract this hidden text.
  // The parser specifically aborts if fullText includes 'revocato', 'sospeso', or 'differito'.
  // We recreate the exact classes the parser looks for, loaded with those keywords.
  $('body').append(`
    <!-- Anti-Parser Trap: Visually hidden but structurally perfect for Cheerio -->
    <div class="titolo-sezione" style="display: none !important; opacity: 0; position: absolute; left: -9999px; height: 0; width: 0; pointer-events: none;" aria-hidden="true">
      <h2>sciopero revocato</h2>
    </div>
    <div class="entry-content" style="display: none !important; opacity: 0; position: absolute; left: -9999px; height: 0; width: 0; pointer-events: none;" aria-hidden="true">
      <p>sciopero sospeso differito</p>
    </div>
  `);

  return $.html();
}
