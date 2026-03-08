#!/usr/bin/env python3

import argparse
import sys
import re
import json
from bs4 import BeautifulSoup

DEFAULT_TEMPLATE = "/home/bitrey/Documents/webdev_projects/ce-sciopero/apps/backend/src/benchmarks/data/Trenitalia/trenitalia-strike-detail-www-rfi-it-content-rfi-it-news-e-media-infomobilita-avvisi-2026-1-12-sciopero-del-personale-di-treno.html"

# HTML di default per il corpo dell'articolo
DEFAULT_BODY_HTML = """
<p><b>Dalle ore 21:00 di sabato 10 maggio alle ore 21:00 di domenica 11 maggio 2026</b> è stato indetto uno sciopero del personale del Gruppo FS Italiane.</p>
<p>Lo sciopero può comportare modifiche al servizio, <b>anche prima dell’inizio e dopo la sua conclusione.</b></p>
<p>Maggiori informazioni sui servizi garantiti in caso di sciopero sono disponibili sui canali digitali delle Imprese ferroviarie o presso il personale di assistenza clienti e le biglietterie.</p>
"""


def generate_slug(title):
    """Genera uno slug URL dal titolo."""
    return (
        title.lower()
        .strip()
        .replace(" ", "-")
        .replace(":", "")
        .replace("/", "-")
        .replace("à", "a")
        .replace("ì", "i")
        .replace("è", "e")
        .replace("é", "e")
        .replace("ò", "o")
        .replace("ù", "u")
        .replace("'", "")
    )


def parse_arguments():
    """Parsing degli argomenti da linea di comando."""
    parser = argparse.ArgumentParser(
        description="Genera file HTML di avviso sciopero Trenitalia/RFI basati su template."
    )

    # File Arguments
    parser.add_argument(
        "-t",
        "--template",
        default=DEFAULT_TEMPLATE,
        help="Percorso del file HTML template.",
    )
    parser.add_argument(
        "-o",
        "--output",
        required=True,
        help="Percorso di salvataggio del nuovo file HTML.",
    )

    # Content Arguments
    parser.add_argument(
        "--title", required=True, help="Titolo dell'avviso (H1 e Meta Title)."
    )
    parser.add_argument(
        "--date-text", required=True, help="Data di validità (es. '12 GENNAIO 2026')."
    )
    parser.add_argument(
        "--description", required=True, help="Descrizione breve per i meta tag."
    )

    # Specifici Trenitalia/RFI
    parser.add_argument(
        "--service",
        default="Regionale, Lunga percorrenza",
        help="Tipo di servizio (es. 'Alta Velocità, Regionale').",
    )
    parser.add_argument("--cause", default="Sciopero", help="Causa della modifica.")
    parser.add_argument(
        "--regions", default="Tutte le regioni", help="Regioni coinvolte."
    )
    parser.add_argument(
        "--companies",
        default="Gruppo FS Italiane",
        help="Imprese coinvolte (es. 'Trenitalia, Italo, Trenord').",
    )

    # Body override
    parser.add_argument(
        "--body-file", help="Percorso a un file di testo/html per il contenuto."
    )

    return parser.parse_args()


def build_config(args):
    """Costruisce il dizionario di configurazione."""
    slug = generate_slug(args.title)

    # Costruzione URL fittizio basato sulla struttura RFI
    # Nota: L'anno/mese/giorno nell'URL sono fittizi in questo generatore statico
    base_domain = "https://www.rfi.it"
    url_path = f"/content/rfi/it/news-e-media/infomobilita/avvisi/2026/1/12/{slug}.html"
    full_url = f"{base_domain}{url_path}"

    body_content = DEFAULT_BODY_HTML
    if args.body_file:
        try:
            with open(args.body_file, "r", encoding="utf-8") as f:
                body_content = f.read()
        except Exception as e:
            print(f"Warning: Impossibile leggere il file body {args.body_file}: {e}")

    return {
        "TEMPLATE_PATH": args.template,
        "OUTPUT_PATH": args.output,
        "TITLE": args.title,
        "DATE_TEXT": args.date_text,  # "In vigore: " verrà aggiunto dallo script se manca
        "DESCRIPTION": args.description,
        "SERVICE": args.service,
        "CAUSE": args.cause,
        "REGIONS": args.regions,
        "COMPANIES": args.companies,
        "FULL_URL": full_url,
        "RELATIVE_URL": url_path,
        "BODY_HTML": body_content,
    }


def update_meta_tags(soup, config):
    """Aggiorna Title, Meta tags standard e OpenGraph."""
    # 1. Update <title>
    if soup.title:
        soup.title.string = config["TITLE"]

    # 2. Update Meta tags
    meta_map = {
        "og:title": config["TITLE"],
        "og:description": config["DESCRIPTION"],
        "og:url": config["FULL_URL"],
        "twitter:text:title": config["TITLE"],
        "twitter:description": config["DESCRIPTION"],
        # Nota: L'immagine la lasciamo originale o andrebbe parametrizzata
    }

    for name, value in meta_map.items():
        # Cerca sia 'name' che 'property' (OG usa property)
        tag = soup.find("meta", attrs={"property": name}) or soup.find(
            "meta", attrs={"name": name}
        )
        if tag:
            tag["content"] = value


