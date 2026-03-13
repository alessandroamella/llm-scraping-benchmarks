/** biome-ignore-all lint/style/noNonNullAssertion: yeah */

import { performance } from 'node:perf_hooks';
import { Injectable, Logger } from '@nestjs/common';
import * as cheerio from 'cheerio';
import { addDays, format, set } from 'date-fns';
import { LocationCode } from '@/shared/constants/location-codes';
import { LocationType } from '@/shared/enums';
import {
  IStrikeParser,
  ParseOptions,
  ParserResponse,
} from '../../definitions/strike-parser.interface';

@Injectable()
export class EavManualParser implements IStrikeParser {
  readonly name = 'EAV-Manual-Regex';
  readonly parserType = 'manual';

  // private readonly logger = new Logger(EavManualParser.name);
  private readonly logger = {
    debug: (..._args: unknown[]) => {},
    warn: (..._args: unknown[]) => {},
    error: (..._args: unknown[]) => {},
  } as Logger;

  private readonly MONTH_MAP: Record<string, number> = {
    gennaio: 0,
    febbraio: 1,
    marzo: 2,
    aprile: 3,
    maggio: 4,
    giugno: 5,
    luglio: 6,
    agosto: 7,
    settembre: 8,
    ottobre: 9,
    novembre: 10,
    dicembre: 11,
  };

