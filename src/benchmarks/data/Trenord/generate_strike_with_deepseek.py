#!/usr/bin/env python3

import argparse
import os
import sys
import random
import time
import json
from datetime import datetime, timedelta
from openai import OpenAI
from concurrent.futures import ThreadPoolExecutor, as_completed
from threading import Lock
from mk_trenord_custom_strike import build_config, process_html
from dotenv import load_dotenv

load_dotenv(
    dotenv_path="/home/bitrey/Documents/webdev_projects/ce-sciopero/apps/backend/.env"
)

# Configuration
TEMPLATE_PATH = "/home/bitrey/Documents/webdev_projects/ce-sciopero/apps/backend/src/benchmarks/data/Trenord/strike-detail-venerd--29-novembre-revocato-sciopero-ferrovienord.html"
OUTPUT_DIR = "/home/bitrey/Documents/webdev_projects/ce-sciopero/apps/backend/src/benchmarks/data/Trenord/ai_strikes"

# Thread-safe printing
print_lock = Lock()

# DeepSeek API setup
DEEPSEEK_API_KEY = os.environ.get("DEEPSEEK_API_KEY")
if not DEEPSEEK_API_KEY:
    print("Warning: DEEPSEEK_API_KEY environment variable not set.")
    print("Please set it with: export DEEPSEEK_API_KEY='your-api-key'")
    sys.exit(1)

client = OpenAI(api_key=DEEPSEEK_API_KEY, base_url="https://api.deepseek.com")

# Static data for variety
STRIKE_TYPES = [
    "sciopero nazionale",
    "sciopero regionale",
    "agitazione del personale",
    "sciopero ferroviario",
    "protesta sindacale",
]

