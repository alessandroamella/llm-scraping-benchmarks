#!/usr/bin/env python3

import argparse
import sys
import urllib.parse
from bs4 import BeautifulSoup

# Default HTML body content (can be extended to load from a file if needed)
DEFAULT_BODY_HTML = """
<h4><strong>L’agitazione riguarda il personale di bordo e di macchina.</strong></h4>
<p>&nbsp;</p>
<p>Si informa che i sindacati hanno indetto uno sciopero che potrà generare ripercussioni sulla circolazione ferroviaria in Lombardia.</p>
<p>Le fasce di garanzia saranno attive dalle 6 alle 9 e dalle 18 alle 21.</p>
<p>&nbsp;</p>
<p>Si invitano i viaggiatori a prestare attenzione agli annunci sonori e ai monitor di stazione.</p>
"""


def generate_slug(title):
    """Generate a URL slug from the title."""
    return (
        title.lower()
        .strip()
        .replace(" ", "-")
        .replace(":", "")
        .replace("à", "a")
        .replace("ì", "i")
        .replace("è", "e")
        .replace("ò", "o")
        .replace("ù", "u")
        .replace("'", "")
    )


def parse_arguments():
    """Parse command-line arguments."""
    parser = argparse.ArgumentParser(
        description="Generate customized strike notification HTML files from a template."
    )

    # File Arguments
    parser.add_argument(
        "-t",
        "--template",
        default="strike-detail-venerd--29-novembre-revocato-sciopero-ferrovienord.html",
        help="Path to the source HTML template file.",
    )
    parser.add_argument(
        "-o",
        "--output",
        required=True,
        help="Path where the generated HTML file will be saved.",
    )

    # Content Arguments
    parser.add_argument(
        "--title", required=True, help="Title of the new strike announcement."
    )
    parser.add_argument(
        "--date-text",
        required=True,
        help="Display date text (e.g., 'giovedì 16/10/2025').",
    )
    parser.add_argument(
        "--date-iso",
        required=True,
        help="ISO format date for meta tags (e.g., '2025-10-16').",
    )
    parser.add_argument(
        "--description",
        required=True,
        help="Short description for meta tags and social sharing.",
    )
    parser.add_argument(
        "--slug",
        default=None,
        help="Custom URL slug. If omitted, it is generated from the title.",
    )

    return parser.parse_args()


def build_config(args):
    """
    Constructs a configuration dictionary based on parsed arguments.
    Calculates derived values like the Slug and URLs.
    """
    slug = args.slug if args.slug else generate_slug(args.title)

    # Base path logic (Update domain if necessary)
    base_domain = "https://www.trenord.it"
    url_path = f"/news/trenord-informa/comunicati-stampa/{slug}/"
    full_url = f"{base_domain}{url_path}"

    return {
        "TEMPLATE_PATH": args.template,
        "OUTPUT_PATH": args.output,
        "TITLE": args.title,
        "DATE_TEXT": args.date_text,
        "DATE_ISO": args.date_iso,
        "DESCRIPTION": args.description,
        "SLUG": slug,
        "FULL_URL": full_url,
        "RELATIVE_URL": url_path,
        "BODY_HTML": DEFAULT_BODY_HTML,
    }


def update_meta_tags(soup, config):
    """Updates Title, Meta tags, Canonical and Alternate links."""
    # 1. Update <title>
    if soup.title:
        soup.title.string = config["TITLE"]

    # 2. Update Meta tags (description, date, title)
    # We remove duplicates to ensure clean HTML
    for meta_name, meta_value in [
        ("title", config["TITLE"]),
        ("description", config["DESCRIPTION"]),
        ("date", config["DATE_ISO"]),
    ]:
        meta_tags = soup.find_all("meta", attrs={"name": meta_name})
        if meta_tags:
            meta_tags[0]["content"] = meta_value
            # Remove any extra tags of the same name
            for duplicate in meta_tags[1:]:
                duplicate.decompose()

    # 3. Update Canonical and Alternate Links
    for rel_type in ["canonical", "alternate"]:
        for link in soup.find_all("link", rel=rel_type):
            href = link.get("href", "")
            if "http" in href:
                link["href"] = config["FULL_URL"]
            else:
                link["href"] = config["RELATIVE_URL"]


