#!/usr/bin/env python3

import argparse
import os
import sys
import random
import time
import json
import re
from datetime import datetime, timedelta
from openai import OpenAI
from concurrent.futures import ThreadPoolExecutor, as_completed
from threading import Lock
from dotenv import load_dotenv

# Import the existing helper to generate the HTML file
from mk_trenitalia_custom_strike import build_config, process_html

load_dotenv(
    dotenv_path="/home/bitrey/Documents/webdev_projects/ce-sciopero/apps/backend/.env"
)

# --- CONFIGURATION ---
TEMPLATE_PATH = "/home/bitrey/Documents/webdev_projects/ce-sciopero/apps/backend/src/benchmarks/data/Trenitalia/trenitalia-strike-detail-www-rfi-it-content-rfi-it-news-e-media-infomobilita-avvisi-2026-1-12-sciopero-del-personale-di-treno.html"
OUTPUT_DIR = "/home/bitrey/Documents/webdev_projects/ce-sciopero/apps/backend/src/benchmarks/data/Trenitalia/ai_strikes"

# Thread-safe printing
print_lock = Lock()

# DeepSeek API setup
DEEPSEEK_API_KEY = os.environ.get("DEEPSEEK_API_KEY")
if not DEEPSEEK_API_KEY:
    print("Warning: DEEPSEEK_API_KEY environment variable not set.")
    sys.exit(1)

client = OpenAI(api_key=DEEPSEEK_API_KEY, base_url="https://api.deepseek.com")

# --- STATIC DATA FOR VARIETY ---

STRIKE_TYPES = [
    "sciopero nazionale",
    "sciopero regionale",
    "agitazione sindacale",
    "sciopero del personale mobile",
    "protesta sindacale autonoma",
]

# Trenitalia specific services
SERVICES = [
    "Alta Velocità, Intercity e Regionali",
    "Treni Regionali",
    "Frecce e Intercity",
    "Tutto il trasporto ferroviario",
    "Personale di macchina e bordo",
]

# Companies often involved in RFI announcements
COMPANIES = [
    "Gruppo FS Italiane",
    "Trenitalia",
    "Trenitalia e Italo",
    "Trenitalia Tper",
    "RFI (Rete Ferroviaria Italiana)",
]

ITALIAN_DAYS = [
    "lunedì",
    "martedì",
    "mercoledì",
    "giovedì",
    "venerdì",
    "sabato",
    "domenica",
]

ITALIAN_MONTHS = [
    "gennaio",
    "febbraio",
    "marzo",
    "aprile",
    "maggio",
    "giugno",
    "luglio",
    "agosto",
    "settembre",
    "ottobre",
    "novembre",
    "dicembre",
]

# Regions for "Region" field (matching TypeScript regions.ts structure)
REGIONS_ARR = [
    ["01", "Piemonte"],
    ["02", "Valle d'Aosta"],
    ["03", "Lombardia"],
    ["04", "Trentino-Alto Adige"],
    ["05", "Veneto"],
    ["06", "Friuli-Venezia Giulia"],
    ["07", "Liguria"],
    ["08", "Emilia-Romagna"],
    ["09", "Toscana"],
    ["10", "Umbria"],
    ["11", "Marche"],
    ["12", "Lazio"],
    ["13", "Abruzzo"],
    ["14", "Molise"],
    ["15", "Campania"],
    ["16", "Puglia"],
    ["17", "Basilicata"],
    ["18", "Calabria"],
    ["19", "Sicilia"],
    ["20", "Sardegna"],
]

# Helper to get region names for AI prompt
REGION_NAMES = {code: name for code, name in REGIONS_ARR}


