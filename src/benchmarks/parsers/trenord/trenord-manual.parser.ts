/** biome-ignore-all lint/style/noNonNullAssertion: yeah */

import { performance } from 'node:perf_hooks';
import { Injectable, Logger } from '@nestjs/common';
import * as cheerio from 'cheerio';
import { addDays, addYears, format, isBefore, set } from 'date-fns';
import { LocationCode } from '@/shared/constants/location-codes';
import { regionsArr } from '@/shared/constants/regions';
import { LocationType } from '@/shared/enums';
import {
  IStrikeParser,
  ParseOptions,
  ParserResponse,
} from '../../definitions/strike-parser.interface';

@Injectable()
export class TrenordManualParser implements IStrikeParser {
  readonly name = 'Trenord-Manual-Regex';
  readonly parserType = 'manual';

  // private readonly logger = new Logger(TrenordManualParser.name);
  private readonly logger = {
    debug: (..._args: unknown[]) => {},
    warn: (..._args: unknown[]) => {},
    error: (..._args: unknown[]) => {},
  } as Logger;

  // Mapping Italian months to indexes (0-11)
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

  parse(html: string, options?: ParseOptions): ParserResponse {
    const start = performance.now();
    this.logger.debug(
      `Starting parse for file "${
        options?.metadata?.fileName || 'unknown'
      }" with html length: ${html.length}`,
    );
    const $ = cheerio.load(html);

    // Clean DOM
    $(
      'script, style, svg, noscript, iframe, canvas, link[rel="stylesheet"], meta',
    ).remove();
    this.logger.debug('DOM cleaned');

    // Extract Key Text Blocks
    const titleText = $('.uppercase b').first().text().trim();
    const dateNewsText = $('.date-news').text().trim(); // e.g., "martedì 12/12/2023"

    // Extract body, preserving minimal spacing
    const bodyText = $('.frame-type-trenordtheme_simpletextmedia')
      .find('p, h4, li, strong')
      .map((_i, el) => $(el).text())
      .get()
      .join(' ')
      .replace(/\s+/g, ' ')
      .trim();

    const fullText = `${titleText} ${bodyText}`.toLowerCase();
    this.logger.debug(
      `Extracted title: ${titleText}, dateNews: ${dateNewsText}, body length: ${bodyText.length}`,
    );

    // Check for Revocation
    if (
      fullText.includes('revocato') ||
      fullText.includes('sospeso') ||
      fullText.includes('differito')
    ) {
      this.logger.debug('Strike revoked or suspended');
      return this.buildBadResult(performance.now() - start);
    }

    // Determine Context Dates
    // We need the publication date to correctly infer the year of the strike
    // (e.g. News from Dec 2023 regarding a strike in Jan 2024)
    let pubDate = new Date();
    const pubDateMatch = dateNewsText.match(/(\d{1,2})\/(\d{1,2})\/(\d{4})/);
    if (pubDateMatch) {
      pubDate = new Date(
        Number(pubDateMatch[3]),
        Number(pubDateMatch[2]) - 1,
        Number(pubDateMatch[1]),
      );
    }
    this.logger.debug(`Publication date: ${pubDate.toISOString()}`);

    // Extract Strike Date & Time
    const timeInfo = this.extractDatesAndTimes(titleText, bodyText, pubDate);

    if (!timeInfo) {
      this.logger.warn(`Could not extract valid dates from: ${titleText}`);
      return this.buildBadResult(performance.now() - start);
    }
    this.logger.debug(`Extracted timeInfo: ${JSON.stringify(timeInfo)}`);

    // Extract Location
    let locationType: LocationType = LocationType.REGIONAL; // Default for Trenord updates is usually regional (Lombardia) unless specified otherwise
    let locationCodes: LocationCode[] | undefined = ['03']; // Default: Lombardia

    const lowerFullText = fullText.toLowerCase();

    // A. Check National
    // Fix: "generale" usually appears in title for national strikes, or "sciopero nazionale"
    // But "sciopero generale" usually refers to the TYPE of strike, not location, though often implies national.
    // However, Trenord updates are for Lombardy unless specified "Nazionale".
    // We strictly look for "nazionale" OR "generale" ONLY IF it's in the title context specifically.
    if (
      lowerFullText.includes('sciopero nazionale') ||
      lowerFullText.includes('sciopero generale') ||
      titleText.toLowerCase().includes('nazionale')
    ) {
      locationType = LocationType.NATIONAL;
      locationCodes = undefined;
    } else {
      // B. Check Regions
      // Fix: Exact word match for regions to avoid partials (like "lazio" in "agevolazioni")
      // We use a regex boundary \b
      // Exclude matches preceded by "Plus" (e.g. "Plus Veneto" is unrelated marketing)

      const foundRegions = fullText.includes('sciopero generale')
        ? []
        : regionsArr.filter(([, name]) => {
            const regex = new RegExp(`(?<!plus\\s)\\b${name}\\b`);
            return regex.test(fullText);
          });

      if (foundRegions.length > 0) {
        // log them
        this.logger.debug(
          `Found region mentions in ${
            options?.metadata?.fileName || 'unknown'
          }: ${foundRegions
            .map(([code, name]) => `${name} (${code})`)
            .join(', ')}`,
        );

        locationType = LocationType.REGIONAL;
        locationCodes = foundRegions.map(([code]) => code as LocationCode);

        // Fix: If both 'Lombardia' (default) and another region are found, trust the finder.
        // But since we default to '03' (Lombardia), if we found ONLY Lombardia, it's fine.
        // If we found others (e.g. Veneto), we likely want to OVERWRITE the default '03' unless Lombardia is also explicit.
        // The filter above finds explicit mentions.
      } else {
        // If no region found, we keep default ['03'] (Lombardia) for Trenord updates
        // C. Check Provinces
        // const foundProvinces = provincesArr.filter(([name]) => {
        //   const regex = new RegExp(`\\b${name.toLowerCase()}\\b`);
        //   return regex.test(fullText);
        // });
        // if (foundProvinces.length > 0) {
        //   locationType = 'PROVINCE';
        //   locationCodes = foundProvinces.map(([, sigla]) => sigla);
        // }
      }
    }

    // Extract Guaranteed Times
    // Logic: If explicitly mentioned in text, use them.
    // If "festivo" or "domenica" is mentioned in context of "no fasce", clear them.
    const guaranteedTimes = this.extractGuaranteedTimes(fullText);
    this.logger.debug(`Guaranteed times: ${guaranteedTimes}`);

    return {
      data: {
        isStrike: true,
        strikeData: {
          startDate: timeInfo.start,
          endDate: timeInfo.end,
          locationType,
          locationCodes,
          guaranteedTimes:
            guaranteedTimes.length > 0 ? guaranteedTimes : undefined,
        },
      },
      metadata: {
        parserType: 'manual',
        durationMs: performance.now() - start,
        info: 'Strategy: precise regex parsing',
      },
    };
  }