STAFF_CATEGORIES = [
    "personale di bordo e di macchina",
    "personale ferroviario",
    "macchinisti e capotreno",
    "lavoratori del trasporto ferroviario",
    "dipendenti Trenord",
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

# Regions with codes (matching TypeScript regions.ts structure)
# Only northern regions for Trenord (Lombardia-based company)
REGIONS_ARR = [
    ["01", "Piemonte"],
    ["02", "Valle d'Aosta"],
    ["03", "Lombardia"],
    ["04", "Trentino-Alto Adige"],
    ["05", "Veneto"],
    ["06", "Friuli-Venezia Giulia"],
    ["07", "Liguria"],
]

# Helper to get region names for AI prompt
REGION_NAMES = {code: name for code, name in REGIONS_ARR}

# Lombardia code for regional strikes
LOMBARDIA_CODE = "03"


def generate_strike_details(date):
    """Generate random strike details including times and location."""
    is_national = random.choice([True, False])
    location_type = "NATIONAL" if is_national else "REGION"

    # Generate strike hours
    strike_patterns = [
        ("00:00:00", "23:59:59"),  # Full day
        ("03:00:00", "02:00:00", True),  # Cross-midnight (3am to 2am next day)
        ("09:00:00", "13:00:00"),  # Morning
        ("09:00:00", "17:00:00"),  # Business hours
        ("21:00:00", "21:00:00", True),  # 24h from 9pm to 9pm next day
        ("00:01:00", "21:00:00"),  # Start of day to 9pm
        ("09:01:00", "17:00:00"),  # Slightly after 9am to 5pm
    ]

    pattern = random.choice(strike_patterns)
    start_time = pattern[0]
    end_time = pattern[1]
    crosses_midnight = len(pattern) > 2 and pattern[2]

    start_date = date
    end_date = date + timedelta(days=1) if crosses_midnight else date

    start_datetime = f"{start_date.strftime('%Y-%m-%d')} {start_time}"
    end_datetime = f"{end_date.strftime('%Y-%m-%d')} {end_time}"

    strike_data = {
        "startDate": start_datetime,
        "endDate": end_datetime,
        "locationType": location_type,
    }

    # Add region codes if regional strike
    if not is_national:
        # Always include Lombardia, then add 0-2 other random regions
        other_regions = [r for r in REGIONS_ARR if r[0] != LOMBARDIA_CODE]
        selected_regions = [r for r in REGIONS_ARR if r[0] == LOMBARDIA_CODE]
        selected_regions.extend(random.sample(other_regions, k=random.randint(0, 2)))
        strike_data["locationCodes"] = [code for code, name in selected_regions]  # type: ignore

    # Add guaranteed times (50% chance)
    if random.random() < 0.5:
        strike_data["guaranteedTimes"] = ["06:00-09:00", "18:00-21:00"]  # type: ignore

    return strike_data


def generate_random_date():
    """Generate a random date within the past 2 years to future 2 years."""
    days_offset = random.randint(-730, 730)  # 2 years * 365 ≈ 730 days
    future_date = datetime.now() + timedelta(days=days_offset)

    day_name = ITALIAN_DAYS[future_date.weekday()]
    month_name = ITALIAN_MONTHS[future_date.month - 1]

    date_text = (
        f"{day_name} {future_date.day:02d}/{future_date.month:02d}/{future_date.year}"
    )
    date_iso = future_date.strftime("%Y-%m-%d")

    return date_text, date_iso, day_name, future_date.day, month_name, future_date.year


def generate_strike_content_with_deepseek(
    date_text, day_name, day, month, year, strike_type, staff_category, strike_data
):
    """Use DeepSeek to generate realistic Italian strike announcement content."""

    location_info = f"Tipo: {strike_data['locationType']}"
    if "locationCodes" in strike_data:
        region_names = [
            REGION_NAMES.get(code, code) for code in strike_data["locationCodes"]
        ]
        location_info += f" (Regioni: {', '.join(filter(None, region_names))})"

    time_info = f"Orario: dalle {strike_data['startDate'].split()[1]} alle {strike_data['endDate'].split()[1]}"
    if "guaranteedTimes" in strike_data:
        time_info += f"\nFasce di garanzia: {', '.join(strike_data['guaranteedTimes'])}"

    prompt = f"""Genera un annuncio di sciopero ferroviario per Trenord (azienda ferroviaria lombarda) in italiano.

Data dello sciopero: {day_name} {day} {month} {year}
Tipo: {strike_type}
Personale coinvolto: {staff_category}
{location_info}
{time_info}

STILE E TONO:
- Formale ma accessibile, come un comunicato ufficiale di trasporto pubblico
- Informativo senza essere allarmistico
- Empatico verso i passeggeri ("Si invitano i passeggeri...", "Si raccomanda...")
- Uso di grassetto <strong> per evidenziare informazioni critiche
- Paragrafi brevi e chiari

STRUTTURA TIPICA:
1. Primo paragrafo <h4> con <strong>: sintesi dell'impatto principale (es. "L'agitazione riguarda il personale...")
2. Paragrafo che spiega chi ha indetto lo sciopero e orari
3. Dettagli su linee/servizi interessati (es. "ripercussioni sulla circolazione ferroviaria in Lombardia")
4. Fasce di garanzia: SEMPRE menzionare "Le fasce di garanzia saranno attive dalle 6 alle 9 e dalle 18 alle 21"
5. Informazioni su come informarsi (App, sito, monitor di stazione)
6. Chiusura con invito ad attenzione: "Si invitano i passeggeri a prestare attenzione agli annunci sonori e ai monitor di stazione"

ESEMPI DI FRASI TIPICHE:
- "I sindacati [nome] hanno indetto uno sciopero che potrà generare ripercussioni..."
- "Le corse potranno subire variazioni e cancellazioni"
- "Previste ripercussioni sul servizio regionale, suburbano, aeroportuale"
- "Le informazioni sulla circolazione saranno disponibili su trenord.it e App"
- "Si invitano i passeggeri a prestare attenzione agli annunci sonori e ai monitor di stazione"

DETTAGLI TECNICI:
- Usa entità HTML: à = à, è = è, ì = ì, ò = ò, ù = ù
- Usa &nbsp; per spazi non separabili
- NON inventare nomi di linee specifiche (S1, S2, ecc.) o stazioni, resta generico
- Menziona sempre "servizio regionale, suburbano" e "collegamenti aeroportuali Malpensa Express"

Fornisci SOLO un oggetto JSON con questa struttura esatta (senza markdown, senza spiegazioni):
{{
  "title": "Titolo conciso senza data (es: 'Sciopero nazionale - possibili ripercussioni sul servizio')",
  "description": "Breve descrizione 100-150 caratteri per social, es: 'Informazioni sullo sciopero che potrà interessare i servizi ferroviari in Lombardia'",
  "body_html": "Corpo HTML completo con struttura: <h4><strong>...</strong></h4> poi 4-6 paragrafi <p> con le info essenziali"
}}"""

    try:
        response = client.chat.completions.create(
            model="deepseek-chat",
            messages=[
                {
                    "role": "system",
                    "content": "Sei un esperto redattore di comunicati per Trenord, l'azienda di trasporto ferroviario regionale lombardo. Scrivi in italiano professionale ma accessibile, seguendo lo stile dei comunicati ufficiali. Rispondi SOLO con JSON valido, senza markdown.",
                },
                {"role": "user", "content": prompt},
            ],
            stream=False,
            temperature=0.7,
        )

        content = response.choices[0].message.content
        if content is None:
            raise ValueError("API returned empty content")
        content = content.strip()

        # Remove markdown code blocks if present
        if content.startswith("```"):
            content = content.split("```")[1]
            if content.startswith("json"):
                content = content[4:]
            content = content.strip()

        import json

        result = json.loads(content)

        return result

    except Exception as e:
        print(f"Error calling DeepSeek API: {e}")
        # Fallback to default content
        return {
            "title": f"{strike_type.title()} - Possibili disagi alla circolazione",
            "description": f"Informazioni sullo {strike_type} che potrebbe interessare i servizi ferroviari in Lombardia.",
            "body_html": f"""
<h4><strong>L'agitazione riguarda il {staff_category}.</strong></h4>
<p>&nbsp;</p>
<p>Si informa che i sindacati hanno indetto uno sciopero che potrà generare ripercussioni sulla circolazione ferroviaria in Lombardia.</p>
<p>Le fasce di garanzia saranno attive dalle 6 alle 9 e dalle 18 alle 21.</p>
<p>&nbsp;</p>
<p>Si invitano i viaggiatori a prestare attenzione agli annunci sonori e ai monitor di stazione.</p>
""",
        }


def safe_print(*args, **kwargs):
    """Thread-safe print function."""
    with print_lock:
        print(*args, **kwargs)


def generate_single_announcement(index, total, output_subdir):
    """Generate a single announcement - designed to run in parallel."""
    try:
        # Generate random date and parameters
        date_text, date_iso, day_name, day, month, year = generate_random_date()
        date_obj = datetime.strptime(date_iso, "%Y-%m-%d")
        strike_type = random.choice(STRIKE_TYPES)
        staff_category = random.choice(STAFF_CATEGORIES)

        # Generate strike details
        strike_data = generate_strike_details(date_obj)

        safe_print(f"[{index+1}/{total}] Starting generation...")
        safe_print(f"  Date: {date_text}")
        safe_print(f"  Type: {strike_type}")
        safe_print(f"  Location: {strike_data['locationType']}")

        # Generate content with DeepSeek
        content = generate_strike_content_with_deepseek(
            date_text,
            day_name,
            day,
            month,
            year,
            strike_type,
            staff_category,
            strike_data,
        )

        safe_print(f"[{index+1}/{total}] ✓ Content generated from DeepSeek")

        # Prepare configuration
        class Args:
            def __init__(self):
                self.template = TEMPLATE_PATH
                self.output = None
                self.title = content["title"]
                self.date_text = date_text
                self.date_iso = date_iso
                self.description = content["description"]
                self.slug = None

        args = Args()
        config = build_config(args)
        config["BODY_HTML"] = content["body_html"]

        # Set output path
        output_filename = f"strike_{date_iso}_{index+1:03d}_{int(time.time())}.html"
        config["OUTPUT_PATH"] = os.path.join(output_subdir, output_filename)

        # Process and generate HTML
        process_html(config)

        safe_print(f"[{index+1}/{total}] ✓ File saved: {output_filename}")

        return {
            "success": True,
            "index": index,
            "filename": output_filename,
            "title": content["title"][:60],
            "strike_data": strike_data,
        }

    except Exception as e:
        safe_print(f"[{index+1}/{total}] ✗ Error: {str(e)}")
        return {"success": False, "index": index, "error": str(e)}


def main():
    """Main function with parallel execution."""

    # Parse command-line arguments
    parser = argparse.ArgumentParser(
        description="Generate strike announcements using DeepSeek AI"
    )
    parser.add_argument(
        "-n",
        "--num-announcements",
        type=int,
        default=10,
        help="Total number of announcements to generate (default: 500)",
    )
    parser.add_argument(
        "-w",
        "--max-workers",
        type=int,
        default=10,
        help="Number of parallel workers (default: 50)",
    )
    args = parser.parse_args()

    num_announcements = args.num_announcements
    max_workers = args.max_workers
    timestamp = datetime.now().strftime("%Y%m%d_%H%M%S")
    output_subdir = os.path.join(OUTPUT_DIR, f"batch_{timestamp}")
    os.makedirs(output_subdir, exist_ok=True)

    print("=" * 70)
    print("TRENORD STRIKE ANNOUNCEMENT GENERATOR (PARALLEL)")
    print("Using DeepSeek AI for content generation")
    print("=" * 70)
    print(f"Total announcements: {num_announcements}")
    print(f"Parallel workers: {max_workers}")
    print(f"Output directory: {output_subdir}")
    print("=" * 70)
    print()

    start_time = datetime.now()
    results = []

    # Execute in parallel with ThreadPoolExecutor
    with ThreadPoolExecutor(max_workers=max_workers) as executor:
        # Submit all tasks
        futures = {
            executor.submit(
                generate_single_announcement, i, num_announcements, output_subdir
            ): i
            for i in range(num_announcements)
        }

        # Process completed tasks as they finish
        for future in as_completed(futures):
            result = future.result()
            results.append(result)

    # Calculate statistics
    end_time = datetime.now()
    duration = (end_time - start_time).total_seconds()
    successful = sum(1 for r in results if r["success"])
    failed = sum(1 for r in results if not r["success"])

    # Sort results by index for display
    results.sort(key=lambda x: x["index"])

    # Generate ground truth JSON
    ground_truth = {}
    for r in results:
        if r["success"]:
            ground_truth[r["filename"]] = {
                "isStrike": True,
                "strikeData": r["strike_data"],
            }

    # Write ground truth JSON file
    ground_truth_path = os.path.join(output_subdir, "ground-truth.json")
    with open(ground_truth_path, "w", encoding="utf-8") as f:
        json.dump(ground_truth, f, indent=2, ensure_ascii=False)

    print(f"\n✓ Ground truth JSON saved: {ground_truth_path}")

    # Summary
    print("\n" + "=" * 70)
    print("GENERATION COMPLETE")
    print("=" * 70)
    print(f"Duration: {duration:.2f} seconds")
    print(f"Average time per announcement: {duration/num_announcements:.2f}s")
    print(f"Successful: {successful}/{num_announcements}")
    print(f"Failed: {failed}/{num_announcements}")
    print()

    if successful > 0:
        print("Successfully generated files:")
        for r in results:
            if r["success"]:
                print(f"  ✓ {r['filename']}")
                if "title" in r:
                    print(f"    → {r['title']}...")

    if failed > 0:
        print("\nFailed generations:")
        for r in results:
            if not r["success"]:
                print(f"  ✗ Index {r['index']+1}: {r.get('error', 'Unknown error')}")

    print()


if __name__ == "__main__":
    main()
