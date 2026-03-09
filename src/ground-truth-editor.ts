import fs from 'node:fs';
import path from 'node:path';
import * as cheerio from 'cheerio';
import { PDFParse } from 'pdf-parse';
import TurndownService from 'turndown';
import { gfm } from 'turndown-plugin-gfm';

// Load existing ground truth
import { groundTruth as initialGroundTruth } from './benchmarks/data/ground-truth';

// ⚠️ CHANGE THIS if your scraped HTML/PDF files are in a different directory
const RAW_FILES_BASE_DIR = path.join(process.cwd(), 'benchmarks/data');
const GROUND_TRUTH_PATH = path.join(
  process.cwd(),
  './benchmarks/data/ground-truth-NEW.ts',
);

const inMemoryData = { ...initialGroundTruth };

// ==========================================
// 1. Extraction Logic (Copied from your service)
// ==========================================
function applyDomDistillation(
  $: cheerio.CheerioAPI,
  sourceName: string,
): string {
  const contextParts: string[] = [];
  const pageTitle = $('title').text().trim();
  if (pageTitle) contextParts.push(`Page Title: ${pageTitle}`);

  let selectedHtml: string | null = null;

  if (sourceName === 'Trenord') {
    const dateNews = $('.date-news').text().trim();
    const headerTitle = $('.uppercase b').first().text().trim();
    if (dateNews) contextParts.push(`Date News: ${dateNews}`);
    if (headerTitle) contextParts.push(`Header: ${headerTitle}`);

    const fogliaNewsContainer = $('div.container-foglia-news');
    let contentElement = fogliaNewsContainer
      .find('div.container-content')
      .first();
    if (contentElement.length === 0) {
      contentElement = fogliaNewsContainer
        .find('.content')
        .filter(
          (_i, el) =>
            !($(el).attr('class')?.split(/\s+/) || []).some((cls) =>
              cls.startsWith('tn-'),
            ),
        );
    }
    if (contentElement.length === 0) {
      contentElement = $('.content').filter(
        (_i, el) =>
          !($(el).attr('class')?.split(/\s+/) || []).some((cls) =>
            cls.startsWith('tn-'),
          ),
      );
    }

    const bodyHtml = contentElement.html();
    if (bodyHtml) {
      const $content = cheerio.load(bodyHtml);
      $content('.social, svg').remove();
      $content('p').each((_, el) => {
        if (!$content(el).text().trim()) $content(el).remove();
      });
      selectedHtml = $content.html() || bodyHtml;
      const pdfHref = contentElement.find('a[href$=".pdf"]').attr('href');
      if (pdfHref)
        selectedHtml += `\n\n<div class="pdf-attachment">PDF Document Found: ${pdfHref}</div>\n`;
    }
  } else if (sourceName === 'Trenitalia') {
    const breadcrumbs = $('.breadcrumb, .breadCrumb')
      .text()
      .replace(/\s+/g, ' ')
      .trim();
    if (breadcrumbs) contextParts.push(`Breadcrumbs: ${breadcrumbs}`);
    const articleContainers = $('.article');
    if (articleContainers.length === 0) {
      selectedHtml = $('body').html();
    } else {
      const relevantSections: string[] = [];
      articleContainers.each((_, element) => {
        const articleHtml = $(element).html();
        if (articleHtml)
          relevantSections.push(`<div class="article">${articleHtml}</div>`);
      });
      selectedHtml = relevantSections.length
        ? relevantSections.join('\n')
        : $('body').html();
    }
  } else if (sourceName === 'EAV') {
    const article = $('article.post');
    if (article.length === 0) {
      selectedHtml = $('body').html();
    } else {
      article
        .find(
          'section.container:nth-child(1), .offset-lg-2, section#articolo-dettaglio-meta, div.row:nth-child(3)',
        )
        .remove();
      article
        .find('*')
        .contents()
        .filter((_i, el) => el.type === 'comment')
        .remove();
      selectedHtml = $.html(article);
    }
  } else if (sourceName === 'ATAC') {
    const mainContainer = $('div.elementor:nth-child(4)');
    if (mainContainer.length === 0) {
      selectedHtml = $('body').html() || null;
    } else {
      mainContainer
        .find('.elementor-element-628feb2, .elementor-element-6ebb244')
        .remove();
      selectedHtml = $.html(mainContainer);
    }
  }

  if (!selectedHtml) {
    return $('body').html()?.replace(/\s+/g, ' ').trim() || '';
  }

  const $distilled = cheerio.load(selectedHtml, null, false);
  $distilled(
    'script, style, svg, noscript, iframe, canvas, link[rel="stylesheet"], meta',
  ).remove();
  $distilled('*').each((_, el) => {
    const attribs = $distilled(el).attr();
    if (attribs) {
      Object.keys(attribs).forEach((attr) => {
        if (!['href', 'colspan', 'rowspan'].includes(attr))
          $distilled(el).removeAttr(attr);
      });
    }
  });

  const contextHtml = contextParts.length
    ? `<div class="extracted-context"><h3>Context Metadata</h3><ul>${contextParts.map((c) => `<li>${c}</li>`).join('')}</ul></div><hr/>`
    : '';
  return (contextHtml + $distilled.html()).replace(/\s+/g, ' ').trim();
}

