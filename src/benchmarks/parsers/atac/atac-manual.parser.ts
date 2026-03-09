/** biome-ignore-all lint/style/noNonNullAssertion: yeah */

import { performance } from 'node:perf_hooks';
import { Injectable, Logger } from '@nestjs/common';
import * as cheerio from 'cheerio';
import { addDays, addYears, format, isBefore, set } from 'date-fns';
import { LocationCode } from '@/shared/constants/location-codes';
import { LocationType } from '@/shared/enums';
import {
  IStrikeParser,
  ParseOptions,
  ParserResponse,
} from '../../definitions/strike-parser.interface';

@Injectable()
export class ATACManualParser implements IStrikeParser {
  // private readonly logger = new Logger(ATACManualParser.name);

  readonly name = 'ATAC-Manual-Regex';
  readonly parserType = 'manual';

  // private readonly logger = new Logger(ATACManualParser.name);
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

  parse(html: string, options?: ParseOptions): ParserResponse {
    const start = performance.now();
    this.logger.debug(
      `Starting ATAC parse for file "${options?.metadata?.fileName || 'unknown'}"`,
    );

    const $ = cheerio.load(html);

    // Pulisci il DOM dagli elementi superflui per evitare falsi positivi
    $(
      'script, style, svg, noscript, iframe, canvas, link, meta, header, footer, nav, aside',
    ).remove();

    // Estrai il titolo principale (solitamente in H1 o H2)
    const titleText =
      $('h1').first().text().trim() || $('h2').first().text().trim();

    // Estrai il testo utile dai paragrafi
    const bodyText = $('main, .elementor-widget-container, #main-content')
      .find('p, li, strong')
      .map((_i, el) => $(el).text())
      .get()
      .join(' ')
      .replace(/\s+/g, ' ')
      .trim();

    const fullText = `${titleText} ${bodyText}`.toLowerCase();

    // Controlla se lo sciopero è stato revocato o sospeso
    if (
      fullText.includes('revocato') ||
      fullText.includes('sospeso') ||
      fullText.includes('differito')
    ) {
      this.logger.debug('Strike revoked or suspended');
      return this.buildBadResult(performance.now() - start);
    }

    // Estrazione Data di Pubblicazione (es. "Pubblicato il: 02/11/2024")
    let pubDate = new Date();
    const pubDateMatch =
      fullText.match(/pubblicato il:\s*(\d{1,2})\/(\d{1,2})\/(\d{4})/i) ||
      fullText.match(/(\d{2})\/(\d{2})\/(\d{4})/);
    if (pubDateMatch) {
      pubDate = new Date(
        Number(pubDateMatch[3]),
        Number(pubDateMatch[2]) - 1,
        Number(pubDateMatch[1]),
      );
    }

    // Calcolo Data e Orari
    const timeInfo = this.extractDatesAndTimes(titleText, bodyText, pubDate);
    if (!timeInfo) {
      this.logger.warn('Could not extract valid dates');
      return this.buildBadResult(performance.now() - start);
    }

    // Scope dello sciopero
    let locationType: LocationType = LocationType.REGIONAL;
    let locationCodes: LocationCode[] | undefined = ['12']; // 12 è il codice per il Lazio

    if (
      fullText.includes('sciopero nazionale') ||
      fullText.includes('sciopero generale') ||
      titleText.toLowerCase().includes('nazionale')
    ) {
      locationType = LocationType.NATIONAL;
      locationCodes = undefined;
    }

    // Fasce di Garanzia
    const guaranteedTimes = this.extractGuaranteedTimes(fullText);

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
        info: 'ATAC Strategy: regex based on standard communication patterns',
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
    const cleanTitle = title.toLowerCase();
    const cleanBody = body.toLowerCase();
    const fullText = `${cleanTitle} ${cleanBody}`;

    // Regex per "Venerdì 8 novembre" o "17 giugno"
    const dateRegex =
      /(?:luned[iì]|marted[iì]|mercoled[iì]|gioved[iì]|venerd[iì]|sabato|domenica)?\s*(\d{1,2})\s+(gennaio|febbraio|marzo|aprile|maggio|giugno|luglio|agosto|settembre|ottobre|novembre|dicembre)/i;

    const dateMatch = cleanTitle.match(dateRegex) || cleanBody.match(dateRegex);
    if (!dateMatch) return null;

    const day = Number.parseInt(dateMatch[1]!, 10);
    const monthName = dateMatch[2]!.toLowerCase();
    const monthIndex = this.MONTH_MAP[monthName];

    // Inferenza dell'anno basata sulla data di pubblicazione
    let startDateObj = new Date(pubDate.getFullYear(), monthIndex!, day);
    if (
      isBefore(startDateObj, set(pubDate, { date: pubDate.getDate() - 15 }))
    ) {
      startDateObj = addYears(startDateObj, 1);
    }

    let startHour = 0;
    let startMin = 0;
    let endHour = 23;
    let endMin = 59;
    let crossDay = false;

    // Ricerca specifici orari ATAC (es. "dalle 8,30 alle 12,30" o "dalle 8.30 alle 12.30")
    const timeBlockRegex =
      /dalle\s+(\d{1,2})(?:[,.](\d{2}))?\s+alle\s+(\d{1,2})(?:[,.](\d{2}))?/i;
    const timeMatch = fullText.match(timeBlockRegex);

    if (fullText.includes('24 ore') || fullText.includes('intera giornata')) {
      // Sciopero di 24 ore: va dalle 00:00 alle 23:59 o da inizio a fine servizio
      startHour = 0;
      endHour = 23;
      endMin = 59;
    } else if (timeMatch) {
      // Sciopero parziale (es. di 4 ore)
      startHour = Number.parseInt(timeMatch[1]!, 10);
      startMin = timeMatch[2] ? Number.parseInt(timeMatch[2]!, 10) : 0;
      endHour = Number.parseInt(timeMatch[3]!, 10);
      endMin = timeMatch[4] ? Number.parseInt(timeMatch[4]!, 10) : 0;

      // Se fine < inizio, scavalla la mezzanotte
      if (endHour < startHour) crossDay = true;
    }

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

    if (crossDay) {
      endDateObj = addDays(endDateObj, 1);
    }

    return {
      start: format(startDateObj, 'yyyy-MM-dd HH:mm:ss'),
      end: format(endDateObj, 'yyyy-MM-dd HH:mm:ss'),
    };
  }

  private extractGuaranteedTimes(text: string): string[] {
    const guarantees = new Set<string>();

    // ATAC di solito ha le fasce: "da inizio servizio alle 8:30" (mettiamo 05:30 come standard inizio diurno)
    // E "dalle 17:00 alle 20:00". Analizziamo il testo per cercare queste diciture.

    const hasMorningBand = /fino\s+alle\s+8[,.]30|alle\s+8[,.]30/i.test(text);
    const hasEveningBand =
      /17\s*alle\s*20/i.test(text) || /17\.00\s*alle\s*20\.00/i.test(text);

    if (hasMorningBand) {
      guarantees.add('05:30-08:30'); // ATAC inizia il diurno tipicamente alle 5:30
    }

    if (hasEveningBand) {
      guarantees.add('17:00-20:00');
    }

    return Array.from(guarantees).sort();
  }
}
