#!/usr/bin/env python3

import pandas as pd
import matplotlib.pyplot as plt
import seaborn as sns
from pathlib import Path

# --- CONFIGURAZIONE STILE (Ereditata dai tuoi script) ---
plt.rcParams["font.family"] = "serif"
plt.rcParams["font.serif"] = ["Computer Modern"]
plt.rcParams["font.size"] = 10
plt.rcParams["axes.labelsize"] = 10
plt.rcParams["xtick.labelsize"] = 9
plt.rcParams["ytick.labelsize"] = 9
plt.rcParams["legend.fontsize"] = 9
sns.set_theme(style="whitegrid")

charts_dir = Path("charts")
charts_dir.mkdir(exist_ok=True)

# --- DATI HARDCODATI DAL LATEX ---
data = [
    {
        "Strategia": "basic-cleanup",
        "Originale_KB": 271.65,
        "Processato_KB": 38.87,
        "Riduzione_%": 85.69,
    },
    {
        "Strategia": "html-to-markdown",
        "Originale_KB": 271.65,
        "Processato_KB": 23.08,
        "Riduzione_%": 91.50,
    },
    {
        "Strategia": "dom-distillation",
        "Originale_KB": 271.65,
        "Processato_KB": 1.67,
        "Riduzione_%": 99.39,
    },
    {
        "Strategia": "dom-distillation-markdown",
        "Originale_KB": 271.65,
        "Processato_KB": 1.11,
        "Riduzione_%": 99.59,
    },
    {
        "Strategia": "mineru-html",
        "Originale_KB": 322.66,
        "Processato_KB": 2.74,
        "Riduzione_%": 99.15,
    },
    {
        "Strategia": "jina-reader",
        "Originale_KB": 343.26,
        "Processato_KB": 34.80,
        "Riduzione_%": 89.86,
    },
]

df = pd.DataFrame(data)

# --- NORMALIZZAZIONE ---
BASELINE_KB = 271.65  # media
# Calcoliamo il peso processato scalato rispetto alla baseline
df["Processato_Norm_KB"] = df["Processato_KB"] * (BASELINE_KB / df["Originale_KB"])

# Ordiniamo per riduzione (dal peggiore al migliore) per una lettura visiva più pulita
df = df.sort_values("Riduzione_%")

# --- CREAZIONE GRAFICO ---
plt.figure(figsize=(12, 7))

# Usiamo la palette 'crest' che hai usato per i token, rende bene per i dati di "efficienza"
ax = sns.barplot(
    data=df,
    x="Strategia",
    y="Riduzione_%",
    hue="Strategia",
    palette="crest",
    legend=False,
)

# plt.title(
#     "Compressione media per strategia di pre-processing sull'intero dataset",
#     fontsize=15,
#     fontweight="bold",
# )
plt.ylabel("Riduzione della dimensione (%)", fontsize=12)
plt.xlabel("Strategia di pre-processing", fontsize=12)

# Spazio extra in cima per le label
plt.ylim(0, 115)
plt.xticks(rotation=25, ha="right")

# --- ANNOTAZIONI ---
for i, p in enumerate(ax.patches):
    height = p.get_height()
    # Prendiamo il valore normalizzato per stamparlo
    processed_kb = df.iloc[i]["Processato_Norm_KB"]

    # 1. Percentuale di riduzione (Sopra la barra)
    ax.annotate(
        f"{height:.2f}%",
        (p.get_x() + p.get_width() / 2.0, height),
        ha="center",
        va="bottom",
        xytext=(0, 5),
        textcoords="offset points",
        fontsize=10,
        fontweight="bold",
    )

    # 2. Peso finale normalizzato (All'interno/sotto la cima della barra)
    # ax.annotate(
    #     f"Peso finale:\n{processed_kb:.2f} KB",
    #     (p.get_x() + p.get_width() / 2.0, height / 2),
    #     ha="center",
    #     va="center",
    #     color="white",
    #     fontsize=10,
    #     fontweight="bold",
    #     bbox=dict(
    #         boxstyle="round,pad=0.4", facecolor="black", alpha=0.45, edgecolor="none"
    #     ),
    # )

plt.tight_layout()

# Salvataggio e visualizzazione
output_file = charts_dir / "10_compressione_strategie_normalizzata.png"
plt.savefig(output_file, dpi=300)
print(f"✅ Generato con successo: {output_file}")

plt.show()
