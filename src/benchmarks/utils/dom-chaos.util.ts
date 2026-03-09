import * as cheerio from 'cheerio';

export function messUpDom(html: string): string {
  const $ = cheerio.load(html);

  // OBFUSCATION: Rinomina le classi chiave usate dagli scraper manuali
  const targetClasses = [
    // Trenord
    'uppercase',
    'date-news',
    'frame-type-trenordtheme_simpletextmedia',
    'date',
    'news',

    // ATAC
    'elementor-widget-container',
    'elementor',
    'titolo-sezione',
    'entry-content',
    'contenuto',
  ];

  targetClasses.forEach((cls) => {
    $(`.${cls}`).each((_, el) => {
      const $el = $(el);
      $el.removeClass(cls);
      // Aggiungi una classe randomica stile CSS modules o Tailwind minificato
      $el.addClass(`css-${Math.random().toString(36).substring(7)}`);
    });
  });

  // SEMANTIC DESTRUCTION: Cambia tag specifici in generici
  // Lo scraper cerca: b, strong, h4, p, li
  const tagsToNuke = [
    'h1',
    'h2',
    'b',
    'strong',
    'h4',
    'h3',
    'p',
    'li',
    'ul',
    'main',
    'article',
    'section',
  ];

  tagsToNuke.forEach((tagName) => {
    $(tagName).each((_, el) => {
      const $el = $(el);
      const content = $el.html() || '';
      // Sostituisci con un div o span generico
      const newTag = Math.random() > 0.5 ? 'div' : 'span';
      // Mantiene il contenuto ma perde il significato semantico del tag
      $el.replaceWith(
        `<${newTag} class="gen-box-${Math.floor(Math.random() * 100)}">${content}</${newTag}>`,
      );
    });
  });

  // NOISE INJECTION: Aggiungi attributi a caso ovunque per confondere regex pigre
  $('*').each((_, el) => {
    if (Math.random() > 0.7) {
      $(el).attr('data-react-id', Math.random().toString(36));
      $(el).attr('data-test-hook', 'generated-content');
    }
  });

  // WRAPPING: Avvolgi pezzi di testo in div inutili
  // (Questo rompe selettori tipo "p > text" diretti)
  $('div').each((_, el) => {
    const $el = $(el);
    if ($el.children().length === 0 && $el.text().trim().length > 0) {
      const text = $el.text();
      $el.html(`<span class="wrapper-z">${text}</span>`);
    }
  });

  return $.html();
}