function processContent(content: string, company: string): string {
  if (!content.trim().startsWith('<'))
    return content.replace(/\s+/g, ' ').trim();
  const $ = cheerio.load(content);
  const html = applyDomDistillation($, company);
  const turndownService = new TurndownService({
    headingStyle: 'atx',
    codeBlockStyle: 'fenced',
    bulletListMarker: '-',
  });
  turndownService.use(gfm);
  turndownService.keep(['table', 'thead', 'tbody', 'tr', 'th', 'td']);
  return turndownService.turndown(html);
}

// Try a few common folder structures to find the file
async function getFileContent(
  company: string,
  filename: string,
): Promise<string> {
  const possiblePaths = [
    path.join(RAW_FILES_BASE_DIR, company, filename),
    path.join(RAW_FILES_BASE_DIR, filename),
    path.join(process.cwd(), company, filename),
    path.join(process.cwd(), filename),
  ];

  for (const p of possiblePaths) {
    if (fs.existsSync(p)) {
      if (p.endsWith('.pdf')) {
        const content = await Bun.file(p).arrayBuffer();
        const parser = new PDFParse({ data: content });
        const { text } = await parser.getText();
        parser.destroy();
        return text.replace(/\n\s*\n/g, '\n').trim();
      }
      return await Bun.file(p).text();
    }
  }
  return `⚠️ Could not find file locally. Tried:\n${possiblePaths.join('\n')}\n\nCheck RAW_FILES_BASE_DIR at the top of the script.`;
}

// ==========================================
// 2. HTTP Server + API
// ==========================================
const server = Bun.serve({
  port: 3000,
  routes: {
    '/api/data': () => Response.json(inMemoryData),

    '/api/content': async (req) => {
      const url = new URL(req.url);
      const company = url.searchParams.get('company');
      const filename = url.searchParams.get('filename');
      if (!company || !filename)
        return new Response('Missing params', { status: 400 });

      const raw = await getFileContent(company, filename);
      const markdown = processContent(raw, company);
      return Response.json({ markdown });
    },

    '/api/save': {
      POST: async (req) => {
        const body = await req.json();
        const { company, filename, data } = body;

        inMemoryData[company][filename] = data;

        // Write back to ground-truth.ts file
        const tsContent = `import { BenchmarkStrike } from '../schemas/benchmark-strike.schema';

export type Company = keyof typeof groundTruth;

/**
 * Map file names to their ground truth data for benchmark tests.
 */
export const groundTruth = ${JSON.stringify(inMemoryData, null, 2)} satisfies Record<string, Record<string, BenchmarkStrike>>;
`;
        await Bun.write(GROUND_TRUTH_PATH, tsContent);
        return Response.json({ success: true });
      },
    },

    '/': () =>
      new Response(htmlTemplate, { headers: { 'Content-Type': 'text/html' } }),
  },
  fetch() {
    return new Response('Not Found', { status: 404 });
  },
});

console.log(`✅ Editor running at ${server.url}`);

