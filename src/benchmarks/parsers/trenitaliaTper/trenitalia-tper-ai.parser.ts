import { Injectable, Logger } from '@nestjs/common';
import { PDFParse } from 'pdf-parse';
import {
  IStrikeParser,
  ParseOptions,
  ParserResponse,
} from '../../definitions/strike-parser.interface';
import { BenchmarkAiRunnerService } from '../../services/benchmark-ai-runner.service';

@Injectable()
export class TrenitaliaTperAiParser implements IStrikeParser {
  readonly name = 'Trenitalia-Tper-AI';
  readonly parserType = 'ai';
  private readonly logger = new Logger(TrenitaliaTperAiParser.name);

  constructor(private readonly aiRunner: BenchmarkAiRunnerService) {}

  /**
   * For this parser, 'input' is the raw binary content of the PDF as a string
   * (or we handle the buffer logic in the benchmark service)
   */
  async parse(
    pdfBufferString: string,
    options: ParseOptions,
  ): Promise<ParserResponse> {
    const strategy = options?.strategy || 'basic-cleanup';

    try {
      // Convert Buffer to Text
      // Note: pdf-parse expects a Buffer.
      const dataBuffer = Buffer.from(pdfBufferString, 'binary');
      const parser = new PDFParse({ data: dataBuffer });
      const { text } = await parser.getText();
      await parser.destroy();
      let extractedText = text;

      // Pre-process (Optional: move this to a dedicated strategy later)
      if (strategy === 'basic-cleanup') {
        extractedText = this.cleanPdfText(extractedText);
      }

      // Forward to AI Runner
      return this.aiRunner.parseWithAi(
        extractedText,
        'Trenitalia TPER',
        strategy,
        options.model,
        options.metadata.fileName,
        options.useLenientSchema,
      );
    } catch (error) {
      this.logger.error('Failed to parse Trenitalia TPER PDF via AI', error);
      throw error;
    }
  }

  private cleanPdfText(text: string): string {
    // Reuse your manual logic to remove boilerplate noise
    const stopPhrases = [
      'Informazioni su collegamenti e servizi anche attraverso',
      'oltre che nelle biglietterie',
      '-- 1 of 1 --',
    ];

    let cleaned = text;
    for (const phrase of stopPhrases) {
      const index = cleaned.indexOf(phrase);
      if (index !== -1) {
        cleaned = cleaned.slice(0, index);
      }
    }
    return cleaned.trim();
  }
}