  parse(html: string, options?: Omit<ParseOptions, 'model'>): ParserResponse {
    const start = performance.now();
    this.logger.debug(
      `Starting parse for file "${options?.metadata?.fileName || 'unknown'}"`,
    );

    const $ = cheerio.load(html);

    // Clean DOM to speed up extraction
    $(
      'script, style, nav, footer, header, meta, link, noscript, iframe, .breadcrumb, .olo-cookie-header',
    ).remove();

    // Extract Title (Highest priority for the strike date & duration to avoid parsing past stats)
    const titleText =
      $('.titolo-sezione h2').text().trim() ||
      $('h1, h2, title').first().text().trim();

    // Extract Body
    const bodyText = $('.entry-content p, .entry-content li')
      .map((_i, el) => $(el).text())
      .get()
      .join(' ')
      .replace(/\s+/g, ' ')
      .trim();

    const fullText = `${titleText} ${bodyText}`.toLowerCase();

    // 1. FILTER FALSE POSITIVES
    if (!fullText.includes('sciopero')) {
      return this.buildBadResult(performance.now() - start);
    }
    if (
      fullText.includes('revocato') ||
      fullText.includes('sospeso') ||
      fullText.includes('differito')
    ) {
      return this.buildBadResult(performance.now() - start);
    }

    // 2. EXTRACT DATE
    let day: number | undefined;
    let monthIndex: number | undefined;
    let year: number | undefined;

    // A) Explicit format: "28 gennaio 2025"
    const dateRegexText =
      /(\d{1,2})\s+(gennaio|febbraio|marzo|aprile|maggio|giugno|luglio|agosto|settembre|ottobre|novembre|dicembre)\s+(\d{4})/i;
    // B) Numeric format: "28/01/2025"
    const dateRegexNumeric = /(\d{1,2})\/(\d{1,2})\/(\d{4})/;

    // We check the title first to avoid matching historical strike data in the body
    let dateMatch = titleText.match(dateRegexText);
    if (dateMatch) {
      day = Number.parseInt(dateMatch[1]!, 10);
      monthIndex = this.MONTH_MAP[dateMatch[2]!.toLowerCase()];
      year = Number.parseInt(dateMatch[3]!, 10);
    } else {
      dateMatch = titleText.match(dateRegexNumeric);
      if (dateMatch) {
        day = Number.parseInt(dateMatch[1]!, 10);
        monthIndex = Number.parseInt(dateMatch[2]!, 10) - 1;
        year = Number.parseInt(dateMatch[3]!, 10);
      } else {
        // Fallback to body
        dateMatch = bodyText.match(dateRegexText);
        if (dateMatch) {
          day = Number.parseInt(dateMatch[1]!, 10);
          monthIndex = this.MONTH_MAP[dateMatch[2]!.toLowerCase()];
          year = Number.parseInt(dateMatch[3]!, 10);
        } else {
          dateMatch = bodyText.match(dateRegexNumeric);
          if (dateMatch) {
            day = Number.parseInt(dateMatch[1]!, 10);
            monthIndex = Number.parseInt(dateMatch[2]!, 10) - 1;
            year = Number.parseInt(dateMatch[3]!, 10);
          }
        }
      }
    }

    if (day === undefined || monthIndex === undefined || year === undefined) {
      this.logger.warn('Could not extract a valid date.');
      return this.buildBadResult(performance.now() - start);
    }

    let startDateObj = new Date(year, monthIndex, day);

    // 3. EXTRACT TIMES & DURATION
    const titleLower = titleText.toLowerCase();
    let is24h = false;

    // Prioritize title for duration (avoids historical mentions in body)
    if (
      titleLower.includes('24 ore') ||
      titleLower.includes('24 h') ||
      titleLower.includes('24h') ||
      titleLower.includes('intera giornata')
    ) {
      is24h = true;
    }

    if (
      titleLower.includes('4 ore') ||
      titleLower.includes('2 ore') ||
      titleLower.includes('ridotto a')
    ) {
      is24h = false;
    }

    // Fallback to body ONLY IF title is ambiguous
    if (
      !titleLower.includes('24') &&
      !titleLower.includes('4 ore') &&
      !titleLower.includes('2 ore')
    ) {
      const firstChunk = bodyText.substring(0, 500).toLowerCase();
      if (
        firstChunk.includes('ridotto a 4 ore') ||
        firstChunk.includes('sciopero di 4 ore') ||
        firstChunk.includes('sciopero di 2 ore')
      ) {
        is24h = false;
      } else if (
        firstChunk.includes('24 ore') ||
        firstChunk.includes('24 h') ||
        firstChunk.includes('24h') ||
        firstChunk.includes('intera giornata')
      ) {
        is24h = true;
      }
    }

    let startHour = 0;
    let startMin = 0;
    let endHour = 23;
    let endMin = 59;

    // List of known official EAV guaranteed bands
    const knownBands = [
      '05:30-08:30',
      '16:30-19:30',
      '06:00-08:00',
      '13:00-15:00',
      '17:00-19:00',
    ];

    if (!is24h) {
      // Find specific partial strike times (e.g., "dalle ore 19:40 alle ore 23:40")
      const timeRegex =
        /dalle\s+(?:ore\s+)?(\d{1,2})[:.](\d{2})\s+alle\s+(?:ore\s+)?(\d{1,2})[:.](\d{2})/gi;
      const allMatches = Array.from(bodyText.matchAll(timeRegex));

      for (const match of allMatches) {
        const sh = match[1]!.padStart(2, '0');
        const sm = match[2]!.padStart(2, '0');
        const eh = match[3]!.padStart(2, '0');
        const em = match[4]!.padStart(2, '0');

        const band = `${sh}:${sm}-${eh}:${em}`;

        // If it's NOT a standard guaranteed band, it must be the strike time!
        if (!knownBands.includes(band)) {
          startHour = Number.parseInt(match[1]!, 10);
          startMin = Number.parseInt(match[2]!, 10);
          endHour = Number.parseInt(match[3]!, 10);
          endMin = Number.parseInt(match[4]!, 10);
          break; // Found the actual strike time, stop searching.
        }
      }
    }

    // Apply times to objects
    startDateObj = set(startDateObj, {
      hours: startHour,
      minutes: startMin,
      seconds: 0,
      milliseconds: 0,
    });

    let endDateObj = set(startDateObj, {
      hours: endHour,
      minutes: endMin,
      seconds: 0,
      milliseconds: 0,
    });

    // Cross-day safeguard for night strikes (e.g. 23:00 to 03:00)
    if (endHour < startHour || (startHour === 23 && endHour === 23 && !is24h)) {
      endDateObj = addDays(endDateObj, 1);
    }

    // 4. EXTRACT LOCATION
    let locationType: LocationType = LocationType.REGIONAL;
    let locationCodes: LocationCode[] | undefined = ['15']; // Campania

    // Check if it's a National strike
    if (
      fullText.includes('sciopero nazionale') ||
      fullText.includes('generale nazionale') ||
      titleText.toLowerCase().includes('nazionale')
    ) {
      locationType = LocationType.NATIONAL;
      locationCodes = undefined;
    }

    // 5. EXTRACT GUARANTEED TIMES
    const guaranteedTimes = this.extractGuaranteedTimes(fullText, knownBands);

    return {
      data: {
        isStrike: true,
        strikeData: {
          startDate: format(startDateObj, 'yyyy-MM-dd HH:mm:ss'),
          endDate: format(endDateObj, 'yyyy-MM-dd HH:mm:ss'),
          locationType,
          locationCodes,
          guaranteedTimes,
        },
      },
      metadata: {
        parserType: 'manual',
        durationMs: performance.now() - start,
        info: 'EAV Strict Regex Parser (Handles date aliases, historical mentions, and strict bands)',
      },
    };
  }

  private buildBadResult(durationMs: number): ParserResponse {
    return {
      data: { isStrike: false },
      metadata: { parserType: 'manual', durationMs },
    };
  }

  private extractGuaranteedTimes(
    text: string,
    knownBands: string[],
  ): string[] | undefined {
    const guarantees = new Set<string>();

    const bandRegex =
      /dalle\s+(?:ore\s+)?(\d{1,2})[:.](\d{2})\s+alle\s+(?:ore\s+)?(\d{1,2})[:.](\d{2})/gi;
    const matchBands = text.matchAll(bandRegex);

    for (const match of matchBands) {
      const sh = match[1]!.padStart(2, '0');
      const sm = match[2]!.padStart(2, '0');
      const eh = match[3]!.padStart(2, '0');
      const em = match[4]!.padStart(2, '0');

      const band = `${sh}:${sm}-${eh}:${em}`;

      // Only add to guarantees if it explicitly matches known standard EAV bands
      if (knownBands.includes(band)) {
        guarantees.add(band);
      }
    }

    const result = Array.from(guarantees).sort();
    return result.length > 0 ? result : undefined;
  }
}
