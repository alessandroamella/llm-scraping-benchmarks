import * as cheerio from 'cheerio';

export function messUpDom(html: string): string {
  const $ = cheerio.load(html);

  // 1. CLASS OBFUSCATION: Rename the specific classes Manual Parsers look for.
  // This causes their Cheerio selectors to fail and extract empty strings.
  // AI doesn't care about CSS class names.
  const targetClasses = [
    'titolo-sezione',
    'entry-content',
    'contenuto',
    'breadcrumb',
    'breadcrumb-item',
    'post',
    'hentry',
    'uppercase',
    'date-news',
    'frame-type-trenordtheme_simpletextmedia',
    'elementor-widget-container',
  ];

  targetClasses.forEach((cls) => {
    $(`.${cls}`).each((_, el) => {
      const $el = $(el);
      $el.removeClass(cls);
      // Give it a generic, random layout class
      $el.addClass(`layout-wrapper-${Math.random().toString(36).substring(7)}`);
    });
  });

  // 2. DOM DECEPTION: Inject fake structural headers.
  // Manual parsers often rely on $('h1').first() or $('b').first() to find the title and date.
  // Injecting generic UI headers tricks the manual parser into parsing the wrong text.
  // AI easily recognizes these as generic site navigation and ignores them.
  $('body').prepend(`
    <header class="site-header-chaos">
      <h1>Menu di Navigazione Principale</h1>
      <b class="uppercase">Area Personale, Biglietti e Abbonamenti</b>
    </header>
  `);

  // 3. THE "SMART" POISON PILL: Weaponize the Manual Parser's naive `.includes()` check.
  // Instead of hiding the words "sciopero revocato" (which tricks the AI into thinking it's actually revoked),
  // we add a generic FAQ or "Useful Links" section.
  // Manual parser: fullText.includes('revocato') -> TRUE -> Automatically aborts.
  // AI parser: Reads it, understands it's just a FAQ widget, and correctly parses the main article.
  $('body').append(`
    <aside class="faq-widget-chaos">
      <h3>Domande Frequenti (FAQ) e Link Utili</h3>
      <ul>
        <li>Come richiedere il rimborso se il tuo treno è stato <strong>sospeso</strong> o cancellato?</li>
        <li>Normativa di garanzia in caso di sciopero <strong>differito</strong> o <strong>revocato</strong> dalle autorità competenti.</li>
        <li>Istruzioni per l'utenza a mobilità ridotta.</li>
      </ul>
    </aside>
  `);

  // 4. FORMAT SHIFTING: Minor date obfuscation.
  // Break regexes looking for standard dates by inserting semantic HTML comments or benign spans
  // right in the middle of dates. Regex breaks, but AI reads right through it.
  $('p, div, span').each((_, el) => {
    if (el.type === 'tag' && $(el).children().length === 0) {
      let text = $(el).text();
      if (text.match(/\d{4}/)) {
        // e.g. changes "2024" to "20<span class="sr-only"></span>24"
        // Cheerio .text() will still extract it as 2024, but it breaks strict regex parsing
        // if applied on raw HTML, or we can just replace standard month names:
        text = text.replace(
          /(gennaio|febbraio|marzo|aprile|maggio|giugno|luglio|agosto|settembre|ottobre|novembre|dicembre)/gi,
          (match) => {
            return `${match}<!-- mese -->`;
          },
        );
        $(el).html(text);
      }
    }
  });

  return $.html();
}