def generate_strike_details(date):
    """
    Generate programmed strike details (times, logic) BEFORE asking AI.
    This ensures we have a 'ground truth' that is mathematically correct.
    """
    is_national = random.choice([True, False])
    location_type = "NATIONAL" if is_national else "REGION"

    # Common Trenitalia/RFI strike patterns
    strike_patterns = [
        ("09:00:00", "17:00:00", False),  # Standard work day (8h)
        ("21:00:00", "21:00:00", True),  # The classic 24h shift (Sat-Sun)
        ("00:00:00", "23:59:59", False),  # Full calendar day
        ("03:00:00", "02:00:00", True),  # Night shift crossover
        ("09:01:00", "16:59:00", False),  # Precise minutes
    ]

    pattern = random.choice(strike_patterns)
    start_time_str = pattern[0]
    end_time_str = pattern[1]
    crosses_midnight = pattern[2]

    start_date = date
    end_date = date + timedelta(days=1) if crosses_midnight else date

    start_datetime_iso = f"{start_date.strftime('%Y-%m-%d')} {start_time_str}"
    end_datetime_iso = f"{end_date.strftime('%Y-%m-%d')} {end_time_str}"

    # Formatted strings for the AI prompt (e.g., "dalle ore 21:00 di sabato...")
    start_readable = f"{start_time_str[:5]}"
    end_readable = f"{end_time_str[:5]}"

    strike_data = {
        "startDate": start_datetime_iso,
        "endDate": end_datetime_iso,
        "locationType": location_type,
        "crossesMidnight": crosses_midnight,
        "startReadable": start_readable,
        "endReadable": end_readable,
    }

    # Assign regions if not national
    if not is_national:
        # Pick 1 to 3 random regions
        selected_regions = random.sample(REGIONS_ARR, k=random.randint(1, 3))
        # Store codes for ground truth
        strike_data["regionCodes"] = [code for code, name in selected_regions]
        # Store names for AI prompt
        strike_data["regionNames"] = ", ".join(
            [name for code, name in selected_regions]
        )
    else:
        strike_data["regionCodes"] = []
        strike_data["regionNames"] = "Tutto il territorio nazionale"

    # Assign Guaranteed Times (Fasce di garanzia) logic
    # Usually active on weekdays 6-9 and 18-21
    is_weekday = start_date.weekday() < 5
    if is_weekday and not crosses_midnight:  # Simplified logic
        strike_data["guaranteedTimes"] = ["06:00-09:00", "18:00-21:00"]

    return strike_data


def generate_random_date():
    """Generate a random date within -1 to +2 years."""
    days_offset = random.randint(-365, 730)
    future_date = datetime.now() + timedelta(days=days_offset)

    day_name = ITALIAN_DAYS[future_date.weekday()]
    month_name = ITALIAN_MONTHS[future_date.month - 1]

    # Format: "venerdì 13 febbraio 2026"
    date_text_full = f"{day_name} {future_date.day} {month_name} {future_date.year}"
    # Format: "13 FEBBRAIO 2026" (Common in RFI headers)
    date_text_header = f"{future_date.day} {month_name.upper()} {future_date.year}"

    date_iso = future_date.strftime("%Y-%m-%d")

    return future_date, date_text_full, date_text_header, date_iso, day_name