def update_digital_data(soup, config):
    """
    Aggiorna l'oggetto Javascript `digitalData` che RFI usa per analytics.
    È dentro un tag <script> e richiede manipolazione stringa/regex.
    """
    scripts = soup.find_all("script", type="text/javascript")
    target_script = None

    for script in scripts:
        if script.string and "var digitalData" in script.string:
            target_script = script
            break

    if target_script:
        # Sostituisce il pageName
        # Pattern: pageName: "RFI:...>Infomobilità>VECCHIO TITOLO"
        new_page_name = f'pageName: "RFI:...>Infomobilità>{config["TITLE"]}"'
        updated_js = re.sub(r'pageName:\s*"[^"]+"', new_page_name, target_script.string)
        target_script.string.replace_with(updated_js)


def update_json_lang(soup, config):
    """
    Aggiorna l'input nascosto `jsonLang` che gestisce il cambio lingua.
    """
    input_tag = soup.find("input", id="jsonLang")
    if input_tag and input_tag.get("value"):
        try:
            data = json.loads(input_tag["value"])
            # Cerca l'entry italiana (di solito indice 0 o dove langShort è IT)
            for item in data:
                if item.get("langShort") == "IT":
                    item["langUrl"] = config["RELATIVE_URL"]
                    item["langTitle"] = config["TITLE"]

            # Aggiorna il valore nell'HTML
            input_tag["value"] = json.dumps(data).replace(
                '"', "&quot;"
            )  # Encoding basico per attributo HTML
        except json.JSONDecodeError:
            print("Warning: Impossibile parsare jsonLang.")


def update_visible_content(soup, config):
    """Aggiorna Breadcrumbs, H1, Data e i box informativi (Note)."""

    # 1. Breadcrumbs
    breadcrumbs_div = soup.find("div", class_="breadcrumbs-and-kits--breadcrumbs")
    if breadcrumbs_div:
        last_link = breadcrumbs_div.find_all("a")[-1]
        if last_link:
            last_link.string = config["TITLE"]
            last_link["title"] = config["TITLE"]

    # 2. H1 Title
    h1 = soup.find("h1", class_="article--heading")
    if h1:
        h1.string = config["TITLE"]

    # 3. Data In Vigore
    date_div = soup.find("div", class_="tabular-data-view--snapshot--place-and-date")
    if date_div:
        span = date_div.find("span")
        if span:
            prefix = "In vigore: "
            # Se l'utente non ha messo il prefisso, lo mettiamo noi
            date_val = (
                config["DATE_TEXT"]
                if config["DATE_TEXT"].lower().startswith("in vigore")
                else f"{prefix}{config['DATE_TEXT']}"
            )
            span.string = date_val

    # 4. Box Note (Servizio, Causa, Regione, Impresa)
    # Questi usano ID specifici nel template RFI
    definitions = {
        "service-adjust": ("Servizio: ", config["SERVICE"]),
        "change-adjust": ("Causa Modifica: ", config["CAUSE"]),
        "region-adjust": ("Regione: ", config["REGIONS"]),
        "company-adjust": ("Impresa: ", config["COMPANIES"]),
    }

    for elem_id, (label, content) in definitions.items():
        note_div = soup.find("div", id=elem_id)
        if note_div:
            # Svuota il contenuto attuale
            note_div.clear()
            # Ricostruisce: "Label: <strong>Content</strong>"
            note_div.append(f"{label}")
            strong_tag = soup.new_tag("strong")
            strong_tag.string = content
            note_div.append(strong_tag)


def update_body_text(soup, config):
    """Sostituisce il corpo del testo dell'avviso."""
    text_div = soup.find("div", class_="article--text")
    if text_div:
        text_div.clear()
        # Parse del nuovo HTML body e inserimento
        new_body_soup = BeautifulSoup(config["BODY_HTML"], "html.parser")
        text_div.append(new_body_soup)


def process_html(config):
    try:
        with open(config["TEMPLATE_PATH"], "r", encoding="utf-8") as f:
            soup = BeautifulSoup(f, "html.parser")
    except FileNotFoundError:
        print(f"Error: Template '{config['TEMPLATE_PATH']}' non trovato.")
        sys.exit(1)

    # Orchestrazione modifiche
    update_meta_tags(soup, config)
    update_digital_data(soup, config)  # Javascript var
    update_json_lang(soup, config)  # Hidden input JSON
    update_visible_content(soup, config)
    update_body_text(soup, config)

    # Salvataggio
    try:
        with open(config["OUTPUT_PATH"], "w", encoding="utf-8") as f_out:
            # prettify() a volte rompe layout complessi, meglio string standard o formatter minimal
            f_out.write(str(soup))

        print("-" * 40)
        print("GENERAZIONE COMPLETATA")
        print(f"File:   {config['OUTPUT_PATH']}")
        print(f"Slug:   {config['RELATIVE_URL']}")
        print("-" * 40)
    except IOError as e:
        print(f"Errore salvataggio file: {e}")
        sys.exit(1)


def main():
    args = parse_arguments()
    config = build_config(args)
    process_html(config)


if __name__ == "__main__":
    main()
