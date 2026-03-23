#!/usr/bin/env python3

import json
import pandas as pd
import matplotlib.pyplot as plt
import seaborn as sns
from pathlib import Path
import argparse

# --- CONFIGURAZIONE STILE PER PRESENTAZIONE ---
plt.rcParams["font.family"] = "serif"
plt.rcParams["font.serif"] = ["Computer Modern"]
plt.rcParams["font.size"] = 18
plt.rcParams["axes.labelsize"] = 26
plt.rcParams["xtick.labelsize"] = 22
plt.rcParams["ytick.labelsize"] = 22
plt.rcParams["legend.fontsize"] = 24
plt.rcParams["axes.edgecolor"] = "#bfbfbf"
plt.rcParams["axes.linewidth"] = 0.8
sns.set_theme(style="whitegrid")

charts_dir = Path("charts")
charts_dir.mkdir(exist_ok=True)

# --- ARGPARSE SETUP ---
parser = argparse.ArgumentParser(description="Confronto Prompt per Presentazione")
parser.add_argument(
    "--generic", "-g", type=str, required=True, help="JSON Prompt Generico"
)
parser.add_argument(
    "--explicit", "-e", type=str, required=True, help="JSON Prompt Esplicito"
)
parser.add_argument("--save", action="store_true", default=True)
args = parser.parse_args()


def normalize_model_name(model_name: str) -> str:
    aliases = {
        "meta-llama/llama-4-scout-17b-16e-instruct": "llama-4-scout-17b",
    }
    for full_name, short_name in aliases.items():
        if model_name == full_name or model_name.startswith(f"{full_name} "):
            return short_name
    return model_name


def load_data(file_path: str, prompt_label: str) -> list:
    path = Path(file_path)
    if not path.exists():
        raise FileNotFoundError(f"File non trovato: {file_path}")

    with open(path, "r", encoding="utf-8") as f:
        data = json.load(f)

    df_list = []
    summary = data.get("summary", {})

    for name, metrics in summary.items():
        model_part = normalize_model_name(name.split(" [")[0])

        if "Manual" in model_part or "CHAOS" in name:
            continue

        df_list.append(
            {
                "Modello": model_part,
                "Prompt": prompt_label,
                "F1-score": metrics["avgF1"],
            }
        )
    return df_list


# --- CARICAMENTO E PREPARAZIONE DATI ---
print("Caricamento dati in corso...")
generic_data = load_data(args.generic, "Prompt generico")
explicit_data = load_data(args.explicit, "Prompt esplicito")

df = pd.DataFrame(generic_data + explicit_data)

# Ordiniamo i modelli alfabeticamente o per un ordine logico per pulizia visiva
df = df.sort_values("Modello")

# --- CREAZIONE GRAFICO ---
plt.figure(figsize=(14, 8))

# Palette vivace ad alto contrasto
custom_palette = {"Prompt generico": "#ff3b30", "Prompt esplicito": "#0077ff"}
hue_order = ["Prompt generico", "Prompt esplicito"]

# errorbar=None rimuove le stanghette di deviazione standard, rendendo la slide ultra-pulita
ax = sns.barplot(
    data=df,
    x="Modello",
    y="F1-score",
    hue="Prompt",
    hue_order=hue_order,
    palette=custom_palette,
    errorbar=None,
    edgecolor="none",
    linewidth=0,
)

# Rimuovi label inutili
plt.xlabel("")
plt.ylabel("F1-score", fontsize=20, fontweight="bold", labelpad=15)

# Aumenta limite Y per fare spazio alle scritte
plt.ylim(0, 1.15)
plt.xticks(rotation=15, ha="right", fontsize=14, fontweight="bold")
plt.yticks(fontsize=18, fontweight="bold")

# Posiziona la legenda in un punto non fastidioso
legend = plt.legend(
    title="",
    loc="upper left",
    frameon=True,
    framealpha=0.95,
    edgecolor="black",
    fontsize=14,
)
for text in legend.get_texts():
    text.set_fontweight("bold")

# Nascondi i bordi superiore e destro per un look più moderno
ax.spines["top"].set_visible(False)
ax.spines["right"].set_visible(False)

# --- ANNOTAZIONI SULLE BARRE ---
for p in ax.patches:
    height = p.get_height()
    if pd.notna(height) and height > 0:
        ax.annotate(
            f"{height:.2f}",
            (p.get_x() + p.get_width() / 2.0, height),
            ha="center",
            va="bottom",
            xytext=(0, 6),
            textcoords="offset points",
            fontsize=18,
            fontweight="bold",
            color="black",
        )

plt.tight_layout()

# --- SALVATAGGIO ---
if args.save:
    output_file = charts_dir / "11_presentazione_confronto_prompt.png"
    plt.savefig(output_file, dpi=300)
    print(f"✅ Grafico generato con successo: {output_file}")

plt.show()