def generate_strike_content_with_deepseek(
    date_objs, strike_details, service, company, strike_type
):
    """
    Use DeepSeek to generate realistic RFI/Trenitalia announcement content
    based on the PRE-CALCULATED strike details.
    """

    # Unpack date objects
    date_obj, date_full, date_header, date_iso, day_name = date_objs

    # Prepare timing string for prompt
    end_date_obj = datetime.strptime(strike_details["endDate"], "%Y-%m-%d %H:%M:%S")
    end_day_name = ITALIAN_DAYS[end_date_obj.weekday()]
    # end_month_name = ITALIAN_MONTHS[end_date_obj.month - 1]

    if strike_details["crossesMidnight"]:
        timing_phrase = f"dalle ore {strike_details['startReadable']} di {day_name} {date_obj.day} {date_obj.year} alle ore {strike_details['endReadable']} di {end_day_name} {end_date_obj.day} {end_date_obj.year}"
    else:
        timing_phrase = f"dalle ore {strike_details['startReadable']} alle ore {strike_details['endReadable']} di {day_name} {date_obj.day} {date_obj.month} {date_obj.year}"

    guarantee_text = ""
    if "guaranteedTimes" in strike_details:
        guarantee_text = "Nelle fasce orarie 6.00-9.00 e 18.00-21.00 circoleranno i treni presenti nella lista dei servizi garantiti."

    prompt = f"""Genera un avviso ufficiale per il sito di RFI (Rete Ferroviaria Italiana) riguardante uno sciopero.
    
    DATI OBBLIGATORI (Non modificarli):
    - Periodo: {timing_phrase}
    - Tipologia: {strike_type} ({strike_details['locationType']})
    - Servizi: {service}
    - Aziende: {company}
    - Regioni: {strike_details['regionNames']}
    - Fasce garanzia: {guarantee_text}

    STILE E TONO (RFI/Trenitalia):
    - Istituzionale, asettico, tecnico.
    - Usa SEMPRE il grassetto HTML <strong> per gli orari e le date.
    - Inserisci la frase standard: "L’agitazione sindacale può comportare modifiche al servizio anche prima dell’inizio e dopo la sua conclusione."
    - Inserisci il riferimento ai canali digitali e app.

    STRUTTURA HTML:
    - Non usare H1 o H2 (sono gestiti dal template).
    - Usa paragrafi <p>.
    - Esempio inizio: "<p><strong>{timing_phrase.split(' ', 1)[0].capitalize() + timing_phrase.split(' ', 1)[1]}</strong> è stato indetto uno sciopero..."
    
    Output SOLO JSON valido:
    {{
      "title": "Titolo in MAIUSCOLO conciso (es: 'SCIOPERO NAZIONALE PERSONALE GRUPPO FS')",
      "description": "Descrizione breve per meta tag (max 150 caratteri)",
      "body_html": "HTML del corpo dell'avviso"
    }}
    """

    try:
        response = client.chat.completions.create(
            model="deepseek-chat",
            messages=[
                {
                    "role": "system",
                    "content": "Sei un redattore dell'ufficio stampa di Rete Ferroviaria Italiana. Scrivi avvisi tecnici precisi. Rispondi solo JSON.",
                },
                {"role": "user", "content": prompt},
            ],
            stream=False,
            temperature=0.7,
        )

        content = response.choices[0].message.content
        if content is None:
            raise ValueError("API returned empty")

        # Clean markdown
        content = content.strip()
        if content.startswith("```"):
            content = re.sub(r"^```json|^```", "", content).strip()
            content = re.sub(r"```$", "", content).strip()

        return json.loads(content)

    except Exception as e:
        print(f"DeepSeek Error: {e}")
        # Fallback consistent with Trenord script logic
        return {
            "title": f"SCIOPERO {service.upper()}",
            "description": f"Avviso di sciopero {strike_type} previsto per il {date_header}.",
            "body_html": f"""
            <p><strong>{timing_phrase.capitalize()}</strong> è indetto uno sciopero del personale di {company}.</p>
            <p>L’agitazione sindacale può comportare modifiche al servizio anche prima dell’inizio e dopo la sua conclusione.</p>
            <p>Maggiori informazioni sui servizi minimi garantiti in caso di sciopero sono disponibili sui canali digitali delle Imprese ferroviarie.</p>
            """,
        }


def safe_print(*args, **kwargs):
    with print_lock:
        print(*args, **kwargs)