def update_visible_content(soup, config):
    """Updates Breadcrumbs, H1, Date text, and Article Body."""
    # 1. Breadcrumb (last item)
    breadcrumb = soup.select_one(".breadcrumb-container ul li:last-child")
    if breadcrumb:
        breadcrumb.string = config["TITLE"]

    # 2. H1 Title
    h1 = soup.select_one(".container-content h1.uppercase b")
    if h1:
        h1.string = config["TITLE"]

    # 3. Date Text
    date_p = soup.select_one("p.green.date-news")
    if date_p:
        date_p.string = config["DATE_TEXT"]

    # 4. Navigation Links (Menu items pointing to strike/revocation pages)
    for a in soup.find_all("a"):
        href = a.get("href", "")
        # Update links that look like strike announcements to point to self/current path
        if (
            href
            and "comunicati-stampa" in href
            and ("revoca" in href or "sciopero" in href)
        ):
            a["href"] = config["RELATIVE_URL"]

    # 5. Article Body
    article_body = soup.select_one(
        ".frame-type-trenordtheme_simpletextmedia .text.align-middle"
    )
    if article_body:
        article_body.clear()
        article_body.append(BeautifulSoup(config["BODY_HTML"], "html.parser"))


def update_social_sharing(soup, config):
    """Updates Social Media sharing links (Twitter, FB, LinkedIn, Email)."""
    safe_title = urllib.parse.quote(config["TITLE"])
    safe_desc = urllib.parse.quote(config["DESCRIPTION"])
    # safe_url = urllib.parse.quote(config["FULL_URL"])

    # Update Social Buttons (Twitter, Facebook, LinkedIn)
    for share_link in soup.select(".social-share"):
        original_data = share_link.get("data-social", "")

        if "twitter.com" in original_data:
            new_data = (
                f"http://twitter.com/share?url={config['FULL_URL']}&text={safe_title}"
            )
            share_link["data-social"] = new_data

        elif "facebook.com" in original_data:
            new_data = f"https://www.facebook.com/sharer/sharer.php?u={config['FULL_URL']}&quote={safe_desc}"
            share_link["data-social"] = new_data

        elif "linkedin.com" in original_data:
            new_data = f"https://www.linkedin.com/shareArticle?mini=true&url={config['FULL_URL']}&summary={safe_desc}&source=LinkedIn"
            share_link["data-social"] = new_data

    # Update Email (mailto:)
    mail_link = soup.select_one('a[href^="mailto:"]')
    if mail_link:
        # %0a is the URL encoded newline
        body_mail = f"{safe_desc}%0a{config['FULL_URL']}"
        new_href = f"mailto:?subject={safe_title}&body={body_mail}"
        mail_link["href"] = new_href


def process_html(config):
    """Main processing logic."""
    try:
        with open(config["TEMPLATE_PATH"], "r", encoding="utf-8") as f:
            soup = BeautifulSoup(f, "html.parser")
    except FileNotFoundError:
        print(f"Error: Template file '{config['TEMPLATE_PATH']}' not found.")
        sys.exit(1)

    # Execute updates
    update_meta_tags(soup, config)
    update_visible_content(soup, config)
    update_social_sharing(soup, config)

    # Write output
    try:
        with open(config["OUTPUT_PATH"], "w", encoding="utf-8") as f_out:
            f_out.write(str(soup))

        print("-" * 40)
        print("SUCCESS: HTML generated.")
        print(f"File saved to: {config['OUTPUT_PATH']}")
        print(f"Slug used:     {config['SLUG']}")
        print("-" * 40)
    except IOError as e:
        print(f"Error writing output file: {e}")
        sys.exit(1)


def main():
    args = parse_arguments()
    config = build_config(args)
    process_html(config)


if __name__ == "__main__":
    main()
