import fs from 'node:fs';
import path from 'node:path';
import { Company, groundTruth } from '../data/ground-truth';
import { jinaFileMap } from '../data/jina-files.map';
import { PreProcessingStrategy } from '../definitions/pre-processing-strategy.type';
import { BenchmarkAiRunnerService } from '../services/benchmark-ai-runner.service';

// 1. Quick & Dirty Mock for EnvsService
const mockEnvsService = {
  get: (key: string) => {
    if (key === 'MANUAL_CONFIRMATION_ENABLED') return false;
    return 'mock';
  },
} as any;

// 2. Instantiate the Runner
const runner = new BenchmarkAiRunnerService(mockEnvsService);

// Mute the logger so it doesn't spam your console during the loop
(runner as any).logger = {
  log: () => {},
  debug: () => {},
  warn: () => {},
  error: () => {},
};
// Prevent it from throwing errors if DOM Distillation fails for a specific file
(runner as any).failIfDomDistillationFails = false;

const strategies: PreProcessingStrategy[] = [
  'raw-html',
  'basic-cleanup',
  'html-to-markdown',
  'dom-distillation',
  'dom-distillation-markdown',
  'mineru-html',
  'jina-reader',
];

const baseDir = path.join(process.cwd(), 'data');

async function calculateCompression() {
  const stats: Record<
    string,
    { originalBytes: number; processedBytes: number; fileCount: number }
  > = {};

  for (const strategy of strategies) {
    stats[strategy] = { originalBytes: 0, processedBytes: 0, fileCount: 0 };
  }

  // 3. Loop through Ground Truth
  for (const [companyName, truthData] of Object.entries(groundTruth)) {
    const company = companyName as Company;
    const companyDir = path.join(baseDir, company);

    console.log(`\n🔍 Processing company: ${company}`);

    for (const file of Object.keys(truthData)) {
      const filePath = path.join(companyDir, file);
      if (!fs.existsSync(filePath)) continue;

      // Skip PDFs for text compression metrics (since they don't use HTML strategies)
      if (file.toLowerCase().endsWith('.pdf')) continue;

      const content = fs.readFileSync(filePath, 'utf-8');
      const originalLen = fs.statSync(filePath).size; // More accurate for original file size on disk

      for (const strategy of strategies) {
        let processedLen = 0;
        let success = false;

        console.log(
          `Processing ${company} - ${file} with strategy: ${strategy}`,
        );

        // 4. Handle pre-computed files (MinerU & Jina)
        if (strategy === 'mineru-html') {
          const p = path.join(companyDir, 'mineru-html', file);
          if (fs.existsSync(p)) {
            processedLen = fs.statSync(p).size; // More accurate for processed file size on disk
            success = true;
          }
        } else if (strategy === 'jina-reader') {
          // Fallback gracefully in case you didn't add the new ATAC files to the jinaFileMap yet
          const mapped = jinaFileMap[company]?.[file];

          if (!mapped) {
            console.warn(
              `⚠️ No Jina Reader mapping found for ${company} - ${file}. Skipping...`,
            );
            continue;
          }

          // Checks both .html and .md extensions just in case
          const possiblePaths = [
            path.join(companyDir, 'jina-reader', mapped),
            path.join(
              companyDir,
              'jina-reader',
              mapped.replace('.html', '.md'),
            ),
          ];

          for (const p of possiblePaths) {
            if (fs.existsSync(p)) {
              processedLen = fs.statSync(p).size; // More accurate for processed file size on disk
              success = true;
              break;
            }
          }
        }
        // 5. Apply programmatic strategies
        else {
          try {
            // Bypass TypeScript's private modifier to use the internal method directly
            const processed = (runner as any).applyStrategy(
              content,
              strategy,
              company,
              file,
            );
            if (processed) {
              processedLen = Buffer.byteLength(processed, 'utf-8'); // here we have to estimate the size based on string length since it's generated in-memory
              success = true;
            }
          } catch (e) {
            // Silently ignore files that fail DOM distillation
          }
        }

        // 6. Aggregate
        if (success) {
          stats[strategy]!.originalBytes += originalLen;
          stats[strategy]!.processedBytes += processedLen;
          stats[strategy]!.fileCount++;

          console.log(
            `✅ ${strategy} - Original: ${originalLen} bytes, Processed: ${processedLen} bytes`,
          );
        }
      }
    }
  }

  // 7. Format Table
  const tableData = Object.entries(stats).map(([strategy, data]) => {
    const compressionPct =
      data.originalBytes > 0
        ? ((1 - data.processedBytes / data.originalBytes) * 100).toFixed(2) +
          '%'
        : 'N/A';

    const avgOriginal =
      data.fileCount > 0 ? Math.round(data.originalBytes / data.fileCount) : 0;
    const avgProcessed =
      data.fileCount > 0 ? Math.round(data.processedBytes / data.fileCount) : 0;

    return {
      Strategy: strategy,
      'Success Rate': `${data.fileCount} files`,
      'Avg Original Size': (avgOriginal / 1024).toFixed(2) + ' KB',
      'Avg Processed Size': (avgProcessed / 1024).toFixed(2) + ' KB',
      'Saved Space (%)': compressionPct,
    };
  });

  console.log('\n📊 Pre-Processing Compression Stats:');
  console.table(tableData);
}

calculateCompression().catch(console.error);