def generate_single_announcement(index, total, output_subdir):
    """Generate a single announcement - designed to run in parallel."""
    try:
        # 1. Generate Random Data
        date_obj, date_full, date_header, date_iso, day_name = generate_random_date()
        date_tuple = (date_obj, date_full, date_header, date_iso, day_name)

        service = random.choice(SERVICES)
        company = random.choice(COMPANIES)
        strike_type = random.choice(STRIKE_TYPES)

        # 2. Generate Logic (The Truth)
        strike_details = generate_strike_details(date_obj)

        safe_print(
            f"[{index+1}/{total}] Logic: {strike_details['startReadable']} - {strike_details['endReadable']} ({strike_details['locationType']})"
        )

        # 3. Generate Content (The Writer)
        content = generate_strike_content_with_deepseek(
            date_tuple, strike_details, service, company, strike_type
        )

        # 4. Build Configuration for the Helper Script
        # We simulate the argparse 'Args' object expected by build_config
        class Args:
            def __init__(self):
                self.template = TEMPLATE_PATH
                self.output = None  # Set later
                self.title = content["title"]
                self.date_text = date_header  # e.g. "13 FEBBRAIO 2026"
                self.description = content["description"]
                self.service = service
                self.cause = strike_type.capitalize()
                self.regions = strike_details["regionNames"]
                self.companies = company
                self.body_file = None  # We inject HTML directly

        args = Args()
        config = build_config(args)

        # Override the body with AI content
        config["BODY_HTML"] = content["body_html"]

        # Set output path with unique timestamp/index
        filename = f"strike_rfi_{date_iso}_{index+1:03d}_{int(time.time())}.html"
        config["OUTPUT_PATH"] = os.path.join(output_subdir, filename)

        # 5. Process HTML
        process_html(config)

        safe_print(f"[{index+1}/{total}] ✓ Saved: {filename}")

        return {
            "success": True,
            "index": index,
            "filename": filename,
            "title": content["title"],
            # THE IMPORTANT PART: Structured Ground Truth
            "strike_data": {
                "startDate": strike_details["startDate"],
                "endDate": strike_details["endDate"],
                "locationType": strike_details["locationType"],
                "regions": strike_details[
                    "regionCodes"
                ],  # Use region CODES in ground truth
                "guaranteedTimes": strike_details.get("guaranteedTimes", []),
            },
        }

    except Exception as e:
        safe_print(f"[{index+1}/{total}] ✗ Error: {str(e)}")
        return {"success": False, "index": index, "error": str(e)}


def main():
    """Main execution with parallel processing."""

    # Parse command-line arguments
    parser = argparse.ArgumentParser(
        description="Generate Trenitalia/RFI strike announcements using DeepSeek AI"
    )
    parser.add_argument(
        "-n",
        "--num-announcements",
        type=int,
        default=10,
        help="Total number of announcements to generate (default: 3)",
    )
    parser.add_argument(
        "-w",
        "--max-workers",
        type=int,
        default=10,
        help="Number of parallel workers (default: 3)",
    )
    args = parser.parse_args()

    num_announcements = args.num_announcements
    max_workers = args.max_workers

    timestamp = datetime.now().strftime("%Y%m%d_%H%M%S")
    output_subdir = os.path.join(OUTPUT_DIR, f"batch_{timestamp}")
    os.makedirs(output_subdir, exist_ok=True)

    print("=" * 70)
    print("TRENITALIA/RFI STRIKE GENERATOR (DEEPSEEK ENHANCED)")
    print(f"Total: {num_announcements} | Workers: {max_workers}")
    print(f"Output: {output_subdir}")
    print("=" * 70)

    start_time = datetime.now()
    results = []

    with ThreadPoolExecutor(max_workers=max_workers) as executor:
        futures = {
            executor.submit(
                generate_single_announcement, i, num_announcements, output_subdir
            ): i
            for i in range(num_announcements)
        }

        for future in as_completed(futures):
            results.append(future.result())

    # Sort results
    results.sort(key=lambda x: x["index"])

    # Generate Ground Truth JSON
    # This matches the structure of the Trenord ground truth for consistency
    ground_truth = {}
    for r in results:
        if r["success"]:
            ground_truth[r["filename"]] = {
                "isStrike": True,
                "strikeData": r["strike_data"],
            }

    ground_truth_path = os.path.join(output_subdir, "ground-truth.json")
    with open(ground_truth_path, "w", encoding="utf-8") as f:
        json.dump(ground_truth, f, indent=2, ensure_ascii=False)

    # Statistics
    duration = (datetime.now() - start_time).total_seconds()
    successful = sum(1 for r in results if r["success"])

    print("\n" + "=" * 70)
    print("GENERATION COMPLETE")
    print(f"Time: {duration:.2f}s ({duration/num_announcements:.2f}s/file)")
    print(f"Success: {successful}/{num_announcements}")
    print(f"Ground Truth: {ground_truth_path}")
    print("=" * 70)


if __name__ == "__main__":
    main()
