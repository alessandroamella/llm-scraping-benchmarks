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

# Converti percentuale (0-100) a frazione (0-1)
df["Riduzione"] = df["Riduzione_%"] / 100

# Ordiniamo per riduzione (dal peggiore al migliore) per una lettura visiva più pulita
df = df.sort_values("Riduzione")

# --- CREAZIONE GRAFICO CON BROKEN AXIS ---
fig, (ax1, ax2) = plt.subplots(
    2, 1, sharex=True, figsize=(12, 8), gridspec_kw={"height_ratios": [3, 1]}
)
fig.subplots_adjust(hspace=-0.03)

# Disegniamo sui due assi
sns.barplot(
    data=df,
    x="Strategia",
    y="Riduzione",
    hue="Strategia",
    palette="crest",
    legend=False,
    ax=ax1,
)
sns.barplot(
    data=df,
    x="Strategia",
    y="Riduzione",
    hue="Strategia",
    palette="crest",
    legend=False,
    ax=ax2,
)

# Impostiamo i limiti (zoom in alto, base in basso)
ax1.set_ylim(0.825, 1)  # Zoom sulla zona di interesse
ax2.set_ylim(0, 0.1)  # Base vuota

# Nascondiamo i bordi tra i due grafici
ax1.spines["bottom"].set_visible(False)
ax2.spines["top"].set_visible(False)
ax1.xaxis.tick_top()
ax1.tick_params(labeltop=False)
ax2.xaxis.tick_bottom()

# --- 1. PRIMA formattiamo le error bars ---
for ax in [ax1, ax2]:
    for line in ax.lines:
        line.set_color("red")
        line.set_linewidth(2.0)

# --- 2. Bisciolina bianca sui bordi di taglio (intervallo omesso) ---
wave_amp = 0.028
num_waves = 21
x_points = []
y_wave_top = []
y_wave_bottom = []

# Limita la bisciolina all'area coperta dalle barre (senza toccare gli assi laterali)
first_bar = ax1.patches[0]
last_bar = ax1.patches[len(df) - 1]
left_data = first_bar.get_x()
right_data = last_bar.get_x() + last_bar.get_width()

left_axes = ax1.transAxes.inverted().transform(ax1.transData.transform((left_data, 0)))[
    0
]
right_axes = ax1.transAxes.inverted().transform(
    ax1.transData.transform((right_data, 0))
)[0]

# Un minimo margine interno, per restare "attaccata" alle barre senza debordare
left_axes += 0.003
right_axes -= 0.003

for i in range(num_waves):
    x_norm = left_axes + (right_axes - left_axes) * (i / (num_waves - 1))
    y_offset = wave_amp if i % 2 == 0 else -wave_amp
    x_points.append(x_norm)
    # Sul bordo inferiore del pannello alto (y=0) e sul bordo superiore del pannello basso (y=1)
    y_wave_top.append(0 + y_offset)
    y_wave_bottom.append(1 + y_offset)

# Estensione limitata ai margini delle barre
x_points.insert(0, left_axes)
y_wave_top.insert(0, 0)
y_wave_bottom.insert(0, 1)
x_points.append(right_axes)
y_wave_top.append(0)
y_wave_bottom.append(1)

wave_style_top = dict(
    transform=ax1.transAxes, color="white", clip_on=False, lw=4.6, zorder=20
)
wave_style_bottom = dict(
    transform=ax2.transAxes, color="white", clip_on=False, lw=4.6, zorder=20
)
ax1.plot(x_points, y_wave_top, **wave_style_top)
ax2.plot(x_points, y_wave_bottom, **wave_style_bottom)

# Etichette
ax1.set_ylabel("Riduzione della dimensione (0.0 - 1.0)", fontsize=12)
ax2.set_ylabel("")
ax2.set_xlabel("Strategia di pre-processing", fontsize=12)
ax2.tick_params(axis="x", rotation=25)

# --- ANNOTAZIONI ---
# Annotazioni solo sull'asse superiore
# for i, p in enumerate(ax1.patches):
#     height = p.get_height()
#     if height > 0:
#         # Valore in frazione (da 0 a 1)
#         ax1.annotate(
#             f"{height:.3f}",
#             (p.get_x() + p.get_width() / 2.0, height),
#             ha="center",
#             va="bottom",
#             xytext=(0, 5),
#             textcoords="offset points",
#             fontsize=9,
#             fontweight="bold",
#         )

# Annotazioni sull'asse inferiore con consumo token
for i, p in enumerate(ax2.patches):
    # Calcoliamo il consumo di token
    processato_kb = df.iloc[i]["Processato_KB"]
    token_estimate = processato_kb * 1000 / 3.8
    # Arrotonda al multiplo di 10 più vicino
    token_rounded = round(token_estimate / 10) * 10

    # Annotiamo al centro di ciascuna barra dell'asse inferiore
    ax2.annotate(
        f"Consumo medio\ntoken: {int(token_rounded)}",
        (p.get_x() + p.get_width() / 2.0, 0.05),
        ha="center",
        va="center",
        color="white",
        fontsize=9,
        fontweight="bold",
        bbox=dict(
            boxstyle="round,pad=0.4", facecolor="#333333", alpha=0.75, edgecolor="none"
        ),
    )

# Layout esplicito: evita che tight_layout riapra il gap tra i due pannelli
fig.subplots_adjust(left=0.09, right=0.985, top=0.97, bottom=0.20, hspace=-0.03)

# Salvataggio e visualizzazione
output_file = charts_dir / "10_compressione_strategie_normalizzata.png"
plt.savefig(output_file, dpi=300)
print(f"✅ Generato con successo: {output_file}")

plt.show()
