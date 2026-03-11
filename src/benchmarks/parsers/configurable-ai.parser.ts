import { PDFParse } from 'pdf-parse';
import { Company } from '../data/ground-truth';
import { PreProcessingStrategy } from '../definitions/pre-processing-strategy.type';
import {
  IStrikeParser,
  ParseOptions,
  ParserResponse,
  SupportedModel,
} from '../definitions/strike-parser.interface';
import { BenchmarkAiRunnerService } from '../services/benchmark-ai-runner.service';

export class ConfigurableAiParser implements IStrikeParser {
  name: string;
  parserType = 'ai' as const;

  constructor(
    private readonly runner: BenchmarkAiRunnerService,
    private readonly strategy: PreProcessingStrategy,
    private readonly companyName: Company,
    readonly model: SupportedModel,
    private readonly useLenientSchema: boolean,
  ) {
    const schemaTag = useLenientSchema ? 'Lenient' : 'Strict';
    this.name = `${model} [${strategy}] (${schemaTag})`;
  }

  async parse(content: string, options: ParseOptions): Promise<ParserResponse> {
    let textToProcess = content;

    // If we are dealing with Trenitalia TPER, the 'content' is binary PDF data.
    // We must extract the text first.
    if (this.companyName === 'Trenitalia TPER') {
      try {
        const dataBuffer = Buffer.from(content, 'binary');
        // const pdfData = await pdf(dataBuffer);

        const parser = new PDFParse({ data: dataBuffer });
        const { text } = await parser.getText();
        parser.destroy(); // Clean up resources

        textToProcess = text;

        // Apply a small cleanup for common PDF garbage if needed
        textToProcess = textToProcess.replace(/\n\s*\n/g, '\n').trim();
      } catch (e) {
        console.error('Failed to extract text from PDF for benchmark', e);
        throw e;
      }
    }

    return this.runner.parseWithAi(
      textToProcess,
      this.companyName,
      this.strategy,
      this.model,
      options.metadata.fileName,
      this.useLenientSchema,
    );
  }
}