// ==========================================
// 3. Frontend HTML Template
// ==========================================
const htmlTemplate = `
<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <title>Ground Truth Editor</title>
  <script src="https://unpkg.com/vue@3/dist/vue.global.js"></script>
  <script src="https://cdn.jsdelivr.net/npm/marked/marked.min.js"></script>
  <script src="https://cdn.tailwindcss.com"></script>
  <style>
    /* Custom scrollbar for better look */
    ::-webkit-scrollbar { width: 6px; height: 6px; }
    ::-webkit-scrollbar-thumb { background: #cbd5e1; border-radius: 4px; }
    ::-webkit-scrollbar-thumb:hover { background: #94a3b8; }
  </style>
</head>
<body class="bg-gray-100 text-gray-900 overflow-hidden h-screen">
  <div id="app" class="flex h-full">
    
    <!-- Sidebar -->
    <div class="w-1/3 max-w-sm bg-white border-r flex flex-col h-full">
      <div class="p-4 bg-gray-800 text-white font-bold flex justify-between items-center">
        <span>Files</span>
        <span class="text-xs bg-gray-600 px-2 py-1 rounded">{{ totalFiles }}</span>
      </div>
      <div class="overflow-y-auto flex-1 p-2 space-y-4">
        <div v-for="(files, company) in data" :key="company">
          <h3 class="font-bold text-gray-700 uppercase text-xs tracking-wider mb-1 px-2">{{ company }}</h3>
          <ul class="space-y-1">
            <li v-for="(val, fname) in files" :key="fname"
                @click="selectFile(company, fname)"
                :class="{'bg-blue-100 border-blue-400': currentCompany === company && currentFilename === fname, 'border-transparent': currentCompany !== company || currentFilename !== fname}"
                class="cursor-pointer border-l-4 text-sm truncate hover:bg-gray-50 px-2 py-1 rounded transition-colors flex items-center gap-2">
                <span :title="val.isStrike ? 'Strike' : 'Not Strike'">{{ val.isStrike ? '🔴' : '⚪' }}</span>
                <span class="truncate">{{ fname }}</span>
            </li>
          </ul>
        </div>
      </div>
    </div>

    <!-- Main Content -->
    <div class="flex-1 flex flex-col h-full bg-white">
      <div v-if="!currentFilename" class="flex-1 flex items-center justify-center text-gray-400">
        Select a file from the sidebar
      </div>
      <template v-else>
        <!-- Topbar -->
        <div class="p-4 border-b bg-gray-50 flex justify-between items-center shadow-sm z-10">
          <h2 class="font-semibold text-gray-800 truncate" :title="currentFilename">{{ currentCompany }} / {{ currentFilename }}</h2>
          <div class="flex gap-2">
            <button @click="goPrev" class="px-3 py-1 bg-gray-200 hover:bg-gray-300 rounded text-sm font-medium">⬅ Prev</button>
            <button @click="goNext" class="px-3 py-1 bg-gray-200 hover:bg-gray-300 rounded text-sm font-medium">Next ➡</button>
          </div>
        </div>

        <div class="flex-1 flex overflow-hidden">
          
          <!-- Markdown View -->
          <div class="w-1/2 overflow-y-auto p-6 border-r bg-white prose prose-sm max-w-none">
            <div v-if="loadingMarkdown" class="text-gray-400 animate-pulse">Running DOM Distillation...</div>
            <div v-else v-html="parsedContent"></div>
          </div>

          <!-- Editor Form -->
          <div class="w-1/2 overflow-y-auto p-6 bg-gray-50">
            <div class="max-w-md mx-auto bg-white p-6 rounded-lg shadow-sm border">
              <h3 class="text-lg font-bold mb-4">Ground Truth Details</h3>
              
              <form @submit.prevent="saveData">
                <label class="flex items-center gap-2 mb-6 cursor-pointer bg-gray-100 p-3 rounded hover:bg-gray-200 transition">
                  <input type="checkbox" v-model="form.isStrike" class="w-5 h-5 rounded text-blue-600 focus:ring-blue-500">
                  <span class="font-bold">IS STRIKE ANNOUNCEMENT?</span>
                </label>

                <div v-if="form.isStrike" class="space-y-4">
                  <div>
                    <label class="block text-xs font-bold text-gray-600 mb-1">Start Date (yyyy-MM-dd HH:mm:ss)</label>
                    <input v-model="form.strikeData.startDate" required placeholder="2024-11-29 09:00:00" class="w-full border rounded p-2 focus:ring-2 focus:ring-blue-500 outline-none">
                  </div>
                  <div>
                    <label class="block text-xs font-bold text-gray-600 mb-1">End Date (yyyy-MM-dd HH:mm:ss)</label>
                    <input v-model="form.strikeData.endDate" required placeholder="2024-11-29 13:00:00" class="w-full border rounded p-2 focus:ring-2 focus:ring-blue-500 outline-none">
                  </div>
                  <div>
                    <label class="block text-xs font-bold text-gray-600 mb-1">Location Type</label>
                    <select v-model="form.strikeData.locationType" class="w-full border rounded p-2 bg-white outline-none">
                      <option value="NATIONAL">NATIONAL</option>
                      <option value="REGIONAL">REGIONAL</option>
                    </select>
                  </div>
                  <div>
                    <label class="block text-xs font-bold text-gray-600 mb-1">Location Codes (Comma Separated)</label>
                    <input v-model="computedLocationCodes" placeholder="e.g. 03, 08" class="w-full border rounded p-2 outline-none">
                  </div>
                  <div>
                    <label class="block text-xs font-bold text-gray-600 mb-1">Guaranteed Times (Comma Separated)</label>
                    <input v-model="computedGuaranteedTimes" placeholder="e.g. 06:00-09:00, 18:00-21:00" class="w-full border rounded p-2 outline-none">
                  </div>
                </div>

                <hr class="my-6">
                
                <button type="submit" class="w-full bg-blue-600 hover:bg-blue-700 text-white font-bold py-3 rounded shadow transition-colors">
                  Save & Go to Next
                </button>
              </form>
            </div>
          </div>
        </div>
      </template>
    </div>
  </div>

  <script>
    const { createApp, ref, computed, onMounted } = Vue;

    createApp({
      setup() {
        const data = ref({});
        const currentCompany = ref('');
        const currentFilename = ref('');
        const markdownRaw = ref('');
        const loadingMarkdown = ref(false);
        
        const form = ref({
          isStrike: false,
          strikeData: {
            startDate: '', endDate: '', locationType: 'NATIONAL', locationCodes: [], guaranteedTimes: []
          }
        });

        // Computed flat list to easily go Next/Prev
        const flatFilesList = computed(() => {
          const list = [];
          for (const [company, files] of Object.entries(data.value)) {
            for (const filename of Object.keys(files)) {
              list.push({ company, filename });
            }
          }
          return list;
        });

        const totalFiles = computed(() => flatFilesList.value.length);
        const parsedContent = computed(() => marked.parse(markdownRaw.value));

        // Getters/Setters for comma-separated array strings
        const computedLocationCodes = computed({
          get: () => form.value.strikeData.locationCodes?.join(', ') || '',
          set: (val) => {
            form.value.strikeData.locationCodes = val ? val.split(',').map(s => s.trim()).filter(Boolean) : undefined;
          }
        });

        const computedGuaranteedTimes = computed({
          get: () => form.value.strikeData.guaranteedTimes?.join(', ') || '',
          set: (val) => {
            form.value.strikeData.guaranteedTimes = val ? val.split(',').map(s => s.trim()).filter(Boolean) : undefined;
          }
        });

        const fetchData = async () => {
          const res = await fetch('/api/data');
          data.value = await res.json();
        };

        const fetchMarkdown = async (company, filename) => {
          loadingMarkdown.value = true;
          try {
             const res = await fetch(\`/api/content?company=\${encodeURIComponent(company)}&filename=\${encodeURIComponent(filename)}\`);
             const json = await res.json();
             markdownRaw.value = json.markdown;
          } finally {
             loadingMarkdown.value = false;
          }
        };

        const selectFile = async (company, filename) => {
          currentCompany.value = company;
          currentFilename.value = filename;
          
          // Reset form to current ground truth
          const truth = data.value[company][filename];
          form.value.isStrike = truth.isStrike;
          if (truth.isStrike && truth.strikeData) {
            form.value.strikeData = JSON.parse(JSON.stringify(truth.strikeData)); // deep clone
          } else {
            form.value.strikeData = { startDate: '', endDate: '', locationType: 'NATIONAL' };
          }

          await fetchMarkdown(company, filename);
        };

        const saveData = async () => {
          const payloadData = { isStrike: form.value.isStrike };
          
          if (form.value.isStrike) {
            // Clean up empty arrays to avoid cluttering JSON
            const finalData = { ...form.value.strikeData };
            if (!finalData.locationCodes || finalData.locationCodes.length === 0) delete finalData.locationCodes;
            if (!finalData.guaranteedTimes || finalData.guaranteedTimes.length === 0) delete finalData.guaranteedTimes;
            payloadData.strikeData = finalData;
          }

          // Optimistic local update
          data.value[currentCompany.value][currentFilename.value] = payloadData;

          // Save to backend
          await fetch('/api/save', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              company: currentCompany.value,
              filename: currentFilename.value,
              data: payloadData
            })
          });

          goNext();
        };

        const goNext = () => {
          const idx = flatFilesList.value.findIndex(f => f.company === currentCompany.value && f.filename === currentFilename.value);
          if (idx !== -1 && idx < flatFilesList.value.length - 1) {
            const next = flatFilesList.value[idx + 1];
            selectFile(next.company, next.filename);
          }
        };

        const goPrev = () => {
          const idx = flatFilesList.value.findIndex(f => f.company === currentCompany.value && f.filename === currentFilename.value);
          if (idx > 0) {
            const prev = flatFilesList.value[idx - 1];
            selectFile(prev.company, prev.filename);
          }
        };

        onMounted(() => {
          fetchData();
        });

        return {
          data, currentCompany, currentFilename, totalFiles, selectFile,
          parsedContent, form, computedLocationCodes, computedGuaranteedTimes, 
          saveData, loadingMarkdown, goNext, goPrev
        }
      }
    }).mount('#app')
  </script>
</body>
</html>
`;