  private buildBadResult(durationMs: number): ParserResponse {
    return {
      data: { isStrike: false },
      metadata: { parserType: 'manual', durationMs },
    };
  }

  private extractDatesAndTimes(
    title: string,
    body: string,
    pubDate: Date,
  ): { start: string; end: string } | null {
    this.logger.debug(
      `Extracting dates from title: ${title}, body: ${body.substring(0, 100)}..., pubDate: ${pubDate.toISOString()}`,
    );
    const cleanTitle = title.toLowerCase();
    const cleanBody = body.toLowerCase();
    this.logger.debug(
      `Clean title length: ${cleanTitle.length}, clean body length: ${cleanBody.length}`,
    );

    // --- FIND THE PRIMARY DATE ---
    // Regex for "14 dicembre" or "14/12"
    const dateRegex =
      /(\d{1,2})(?:\s|°|º)?\s+(gennaio|febbraio|marzo|aprile|maggio|giugno|luglio|agosto|settembre|ottobre|novembre|dicembre)/i;

    let dateMatch = cleanTitle.match(dateRegex);
    if (!dateMatch) dateMatch = cleanBody.match(dateRegex);

    if (!dateMatch) return null;
    this.logger.debug(`Date match: ${dateMatch}`);

    const day = Number.parseInt(dateMatch[1]!, 10);
    const monthName = dateMatch[2]!.toLowerCase();
    const monthIndex = this.MONTH_MAP[monthName];

    // Construct preliminary start date using Publication Year
    let startDateObj = new Date(pubDate.getFullYear(), monthIndex!, day);
    this.logger.debug(`Start date obj initial: ${startDateObj.toISOString()}`);

    // Year Rollover Logic:
    // If publication is Dec 2023 and strike date is Jan, the date object created above (Jan 2023)
    // will be BEFORE the publication date. We assume strikes are in the future.
    if (isBefore(startDateObj, set(pubDate, { date: pubDate.getDate() - 5 }))) {
      startDateObj = addYears(startDateObj, 1);
    }
    this.logger.debug(`After year rollover: ${startDateObj.toISOString()}`);

    // --- FIND TIME RANGE ---
    // Updated Regex:
    // Supports "dalle X alle Y"
    // Supports "dalle ore X alle ore Y"
    // Supports "tra le ore X e le ore Y" (new)
    // Supports "ore 9-13" (new)
    const rangeRegex =
      /(?:dalle|da|tra|ore)\s*(?:le|ore)?\s*(\d{1,2}|mezzanotte)(?:[:.](\d{2}))?.*?(?:alle|al(?:le)?|entro|fino?\s+al(?:le)?|-)\s*(?:le|ore)?\s*(\d{1,2}|mezzanotte)(?:[:.](\d{2}))?/i;

    // Prioritize Title for times, then search full body (not just first 400 chars)
    let rangeMatch = cleanTitle.match(rangeRegex);
    if (!rangeMatch) {
      this.logger.debug(
        `Searching for time range in body (first 200 chars): ${cleanBody.substring(0, 200)}`,
      );
      rangeMatch = cleanBody.match(rangeRegex);
    }
    this.logger.debug(`Range match: ${rangeMatch}`);

    let startHour = 0;
    let startMin = 0;
    let endHour = 23;
    let endMin = 59;
    let explicitRangeFound = false;

    if (rangeMatch) {
      startHour = Number.parseInt(rangeMatch[1]!, 10);
      startMin = rangeMatch[2] ? Number.parseInt(rangeMatch[2]!, 10) : 0;
      endHour = Number.parseInt(rangeMatch[3]!, 10);
      endMin = rangeMatch[4] ? Number.parseInt(rangeMatch[4]!, 10) : 0;
      explicitRangeFound = true;
    } else if (
      cleanTitle.includes('24 ore') ||
      cleanTitle.includes('intera giornata')
    ) {
      // Generic 24h fallback
      startHour = 0;
      endHour = 23;
      endMin = 59;
    }

    // Set Start Time
    startDateObj = set(startDateObj, {
      hours: startHour,
      minutes: startMin,
      seconds: 0,
      milliseconds: 0,
    });
    this.logger.debug(`Start time set: ${startDateObj.toISOString()}`);

    // --- CALCULATE END DATE ---
    let endDateObj = set(startDateObj, {
      hours: endHour,
      minutes: endMin,
      seconds: 0,
      milliseconds: 0,
    });

    // Cross-day Logic:
    // Explicit mention of next day in the body text near the times (hard to regex perfectly, relying on hour logic usually works)
    // End < Start (e.g. 03:00 to 02:00)
    // Specific case: 03:00 start usually implies a 23h strike ending at 02:00 next day

    if (explicitRangeFound) {
      // If End is before Start (e.g. 21 to 06, or 03 to 02)
      if (endHour < startHour) {
        endDateObj = addDays(endDateObj, 1);
      }
      // If Start is 3am and End is 2am, it's definitely next day (common railway strike pattern)
      else if (startHour === 3 && endHour === 2) {
        endDateObj = addDays(endDateObj, 1);
      }
      // If they are equal (21 to 21), it's 24h
      else if (startHour === endHour && startHour !== 0) {
        endDateObj = addDays(endDateObj, 1);
      }
    }
    this.logger.debug(`End date obj: ${endDateObj.toISOString()}`);

    return {
      start: format(startDateObj, 'yyyy-MM-dd HH:mm:ss'),
      end: format(endDateObj, 'yyyy-MM-dd HH:mm:ss'),
    };
  }

  private extractGuaranteedTimes(text: string): string[] {
    // Kept minimal as requested
    const guarantees = new Set<string>();
    const morningRegex = /(?:0?6)[:.]?00\s*[-–/]\s*0?9[:.]?00|\b6\s*[-–]\s*9\b/;
    const eveningRegex = /(?:18)[:.]?00\s*[-–/]\s*21[:.]?00|\b18\s*[-–]\s*21\b/;

    if (morningRegex.test(text)) guarantees.add('06:00-09:00');
    if (eveningRegex.test(text)) guarantees.add('18:00-21:00');

    return Array.from(guarantees).sort();
  }
}
