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
  private readonly logger = new Logger(ATACManualParser.name);

  readonly name = 'ATAC-Manual-Regex';
  readonly parserType = 'manual';

  // private readonly logger = {
  //   debug: (..._args: unknown[]) => {},
  //   warn: (..._args: unknown[]) => {},
  //   error: (..._args: unknown[]) => {},
  // } as Logger;

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

  parse(html: string, _options?: ParseOptions): ParserResponse {
    this.logger.debug('Starting parse of ATAC HTML content');

    const start = performance.now();

    const $ = cheerio.load(html);
    $(
      'script, style, svg, noscript, iframe, canvas, link, meta, header, footer, nav, aside',
    ).remove();

    const titleText =
      $('h1').first().text().trim() || $('h2').first().text().trim();
    const bodyText = $('main, .elementor-widget-container, #main-content')
      .find('p, li, strong')
      .map((_i, el) => $(el).text())
      .get()
      .join(' ')
      .replace(/\s+/g, ' ')
      .trim();

    const fullText = `${titleText} ${bodyText}`.toLowerCase();

    // 1. FILTRO FALSI POSITIVI (Revocati, Differiti o Resoconti Post-Sciopero)
    if (
      fullText.includes('revocato') ||
      fullText.includes('sospeso') ||
      // (fullText.includes('sportello') && !fullText.includes('possibile')) ||
      fullText.includes('differito') ||
      fullText.includes('rinviato') ||
      fullText.includes('adesione') || // "adesione al 53%" -> post sciopero
      fullText.includes('rilevata in mattinata') ||
      fullText.includes('regolarmente in servizio')
    ) {
      return this.buildBadResult(performance.now() - start);
    }

    // 2. ESTRAZIONE DATA DI PUBBLICAZIONE (chiave per il "domani")
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

    // 3. CALCOLO DATE E ORARI SCIOPERO
    const timeInfo = this.extractDatesAndTimes(titleText, bodyText, pubDate);
    if (!timeInfo) {
      return this.buildBadResult(performance.now() - start);
    }

    // 4. GESTIONE LOCATION (Nazionale vs Regionale)
    let locationType: LocationType = LocationType.REGIONAL;
    let locationCodes: LocationCode[] | undefined = ['12']; // Lazio

    // Se c'è scritto nazionale MA non è esplicitamente limitato alla sola rete romana
    const isNazionale = fullText.includes('nazionale');
    const isStrictlyRegionale =
      fullText.includes('regionale') || titleText.includes('rete atac');

    if (isNazionale && !isStrictlyRegionale) {
      locationType = LocationType.NATIONAL;
      locationCodes = undefined;
    }

    // 5. FASCE DI GARANZIA
    const guaranteedTimes = this.extractGuaranteedTimes(
      fullText,
      timeInfo.is24h,
    );

    return {
      data: {
        isStrike: true,
        strikeData: {
          startDate: timeInfo.start,
          endDate: timeInfo.end,
          locationType,
          locationCodes,
          guaranteedTimes,
        },
      },
      metadata: {
        parserType: 'manual',
        durationMs: performance.now() - start,
        info: 'ATAC Smart Regex (Supports relative dates and custom formats)',
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
  ): { start: string; end: string; is24h: boolean } | null {
    const cleanTitle = title.toLowerCase();
    const cleanBody = body.toLowerCase();
    const fullText = `${cleanTitle} ${cleanBody}`;

    let startDateObj: Date | null = null;

    // A. RICERCA DATA ESPLICITA (es. "17 giugno")
    const dateRegex =
      /(?:luned[iì]|marted[iì]|mercoled[iì]|gioved[iì]|venerd[iì]|sabato|domenica)?\s*(\d{1,2})\s+(gennaio|febbraio|marzo|aprile|maggio|giugno|luglio|agosto|settembre|ottobre|novembre|dicembre)/i;
    const dateMatch = cleanTitle.match(dateRegex) || cleanBody.match(dateRegex);

    if (dateMatch) {
      const day = Number.parseInt(dateMatch[1]!, 10);
      const monthName = dateMatch[2]!.toLowerCase();
      const monthIndex = this.MONTH_MAP[monthName];

      startDateObj = new Date(pubDate.getFullYear(), monthIndex!, day);
      if (
        isBefore(startDateObj, set(pubDate, { date: pubDate.getDate() - 15 }))
      ) {
        startDateObj = addYears(startDateObj, 1);
      }
    }
    // B. RICERCA DATA RELATIVA ("domani", "oggi")
    else if (fullText.includes('domani')) {
      startDateObj = addDays(pubDate, 1);
    } else if (
      fullText.includes('oggi') ||
      fullText.includes('in mattinata') ||
      fullText.includes('stasera')
    ) {
      startDateObj = pubDate;
    }

    if (!startDateObj) return null; // Se non troviamo nessuna data, fallisce.

    // C. ESTRAZIONE ORARI E DURATA
    let startHour = 0;
    let startMin = 0;
    let endHour = 23;
    let endMin = 59;
    let crossDay = false;
    let is24h = false;

    // Ricerca orari (es "dalle 8,30 alle 12,30" o "dalle 20 alle 24")
    const timeBlockRegex =
      /dalle\s+(\d{1,2})(?:[,.](\d{2}))?\s+(?:alle|al|a)\s+(\d{1,2})(?:[,.](\d{2}))?/i;
    const timeMatch = fullText.match(timeBlockRegex);

    if (
      fullText.includes('24 ore') ||
      fullText.includes('intera giornata') ||
      fullText.includes('sciopero generale nazionale')
    ) {
      is24h = true;
    } else if (timeMatch) {
      startHour = Number.parseInt(timeMatch[1]!, 10);
      startMin = timeMatch[2] ? Number.parseInt(timeMatch[2]!, 10) : 0;

      const rawEndHour = Number.parseInt(timeMatch[3]!, 10);
      endMin = timeMatch[4] ? Number.parseInt(timeMatch[4]!, 10) : 0;

      // Risolve il problema del log: "got 2024-04-12 00:00:00" -> se l'ora è "24", settala a "23:59"
      if (rawEndHour === 24) {
        endHour = 23;
        endMin = 59;
      } else {
        endHour = rawEndHour;
        if (endHour < startHour) crossDay = true;
      }
    }

    // Applica orari all'oggetto Start
    startDateObj = set(startDateObj, {
      hours: startHour,
      minutes: startMin,
      seconds: 0,
      milliseconds: 0,
    });

    // Applica orari all'oggetto End
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
      is24h,
    };
  }

  private extractGuaranteedTimes(
    text: string,
    is24h: boolean,
  ): string[] | undefined {
    // Se è uno sciopero breve (4 o 8 ore), le fasce non vanno esplicitate per schema (risolve i fallimenti "Expected undefined")
    if (!is24h) {
      return undefined;
    }

    const guarantees = new Set<string>();

    // Pattern per fasce ATAC
    const hasMorningBand = /fino\s+alle\s+8[,.]30|alle\s+8[,.]30/i.test(text);
    const hasEveningBand =
      /17\s*alle\s*20/i.test(text) || /17\.00\s*alle\s*20\.00/i.test(text);

    // Risolve il problema del log: "Expected [00:00-08:30...]"
    if (hasMorningBand) {
      guarantees.add('00:00-08:30');
    }

    if (hasEveningBand) {
      guarantees.add('17:00-20:00');
    }

    const result = Array.from(guarantees).sort();
    return result.length > 0 ? result : undefined;
  }
}
