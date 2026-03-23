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
plt.rcParams["xtick.labelsize"] = 26  # Ingrandito per le due sole etichette
plt.rcParams["ytick.labelsize"] = 22
plt.rcParams["axes.edgecolor"] = "#bfbfbf"
plt.rcParams["axes.linewidth"] = 0.8
sns.set_theme(style="whitegrid")

charts_dir = Path("charts")
charts_dir.mkdir(exist_ok=True)

# --- ARGPARSE SETUP ---
parser = argparse.ArgumentParser(
    description="Confronto Prompt Aggregato per Presentazione"
)
parser.add_argument(
    "--generic", "-g", type=str, required=True, help="JSON Prompt Generico"
)
parser.add_argument(
    "--explicit", "-e", type=str, required=True, help="JSON Prompt Esplicito"
)
parser.add_argument("--save", action="store_true", default=True)
args = parser.parse_args()


def get_average_f1(file_path: str) -> float:
    """Estrae l'F1 medio aggregando tutti i modelli AI validi."""
    path = Path(file_path)
    if not path.exists():
        raise FileNotFoundError(f"File non trovato: {file_path}")

    with open(path, "r", encoding="utf-8") as f:
        data = json.load(f)

    f1_scores = []
    summary = data.get("summary", {})

    for name, metrics in summary.items():
        # Ignora i test che non sono puramente AI
        if "Manual" in name or "CHAOS" in name:
            continue
        f1_scores.append(metrics["avgF1"])

    if not f1_scores:
        return 0.0

    return sum(f1_scores) / len(f1_scores)


# --- CARICAMENTO E AGGREGAZIONE DATI ---
print("Calcolo media aggregata in corso...")
avg_generic = get_average_f1(args.generic)
avg_explicit = get_average_f1(args.explicit)

df = pd.DataFrame(
    {
        "Prompt": ["Prompt\nGenerico", "Prompt\nEsplicito"],
        "F1-score": [avg_generic, avg_explicit],
    }
)

# --- CREAZIONE GRAFICO ---
# Proporzione quadrata (8x8) ideale per stare a sinistra nella slide (con testo a destra)
plt.figure(figsize=(8, 8))

# Rosso brillante per l'errore, Blu acceso per il successo
custom_palette = ["#ff3b30", "#0077ff"]

ax = sns.barplot(
    data=df,
    x="Prompt",
    y="F1-score",
    palette=custom_palette,
    edgecolor="none",
    linewidth=0,
)

# Rimuovi l'etichetta dell'asse X (è già ovvio dai nomi delle barre)
plt.xlabel("")
plt.ylabel("F1-score Medio", fontsize=24, fontweight="bold", labelpad=15)

# Limite Y maggiorato per le annotazioni giganti
plt.ylim(0, 1.15)

# Etichette degli assi in grassetto
plt.xticks(fontweight="bold")
plt.yticks(fontweight="bold")

# NIENTE LEGENDA: Con solo due barre è ridondante e ruba spazio al grafico.

# Nascondi i bordi superiore e destro
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
            xytext=(0, 8),
            textcoords="offset points",
            fontsize=28,  # Font gigantesco per impatto immediato
            fontweight="bold",
            color="black",
        )

plt.tight_layout()

# --- SALVATAGGIO ---
if args.save:
    output_file = charts_dir / "11_presentazione_confronto_prompt_aggregato.png"
    plt.savefig(
        output_file, dpi=300, transparent=True
    )  # transparent=True è comodo per PowerPoint
    print(f"✅ Grafico aggregato generato con successo: {output_file}")

plt.show()
