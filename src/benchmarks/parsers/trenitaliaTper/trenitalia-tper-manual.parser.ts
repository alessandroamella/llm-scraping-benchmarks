import { readFileSync } from 'node:fs';
import { Injectable, Logger } from '@nestjs/common';
import { PDFParse } from 'pdf-parse';
import {
  IStrikeParser,
  ParserResponse,
} from '../../definitions/strike-parser.interface';

@Injectable()
export class TrenitaliaTperManualParser implements IStrikeParser {
  private readonly logger = new Logger(TrenitaliaTperManualParser.name);

  readonly name = 'Trenitalia-Tper-Manual';
  readonly parserType = 'manual';

  async extractTextFromPdf(filePath: string): Promise<string> {
    try {
      const dataBuffer = readFileSync(filePath);
      const parser = new PDFParse({ data: dataBuffer });
      const { text } = await parser.getText();
      await parser.destroy();

      const __end = text.indexOf(
        'Informazioni su collegamenti e servizi anche attraverso',
      );
      const _end = text.indexOf(
        'oltre che nelle biglietterie e presso il personale di assistenza clienti.',
      );
      const end =
        __end > 0 ? __end : _end > 0 ? _end + 73 : text.indexOf('-- 1 of 1 --');

      return (end !== -1 ? text.slice(0, end) : text).trim();
    } catch (error) {
      this.logger.error(`Error parsing PDF from ${filePath}:`, error);
      throw error;
    }
  }

  async parse(_html: string): Promise<ParserResponse> {
    throw new Error('Not implemented yet');
  }
}
