#!/usr/bin/env python3

import json
import pandas as pd
import matplotlib.pyplot as plt
import seaborn as sns
from matplotlib.ticker import FuncFormatter
from pathlib import Path
from adjustText import adjust_text
import argparse

# Configure matplotlib for LaTeX compatibility
# plt.rcParams["text.usetex"] = True
plt.rcParams["font.family"] = "serif"
plt.rcParams["font.serif"] = ["Computer Modern"]
plt.rcParams["font.size"] = 10
plt.rcParams["axes.labelsize"] = 10
plt.rcParams["xtick.labelsize"] = 9
plt.rcParams["ytick.labelsize"] = 9
plt.rcParams["legend.fontsize"] = 9

charts_dir = Path("charts")
charts_dir.mkdir(exist_ok=True)

# Configurazione stile
sns.set_theme(style="whitegrid")

# Argparse setup
parser = argparse.ArgumentParser(description="View benchmark results")
parser.add_argument(
    "--view", "-v", action="store_true", default=False, help="Show plots"
)
parser.add_argument("--save", action="store_true", default=True, help="Save plots")
parser.add_argument(
    "--no-save", action="store_false", dest="save", help="Do not save plots"
)
parser.add_argument(
    "--file",
    "-f",
    type=str,
    default=None,
    help="Path to the benchmark JSON file to parse (defaults to most recent in results/)",
)
args = parser.parse_args()


# Whitelist di strategie da includere nei grafici
STRATEGY_WHITELIST = [
    "basic-cleanup",
    "html-to-markdown",
    "jina-reader",
    # "dom-distillation",
    # "dom-distillation-markdown",
    # "mineru-html",
    # "html-to-markdown",
]


# Helper function to shorten model names
def normalize_model_name(model_name: str) -> str:
    """Shorten long model names for better readability in charts"""
    aliases = {
        "meta-llama/llama-4-scout-17b-16e-instruct": "llama-4-scout-17b",
    }

    for full_name, short_name in aliases.items():
        if model_name == full_name or model_name.startswith(f"{full_name} "):
            return short_name

    return model_name


# Helper function to normalize strategy names
def normalize_strategy_name(strategy_name: str) -> str:
    """Remove (Lenient) and (Strict) suffixes from strategy names"""
    return strategy_name.replace(" (Lenient)", "").replace(" (Strict)", "")


# 1. Caricamento dati - trova il file benchmark più recente
if args.file:
    file_path = Path(args.file)
    if not file_path.exists():
        raise FileNotFoundError(f"File not found: {args.file}")
else:
    results_dir = Path("results")
    files = list(results_dir.glob("benchmark_run_*.json"))

    if not files:
        raise FileNotFoundError("No benchmark files found in results directory")

    # Ordina per data di modifica e prendi il più recente
    file_path = max(files, key=lambda p: p.stat().st_mtime)

print(f"Loading: {file_path}")

with open(file_path, "r", encoding="utf-8") as f:
    data = json.load(f)

# 2. Trasformazione dati in DataFrame
df_list = []
summary = data["summary"]

for name, metrics in summary.items():
    # Estraiamo Modello e Strategia dal nome "modello [strategia]"
    model_part = normalize_model_name(name.split(" [")[0])
    strategy_part = normalize_strategy_name(name.split("[")[-1].replace("]", ""))

    # Ignora modelli con 'Manual' e 'CHAOS'
    if "Manual" in model_part or "CHAOS" in name:
        continue

    df_list.append(
        {
            "Modello": model_part,
            "Strategia": strategy_part,
            "Precision": metrics["avgPrecision"],
            "Recall": metrics["avgRecall"],
            "F1-score": metrics["avgF1"],
            "Costo": metrics.get("costPerFile", 0),
            "Latenza": metrics["avgDuration"] / 1000,  # Convertiamo in secondi
        }
    )

df = pd.DataFrame(df_list)

# --- GRAFICO 1: CONFRONTO METRICHE DI ACCURATEZZA (CON ASSE SPEZZATO) ---
df_metrics = df.melt(
    id_vars=["Modello", "Strategia"],
    value_vars=["Precision", "Recall", "F1-score"],
    var_name="Metrica",
    value_name="Punteggio",
)

# Creiamo due assi con altezze diverse (ratio 3:1)
fig, (ax1, ax2) = plt.subplots(
    2, 1, sharex=True, figsize=(14, 8), gridspec_kw={"height_ratios": [3, 1]}
)
fig.subplots_adjust(hspace=-0.02)  # Pannelli attaccati, senza gap visivo

# Disegniamo gli stessi dati su entrambi gli assi
sns.barplot(
    data=df_metrics,
    x="Modello",
    y="Punteggio",
    hue="Metrica",
    palette="viridis",
    ax=ax1,
)
sns.barplot(
    data=df_metrics,
    x="Modello",
    y="Punteggio",
    hue="Metrica",
    palette="viridis",
    ax=ax2,
)

# Impostiamo i limiti (zoom in alto, base in basso)
ax1.set_ylim(0.8, 1)  # Parte alta (zoom aggressivo: 0.8 - 1.05)
ax2.set_ylim(0, 0.1)  # Base ancorata allo zero

# Nascondiamo le etichette y al bordo del taglio per evitare overlap (es. 0.100 / 0.800)
seam_top = ax1.get_ylim()[0]
seam_bottom = ax2.get_ylim()[1]
eps = 1e-9
ax1.yaxis.set_major_formatter(
    FuncFormatter(lambda y, _: "" if abs(y - seam_top) < eps else f"{y:.3f}")
)
ax2.yaxis.set_major_formatter(
    FuncFormatter(lambda y, _: "" if abs(y - seam_bottom) < eps else f"{y:.3f}")
)

# Nascondiamo i bordi tra i due grafici
ax1.spines["bottom"].set_visible(False)
ax2.spines["top"].set_visible(False)
ax1.xaxis.tick_top()
ax1.tick_params(labeltop=False)
ax2.xaxis.tick_bottom()

# --- 1. PRIMA formattiamo le error bars (così non tocchiamo il "fulmine") ---
for ax in [ax1, ax2]:
    for line in ax.lines:
        line.set_color("red")
        line.set_linewidth(2.0)

# --- 2. Bisciolina bianca sui bordi di taglio (intervallo omesso) ---
d = 0.012
wave_amp = 0.028
num_waves = 21
x_points = []
y_wave_top = []
y_wave_bottom = []

# Limita la bisciolina all'area coperta dalle barre (senza toccare gli assi laterali)
first_bar = ax1.patches[0]
last_bar = ax1.patches[
    len(df_metrics["Modello"].unique()) * len(df_metrics["Metrica"].unique()) - 1
]
left_data = first_bar.get_x()
right_data = last_bar.get_x() + last_bar.get_width()

left_axes = ax1.transAxes.inverted().transform(ax1.transData.transform((left_data, 0)))[
    0
]
right_axes = ax1.transAxes.inverted().transform(
    ax1.transData.transform((right_data, 0))
)[0]
left_axes += 0.003
right_axes -= 0.003

for i in range(num_waves):
    x_norm = left_axes + (right_axes - left_axes) * (i / (num_waves - 1))
    y_offset = wave_amp if i % 2 == 0 else -wave_amp
    x_points.append(x_norm)
    y_wave_top.append(0 + y_offset)
    y_wave_bottom.append(1 + y_offset)

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

ax1.set_ylabel("Punteggio (0.0 - 1.0)", fontsize=12)
ax2.set_ylabel("")
ax2.set_xlabel("Modello AI", fontsize=12)
ax1.legend(title="Metrica", loc="upper center", ncol=3, fontsize=10)
ax2.get_legend().remove()


if args.save:
    plt.savefig(charts_dir / "01_accuratezza_modelli.png", dpi=300, bbox_inches="tight")

# --- GRAFICO 1.1: ACCURATEZZA PER STRATEGIA (CON ASSE SPEZZATO) ---
# Usiamo i dati non aggregati per mantenere le barre di deviazione standard visibili
df_strategy_metrics = df.melt(
    id_vars=["Modello", "Strategia"],
    value_vars=["Precision", "Recall", "F1-score"],
    var_name="Metrica",
    value_name="Punteggio",
)

fig, (ax1, ax2) = plt.subplots(
    2, 1, sharex=True, figsize=(12, 8), gridspec_kw={"height_ratios": [3, 1]}
)
fig.subplots_adjust(hspace=-0.02)

sns.barplot(
    data=df_strategy_metrics,
    x="Strategia",
    y="Punteggio",
    hue="Metrica",
    palette="viridis",
    errorbar="sd",
    capsize=0.08,
    ax=ax1,
)
sns.barplot(
    data=df_strategy_metrics,
    x="Strategia",
    y="Punteggio",
    hue="Metrica",
    palette="viridis",
    errorbar="sd",
    capsize=0.08,
    ax=ax2,
)

ax1.set_ylim(0.8, 1)
ax2.set_ylim(0, 0.1)

# Nascondiamo le etichette y al bordo del taglio per evitare overlap (es. 0.100 / 0.800)
seam_top = ax1.get_ylim()[0]
seam_bottom = ax2.get_ylim()[1]
eps = 1e-9
ax1.yaxis.set_major_formatter(
    FuncFormatter(lambda y, _: "" if abs(y - seam_top) < eps else f"{y:.3f}")
)
ax2.yaxis.set_major_formatter(
    FuncFormatter(lambda y, _: "" if abs(y - seam_bottom) < eps else f"{y:.3f}")
)

ax1.spines["bottom"].set_visible(False)
ax2.spines["top"].set_visible(False)
ax1.xaxis.tick_top()
ax1.tick_params(labeltop=False)
ax2.xaxis.tick_bottom()

# --- 1. PRIMA formattiamo le error bars (così non tocchiamo il "fulmine") ---
for ax in [ax1, ax2]:
    for line in ax.lines:
        line.set_color("red")
        line.set_linewidth(2.0)

# --- 2. Bisciolina bianca sui bordi di taglio (intervallo omesso) ---
d = 0.012
wave_amp = 0.028
num_waves = 21
x_points = []
y_wave_top = []
y_wave_bottom = []

# Limita la bisciolina all'area coperta dalle barre (senza toccare gli assi laterali)
first_bar = ax1.patches[0]
last_bar = ax1.patches[
    len(df_strategy_metrics["Strategia"].unique())
    * len(df_strategy_metrics["Metrica"].unique())
    - 1
]
left_data = first_bar.get_x()
right_data = last_bar.get_x() + last_bar.get_width()

left_axes = ax1.transAxes.inverted().transform(ax1.transData.transform((left_data, 0)))[
    0
]
right_axes = ax1.transAxes.inverted().transform(
    ax1.transData.transform((right_data, 0))
)[0]
left_axes += 0.003
right_axes -= 0.003

for i in range(num_waves):
    x_norm = left_axes + (right_axes - left_axes) * (i / (num_waves - 1))
    y_offset = wave_amp if i % 2 == 0 else -wave_amp
    x_points.append(x_norm)
    y_wave_top.append(0 + y_offset)
    y_wave_bottom.append(1 + y_offset)

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

ax1.set_ylabel("Punteggio medio (0.0 - 1.0)", fontsize=12)
ax2.set_ylabel("")
ax2.set_xlabel("Strategia di pre-processing", fontsize=12)
ax2.tick_params(axis="x", rotation=15)
ax1.legend(title="Metrica", loc="upper left", fontsize=10)
ax2.get_legend().remove()

# for p in ax1.patches:
#     if p.get_height() > 0:
#         ax1.annotate(
#             format(p.get_height(), ".3f"),
#             (p.get_x() + p.get_width() / 2.0, p.get_height()),
#             ha="center",
#             va="bottom",
#             xytext=(0, 5),
#             textcoords="offset points",
#             fontsize=9,
#         )

if args.save:
    plt.savefig(
        charts_dir / "01.1_accuratezza_strategie.png", dpi=300, bbox_inches="tight"
    )

# --- GRAFICO 1.2: IMPATTO DELLE STRATEGIE PER MODELLO ---
# Raggruppiamo per Modello le diverse strategie
plt.figure(figsize=(14, 8))
ax = sns.barplot(
    data=df,
    x="Modello",
    y="F1-score",
    hue="Strategia",
    palette="Set2",
)

# Style the error bars (delta lines) - red and thicker
for line in ax.lines:
    line.set_color("red")
    line.set_linewidth(2.5)

plt.title(
    "Impatto delle strategie di pre-processing per modello",
    fontsize=16,
    fontweight="bold",
)
plt.ylabel("F1-score (0.0 - 1.0)", fontsize=12)
plt.xlabel("Modello AI", fontsize=12)
plt.ylim(0, 1.1)  # Spazio per le etichette
plt.legend(title="Strategia", bbox_to_anchor=(1.05, 1), loc="upper left")
plt.xticks(rotation=25, ha="right")


plt.tight_layout()
if args.save:
    plt.savefig(charts_dir / "01.2_strategie_per_modello.png", dpi=300)
    print("Generato: charts/01.2_strategie_per_modello.png")
if args.view:
    plt.show()

# --- GRAFICO 2: FRONTIERA DI PARETO (EFFICIENZA VS ACCURATEZZA) ---
# Filtriamo solo le strategie nel whitelist
df_plot = df[df["Strategia"].isin(STRATEGY_WHITELIST)].copy()

# Calcoliamo l'efficienza: quanti file possiamo processare con 1$
df_plot["File_per_Dollaro"] = df_plot["Costo"].apply(
    lambda x: 1 / x if x > 0 else float("nan")
)
df_plot = df_plot.dropna(subset=["File_per_Dollaro"])

plt.figure(figsize=(12, 7))
sns.scatterplot(
    data=df_plot,
    x="File_per_Dollaro",
    y="F1-score",
    hue="Modello",
    style="Strategia",
    s=200,
)

# plt.title("Efficienza economica vs. accuratezza", fontsize=16, fontweight="bold")
plt.xlabel("Numero di file processabili con 1$", fontsize=12)
plt.ylabel("F1-score", fontsize=12)
plt.grid(True, linestyle="--", alpha=0.7)

# Aggiungiamo margini per dare spazio alle etichette
plt.margins(x=0.15, y=0.15)

# Annotazione dei punti con sfondo per migliore leggibilità
# Una label per modello (il punto con il massimo F1-score)
texts = []
for model in df_plot["Modello"].unique():
    model_data = df_plot[df_plot["Modello"] == model]
    # Troviamo il punto con il massimo F1-score per questo modello
    best_point = model_data.loc[model_data["F1-score"].idxmax()]

    texts.append(
        plt.text(
            best_point["File_per_Dollaro"],
            best_point["F1-score"],
            f"{best_point['Modello']}",
            fontsize=9,
            fontweight="bold",
            bbox=dict(
                boxstyle="round,pad=0.3", facecolor="white", edgecolor="none", alpha=0.8
            ),
        )
    )

# Ora adjust_text funzionerà perfettamente senza warning perché la scala è lineare
adjust_text(
    texts,
    arrowprops=dict(arrowstyle="-", color="gray", lw=0.5),
    force_points=(0.5, 0.5),
)

# Mettiamo la legenda in basso a sinistra (lontano dall'angolo in alto a destra che è il "bersaglio")
# plt.legend(loc="lower left", framealpha=0.95)
plt.legend(loc="lower right", framealpha=0.95)


plt.tight_layout()
if args.save:
    plt.savefig(charts_dir / "02_efficienza_vs_accuratezza.png", dpi=300)
    print("Generato: charts/02_efficienza_vs_accuratezza.png")
if args.view:
    plt.show()

# --- GRAFICO 3: LATENZA (TEMPO DI RISPOSTA) ---
plt.figure(figsize=(12, 6))
df_sorted_time = df.sort_values("Latenza")
sns.barplot(
    data=df_sorted_time, x="Modello", y="Latenza", hue="Strategia", palette="magma"
)

# plt.title("Velocità media (secondi/file)", fontsize=16, fontweight="bold")
plt.xlabel("Modello", fontsize=12)
plt.ylabel("Tempo in secondi", fontsize=12)
plt.xticks(rotation=25, ha="right")

plt.tight_layout()
if args.save:
    plt.savefig(charts_dir / "03_latenza_modelli.png", dpi=300)
    print("Generato: charts/03_latenza_modelli.png")
if args.view:
    plt.show()

# --- GRAFICO 4: HALLUCINATION RATE (MEDIO PER MODELLO) ---
# Calcoliamo l'hallucination rate direttamente nel DataFrame principale
df["Hallucination Rate"] = 1 - df["Precision"]

plt.figure(figsize=(10, 6))
# Passando x="Modello", Seaborn calcola automaticamente la media tra tutte le strategie
ax = sns.barplot(
    data=df, x="Modello", y="Hallucination Rate", palette="viridis", errorbar=None
)

# Titolo commentato per LaTeX
# plt.title("Tasso di allucinazione medio per modello (Minore è meglio)", fontsize=16, fontweight="bold")
plt.ylabel("Tasso di allucinazione (0.0 - 1.0)", fontsize=12)
plt.xlabel("Modello AI", fontsize=12)
plt.xticks(rotation=15, ha="right")
plt.ylim(
    0, max(df["Hallucination Rate"].max() * 1.2, 0.1)
)  # Lascia spazio per il testo in alto

# plt.ylim(0, 0.15)

# Aggiunta valori sopra le barre
# for p in ax.patches:
#     height = p.get_height()
#     if height > 0:
#         ax.annotate(
#             format(height, ".3f"),
#             (p.get_x() + p.get_width() / 2.0, height),
#             ha="center",
#             va="bottom",
#             xytext=(0, 5),
#             textcoords="offset points",
#             fontsize=10,
#             fontweight="bold",
#         )

plt.tight_layout()
if args.save:
    plt.savefig(charts_dir / "04_hallucination_rate.png", dpi=300)

# --- GRAFICO 5: PHANTOM STRIKE RATE (MEDIO PER MODELLO) ---
phantom_counts_model = {}

# Raggruppiamo esplicitamente per Modello, ignorando le differenze di strategia
for detail in data.get("details", []):
    parser_name = detail.get("parser", "")
    if "Manual" in parser_name or "CHAOS" in parser_name:
        continue

    # Estraiamo solo il nome del modello (es. "gpt-5-nano")
    model_part = normalize_model_name(parser_name.split(" [")[0])

    if model_part not in phantom_counts_model:
        phantom_counts_model[model_part] = {"total": 0, "phantoms": 0}

    phantom_counts_model[model_part]["total"] += 1
    for diff in detail.get("differences", []):
        if "isStrike: Expected false, got true" in diff:
            phantom_counts_model[model_part]["phantoms"] += 1

phantom_rows = []
for model_part, counts in phantom_counts_model.items():
    rate = (counts["phantoms"] / counts["total"]) if counts["total"] > 0 else 0
    phantom_rows.append(
        {
            "Modello": model_part,
            "Phantom Strike Rate": rate,
            "Phantom Count": counts["phantoms"],
            "Total Tests": counts["total"],
        }
    )

df_phantoms = pd.DataFrame(phantom_rows).sort_values(
    "Phantom Strike Rate", ascending=False
)

plt.figure(figsize=(10, 6))
colors = sns.color_palette("Reds_r", len(df_phantoms))
bars = plt.bar(
    df_phantoms["Modello"],
    df_phantoms["Phantom Strike Rate"],
    color=colors,
)

# Titolo commentato per LaTeX
# plt.title("Phantom strike rate medio per modello (Minore è meglio)", fontsize=16, fontweight="bold")
plt.ylabel("Phantom strike rate", fontsize=12)
plt.xlabel("Modello AI", fontsize=12)
plt.xticks(rotation=15, ha="right")

# TODO rm Zoom estremo richiesto (massimo 0.009)
# plt.ylim(0, 0.009)

# for bar, rate, count, total in zip(
#     bars,
#     df_phantoms["Phantom Strike Rate"],
#     df_phantoms["Phantom Count"],
#     df_phantoms["Total Tests"],
# ):
#     height = bar.get_height()
#     label = f"{rate:.3f}\n({int(count)}/{int(total)})"
#
#     # Se per caso un valore supera il limite del grafico (0.009),
#     # blocchiamo il testo appena sotto il bordo (0.008) affinché non venga tagliato via.
#     y_pos = height if height < 0.0085 else 0.008
#
#     plt.annotate(
#         label,
#         (bar.get_x() + bar.get_width() / 2.0, y_pos),
#         ha="center",
#         va="bottom",
#         xytext=(0, 5),
#         textcoords="offset points",
#         fontsize=10,
#         fontweight="bold",
#     )

plt.tight_layout()
if args.save:
    plt.savefig(charts_dir / "05_phantom_strike_rate.png", dpi=300)

# --- GRAFICO 6: RESILIENZA AL DOM CHAOS ---
resilience_data_raw = {}

# Cerchiamo le coppie standard vs chaos
for name, metrics in summary.items():
    if "[CHAOS]" in name:
        # Troviamo il nome del test "base" rimuovendo il tag [CHAOS]
        base_name = name.replace(" [CHAOS]", "")

        # Se esiste la controparte standard nel report
        if base_name in summary:
            std_score = summary[base_name]["avgF1"]
            chaos_score = metrics["avgF1"]

            if "Manual" in name:
                group_name = "Parser manuale\n(regex)"
            else:
                # Estraiamo la strategia dal nome base, es: "gpt-5-nano [html-to-markdown] (Lenient)"
                try:
                    # Prende ciò che c'è tra le parentesi quadre
                    strategy_raw = base_name.split("[")[1].split("]")[0]
                    strategy = normalize_strategy_name(strategy_raw).strip()
                except IndexError:
                    strategy = "Altro"

                # # Mappiamo le strategie a nomi leggibili per il grafico
                # No non è vero, lascialo uguale
                if "html-to-markdown" in strategy:
                    # group_name = "AI\n(HTML to MD)"
                    group_name = "AI\n(html-to-markdown)"
                elif "dom-distillation-markdown" in strategy:
                    # group_name = "AI\n(DOM Distill. MD)"
                    group_name = "AI\n(dom-distillation-markdown)"
                elif "dom-distillation" in strategy:
                    # group_name = "AI\n(DOM Distillation)"
                    group_name = "AI\n(dom-distillation)"
                elif "basic-cleanup" in strategy:
                    # group_name = "AI\n(Basic Cleanup)"
                    group_name = "AI\n(basic-cleanup)"
                elif "mineru" in strategy.lower():
                    # group_name = "SLM\n(MinerU)"
                    group_name = "SLM\n(mineru-html)"
                elif "jina" in strategy.lower():
                    # group_name = "VLM\n(Jina Reader)"
                    group_name = "VLM\n(jina-reader)"
                else:
                    group_name = f"AI\n({strategy})"

            if group_name not in resilience_data_raw:
                resilience_data_raw[group_name] = {"std": [], "chaos": []}

            resilience_data_raw[group_name]["std"].append(std_score)
            resilience_data_raw[group_name]["chaos"].append(chaos_score)

resilience_data = []

if resilience_data_raw:
    # Calcoliamo le medie per ogni gruppo
    for group, scores in resilience_data_raw.items():
        avg_std = sum(scores["std"]) / len(scores["std"])
        avg_chaos = sum(scores["chaos"]) / len(scores["chaos"])

        # Aggiungiamo riga Standard
        resilience_data.append(
            {
                "Metodo/Strategia": group,
                "Condizione": "DOM normale",
                "F1-score": avg_std,
            }
        )

        # Aggiungiamo riga Chaos
        resilience_data.append(
            {
                "Metodo/Strategia": group,
                "Condizione": "DOM modificato",
                "F1-score": avg_chaos,
            }
        )

    df_resilience = pd.DataFrame(resilience_data)

    # Funzione di ordinamento personalizzata per dare un senso logico all'asse X
    def sort_logic(x):
        if "Manuale" in x:
            return 0
        if "HTML to MD" in x:
            return 1
        if "Basic" in x:
            return 2
        if "DOM" in x:
            return 3
        if "SLM" in x or "VLM" in x:
            return 4
        return 5

    models_order = sorted(df_resilience["Metodo/Strategia"].unique(), key=sort_logic)

    df_resilience["Metodo/Strategia"] = pd.Categorical(
        df_resilience["Metodo/Strategia"], categories=models_order, ordered=True
    )
    df_resilience = df_resilience.sort_values("Metodo/Strategia")

    plt.figure(figsize=(12, 7))

    # Palette colori: blu per standard, rosso per chaos
    custom_palette = {"DOM normale": "#3498db", "DOM modificato": "#e74c3c"}

    ax = sns.barplot(
        data=df_resilience,
        x="Metodo/Strategia",
        y="F1-score",
        hue="Condizione",
        palette=custom_palette,
    )

    # plt.title(
    #     "Resilienza ai cambiamenti del DOM per strategia (media aggregata dei modelli AI)",
    #     fontsize=16,
    #     fontweight="bold",
    # )
    plt.ylabel("F1-score medio (aggregato sui modelli AI)", fontsize=12)
    plt.xlabel("Metodo / Strategia di pre-processing", fontsize=12)
    plt.ylim(0, 1.15)  # Spazio extra per annotazioni
    plt.legend(loc="upper right")
    plt.xticks(rotation=0)

    # Annotazioni sulle barre
    for p in ax.patches:
        height = p.get_height()
        if pd.notna(height) and height > 0:
            ax.annotate(
                f"{height:.2f}",
                (p.get_x() + p.get_width() / 2.0, height),
                ha="center",
                va="bottom",
                xytext=(0, 5),
                textcoords="offset points",
                fontsize=11,
                fontweight="bold",
            )

    plt.tight_layout()
    if args.save:
        plt.savefig(charts_dir / "06_resilienza_dom_strategie.png", dpi=300)
        print("Generato: charts/06_resilienza_dom_strategie.png")
    if args.view:
        plt.show()
else:
    print("⚠️ Nessun dato [CHAOS] trovato nel JSON. Salto il grafico resilienza.")

# --- GRAFICO 7: CONSUMO TOKEN IN INPUT E COSTO PER STRATEGIA ---
token_rows = []
for detail in data.get("details", []):
    parser_name = detail.get("parser", "")

    # Ignoriamo i parser manuali e i test CHAOS
    if "Manual" in parser_name or "CHAOS" in parser_name:
        continue

    # Estraiamo la strategia dal nome del parser
    try:
        strategy_part = normalize_strategy_name(
            parser_name.split("[")[-1].replace("]", "")
        )
    except IndexError:
        continue

    # Estraiamo i token e i costi
    tokens = detail.get("tokens", {})
    input_tokens = tokens.get("input", 0)

    cost_data = detail.get("costUsd", {})
    total_cost = cost_data.get("totalCost", 0)

    if input_tokens > 0:
        token_rows.append(
            {
                "Strategia": strategy_part,
                "Input Tokens": input_tokens,
                "Costo": total_cost,
            }
        )

if token_rows:
    df_tokens = pd.DataFrame(token_rows)

    # Calcoliamo la media del costo per ogni strategia per poterla stampare
    cost_means = df_tokens.groupby("Strategia")["Costo"].mean().to_dict()

    plt.figure(figsize=(12, 7))
    ax = sns.barplot(
        data=df_tokens,
        x="Strategia",
        y="Input Tokens",
        hue="Strategia",
        palette="crest",
        capsize=0.1,
        legend=False,
    )

    # Aggiungiamo margine in alto per non tagliare il testo del costo
    ax.margins(y=0.2)

    # Stile delle error bars (linee di deviazione standard)
    for line in ax.lines:
        line.set_color("red")
        line.set_linewidth(2.5)

    plt.title(
        # "e costo"
        "Consumo medio di token in input per strategia",
        fontsize=16,
        fontweight="bold",
    )
    plt.ylabel("Numero medio di token (input)", fontsize=12)
    plt.xlabel("Strategia di pre-processing", fontsize=12)
    plt.xticks(rotation=15, ha="right")

    # Mappatura delle label sull'asse X per associare il costo corretto alla barra corretta
    xtick_labels = [t.get_text() for t in ax.get_xticklabels()]

    # Aggiunta dei valori esatti sopra le barre
    for i, p in enumerate(ax.patches):
        height = p.get_height()
        if height > 0:
            strategy_name = xtick_labels[i]
            avg_cost = cost_means.get(strategy_name, 0)

            # 1. Annotazione Token (Nera/Default, vicina alla barra)
            ax.annotate(
                f"{int(height):,}",  # Formatta con separatore delle migliaia
                (p.get_x() + p.get_width() / 2.0, height),
                ha="center",
                va="bottom",
                xytext=(0, 4),
                textcoords="offset points",
                fontsize=10,
                fontweight="bold",
            )

            # 2. Annotazione Costo (Grigia, in corsivo, sopra i token)
            # if avg_cost > 0:
            #     ax.annotate(
            #         f"Costo medio/file: ${avg_cost:.4f}",  # Formatta il costo a 4 decimali
            #         (p.get_x() + p.get_width() / 2.0, height),
            #         ha="center",
            #         va="bottom",
            #         xytext=(
            #             0,
            #             18,
            #         ),  # Spostato più in alto rispetto ai token (18 invece di 4)
            #         textcoords="offset points",
            #         fontsize=9,
            #         color="dimgray",
            #         fontstyle="italic",
            #     )

    plt.tight_layout()
    if args.save:
        plt.savefig(charts_dir / "07_consumo_token_strategie.png", dpi=300)
        print("Generato: charts/07_consumo_token_strategie.png")
    if args.view:
        plt.show()
else:
    print(
        "⚠️ Nessun dato sui token trovato nel JSON. Salto il grafico del consumo token."
    )

# --- GRAFICO 8: PERFORMANCE (F1-sCORE) PER SOURCE (AZIENDA) ---
details_data = []

for d in data.get("details", []):
    parser_name = d.get("parser", "")

    # Ignora i modelli manuali o i test CHAOS
    if "Manual" in parser_name or "CHAOS" in parser_name:
        continue

    # Estraiamo Modello e Strategia
    try:
        model_part = normalize_model_name(parser_name.split(" [")[0])
        strategy_part = normalize_strategy_name(
            parser_name.split("[")[-1].replace("]", "")
        )
    except IndexError:
        continue

    details_data.append(
        {
            "Source": d.get("source", "Sconosciuta"),
            "Modello": model_part,
            "Strategia": strategy_part,
            "F1-score": d.get("f1", 0),
        }
    )

if details_data:
    df_details = pd.DataFrame(details_data)

    # Raggruppiamo per calcolare la media dell'F1-score per Source e Modello
    # In questo grafico ignoriamo la separazione per strategia (usiamo la media generale del modello)
    # oppure puoi filtrare per la tua strategia "vincente", ad esempio:
    # df_details = df_details[df_details["Strategia"] == "html-to-markdown"]

    plt.figure(figsize=(14, 8))
    ax = sns.barplot(
        data=df_details,
        x="Source",
        y="F1-score",
        hue="Modello",
        palette="viridis",
        errorbar=None,  # Nascondiamo le barre di errore per maggiore pulizia visiva
    )

    plt.title(
        "F1-score medio per modello su ciascun dataset",
        fontsize=16,
        fontweight="bold",
    )
    plt.ylabel("F1-score (0.0 - 1.0)", fontsize=12)
    plt.xlabel("Sorgente dati (azienda)", fontsize=12)
    plt.ylim(0, 1.15)
    plt.legend(title="Modello AI", bbox_to_anchor=(1.05, 1), loc="upper left")

    # Aggiunta dei valori sopra le barre
    # for p in ax.patches:
    #     height = p.get_height()
    #     if height > 0:
    #         ax.annotate(
    #             format(height, ".2f"),
    #             (p.get_x() + p.get_width() / 2.0, height),
    #             ha="center",
    #             va="bottom",
    #             xytext=(0, 5),
    #             textcoords="offset points",
    #             fontsize=8,
    #         )

    plt.tight_layout()
    if args.save:
        plt.savefig(charts_dir / "08_performance_per_source.png", dpi=300)
        print("Generato: charts/08_performance_per_source.png")
    if args.view:
        plt.show()
else:
    print(
        "⚠️ Nessun dettaglio valido trovato nel JSON per generare il grafico per Source."
    )


# --- GRAFICO 9: TASSO DI ERRORE PER CAMPO (%) ---
error_counts = {}
total_valid_evaluations = 0

# Estraiamo i campi sbagliati dalla lista "differences"
for d in data.get("details", []):
    parser_name = d.get("parser", "")

    # Ignoriamo test manuali o CHAOS per avere una statistica pulita sui modelli base
    if "Manual" in parser_name or "CHAOS" in parser_name:
        continue

    # Ogni dettaglio valido rappresenta un tentativo del modello di estrarre TUTTI i campi
    total_valid_evaluations += 1

    differences = d.get("differences", [])

    for diff in differences:
        # Esempio di diff: "locationType: Expected REGIONAL, got NATIONAL"
        if ":" in diff:
            # Estraiamo il nome del campo (tutto ciò che c'è prima del primo ':')
            field_name = diff.split(":")[0].strip()

            # Contiamo le occorrenze
            if field_name not in error_counts:
                error_counts[field_name] = 0
            error_counts[field_name] += 1

if error_counts and total_valid_evaluations > 0:
    # Calcoliamo la percentuale di errore per ogni campo
    error_rates = []
    for field, count in error_counts.items():
        error_rate = (count / total_valid_evaluations) * 100
        error_rates.append(
            {"Campo": field, "Error Rate (%)": error_rate, "Errori Assoluti": count}
        )

    # Creiamo un DataFrame e ordiniamo in modo decrescente
    df_errors = pd.DataFrame(error_rates)
    df_errors = df_errors.sort_values(by="Error Rate (%)", ascending=False)

    plt.figure(figsize=(14, 8))

    # Usiamo una palette tendente al rosso/arancione
    ax = sns.barplot(
        data=df_errors,
        x="Error Rate (%)",
        y="Campo",
        hue="Campo",
        palette="Reds_r",
        legend=False,
    )

    plt.title(
        "Tasso di errore per campo (frequenza di estrazione errata)",
        fontsize=16,
        fontweight="bold",
    )
    plt.xlabel(
        f"% di Errore (su {total_valid_evaluations} estrazioni totali)", fontsize=12
    )
    plt.ylabel("Campo JSON", fontsize=12)

    # Estendiamo leggermente l'asse X per non tagliare il testo
    plt.xlim(0, max(df_errors["Error Rate (%)"]) * 1.15)

    # Aggiunta dei valori di fianco alle barre: "XX.X% (Y)"
    for p, count in zip(ax.patches, df_errors["Errori Assoluti"]):
        width = p.get_width()
        if width > 0:
            ax.annotate(
                f"{width:.1f}% ({int(count)})",
                (width, p.get_y() + p.get_height() / 2.0),
                ha="left",
                va="center",
                xytext=(5, 0),
                textcoords="offset points",
                fontsize=10,
                fontweight="bold",
            )

    # Aggiungiamo una griglia verticale per facilitare la lettura
    ax.xaxis.grid(True, linestyle="--", alpha=0.7)
    ax.yaxis.grid(False)

    plt.tight_layout()
    if args.save:
        plt.savefig(charts_dir / "09_error_rate_per_campo.png", dpi=300)
        print("Generato: charts/09_error_rate_per_campo.png")
    if args.view:
        plt.show()
else:
    print(
        "⚠️ Nessuna differenza/errore trovato nel JSON per generare il grafico degli errori per campo."
    )

# --- STAMPA A CONSOLE: TOP 10 FILE PEGGIORI (WORST 10 PARSED FILES) ---
print("\n" + "!" * 80)
print(f"{'RANK':<5} | {'AVG F1':<8} | {'ERRS':<5} | {'FILE / SOURCE'}")
print("-" * 80)

file_stats = {}

# Raccogliamo i dati per ogni singolo file valutato
for d in data.get("details", []):
    parser_name = d.get("parser", "")

    # Ignoriamo i parser manuali e CHAOS per valutare la difficoltà intrinseca del file
    if "Manual" in parser_name or "CHAOS" in parser_name:
        continue

    filename = d.get("file", "Sconosciuto")
    f1 = d.get("f1", 0)
    source = d.get("source", "Sconosciuta")
    differences = d.get("differences", [])

    if filename not in file_stats:
        file_stats[filename] = {
            "source": source,
            "f1_sum": 0.0,
            "count": 0,
            "total_differences": 0,
        }

    file_stats[filename]["f1_sum"] += f1
    file_stats[filename]["count"] += 1
    file_stats[filename]["total_differences"] += len(differences)

if file_stats:
    # Calcoliamo la media dell'F1-score per ogni file
    processed_list = []
    for filename, stats in file_stats.items():
        avg_f1 = stats["f1_sum"] / stats["count"] if stats["count"] > 0 else 0
        processed_list.append(
            {
                "filename": filename,
                "source": stats["source"],
                "avg_f1": avg_f1,
                "total_errs": stats["total_differences"],
            }
        )

    # Ordiniamo: F1 più basso per primo, poi per numero di errori decrescente
    worst_10 = sorted(processed_list, key=lambda x: (x["avg_f1"], -x["total_errs"]))[
        :10
    ]

    for i, item in enumerate(worst_10, 1):
        # Tronca il nome del file se troppo lungo per la console
        display_name = (
            (item["filename"]) if len(item["filename"]) > 47 else item["filename"]
        )
        print(
            f"#{i:<4} | {item['avg_f1']:<8.4f} | {item['total_errs']:<5} | {display_name} ({item['source']})"
        )

    print("!" * 80 + "\n")
else:
    print("⚠️ Nessun dato trovato per generare la classifica dei file peggiori.")

# --- PRINT TO CONSOLE: AVERAGE LATENCY PER MODEL ---
print("\n" + "=" * 80)
print(f"{'AVERAGE LATENCY PER MODEL (aggregating all strategies)':<80}")
print("=" * 80)
print(f"{'Model':<40} | {'Avg Latency (s)':>15}")
print("-" * 80)

avg_latency_per_model = df.groupby("Modello")["Latenza"].mean().sort_values()
for model, avg_time in avg_latency_per_model.items():
    print(f"{model:<40} | {avg_time:>15.2f}")

print("=" * 80 + "\n")

# --- EXPORT TO CSV TABLES ---


def export_all_csv_tables(data, base_dir="tables"):
    """Generates analytical CSV tables from the benchmark data"""
    tables_dir = Path(base_dir)
    tables_dir.mkdir(exist_ok=True)

    summary = data.get("summary", {})
    details = data.get("details", [])

    print(f"\n{'-'*40}\nExporting CSV tables to '{tables_dir}'...\n{'-'*40}")

    # --- TABLE 1: Overall Performance, Economics & Errors ---
    # Pre-calculate phantom strikes per parser
    phantom_counts = {}
    for d in details:
        parser = d.get("parser", "")
        if parser not in phantom_counts:
            phantom_counts[parser] = {"total": 0, "phantoms": 0}

        phantom_counts[parser]["total"] += 1
        for diff in d.get("differences", []):
            if "isStrike: Expected false, got true" in diff:
                phantom_counts[parser]["phantoms"] += 1

    perf_rows = []
    for name, metrics in summary.items():
        if "Manual" in name or "CHAOS" in name:
            continue

        model_part = normalize_model_name(name.split(" [")[0])
        try:
            strategy_part = normalize_strategy_name(
                name.split("[")[-1].replace("]", "")
            )
        except IndexError:
            strategy_part = "Altro"

        # Safe metric extraction
        cost_per_file = metrics.get("costPerFile", 0)
        files_per_dollar = (1 / cost_per_file) if cost_per_file > 0 else float("inf")

        phantoms = phantom_counts.get(name, {"total": 0, "phantoms": 0})
        phantom_rate = (
            (phantoms["phantoms"] / phantoms["total"] * 100)
            if phantoms["total"] > 0
            else 0
        )
        hallucination_rate = (1 - metrics.get("avgPrecision", 0)) * 100

        perf_rows.append(
            {
                "Model": model_part,
                "Strategy": strategy_part,
                "F1-score": metrics.get("avgF1", 0),
                "Precision": metrics.get("avgPrecision", 0),
                "Recall": metrics.get("avgRecall", 0),
                "Latency (s)": metrics.get("avgDuration", 0) / 1000,
                "Cost per File ($)": cost_per_file,
                "Files per 1$": (
                    files_per_dollar if files_per_dollar != float("inf") else "N/A"
                ),
                "Hallucination Rate (%)": hallucination_rate,
                "Phantom Strike Rate (%)": phantom_rate,
            }
        )

    # Inizializziamo df_perf per poterlo riutilizzare dopo
    df_perf = None

    if perf_rows:
        df_perf = pd.DataFrame(perf_rows)
        df_perf_sorted = df_perf.sort_values("F1-score", ascending=False)
        out_path = tables_dir / "01_model_performance_summary.csv"
        df_perf_sorted.to_csv(out_path, index=False, float_format="%.4f")
        print(f"✅ Generated: {out_path}")

    # --- TABLE 2: DOM Chaos Resilience ---
    resilience_rows = []
    for name, metrics in summary.items():
        if "[CHAOS]" in name:
            base_name = name.replace(" [CHAOS]", "")
            if base_name in summary:
                base_metrics = summary[base_name]

                model_part = normalize_model_name(base_name.split(" [")[0])
                try:
                    strategy_part = normalize_strategy_name(
                        base_name.split("[")[-1].replace("]", "")
                    )
                except IndexError:
                    strategy_part = "Altro"

                base_f1 = base_metrics.get("avgF1", 0)
                chaos_f1 = metrics.get("avgF1", 0)
                abs_drop = base_f1 - chaos_f1
                rel_drop = (abs_drop / base_f1 * 100) if base_f1 > 0 else 0

                resilience_rows.append(
                    {
                        "Model": model_part,
                        "Strategy": strategy_part,
                        "Standard F1-score": base_f1,
                        "Chaos F1-score": chaos_f1,
                        "Absolute Drop": abs_drop,
                        "Relative Drop (%)": rel_drop,
                    }
                )

    if resilience_rows:
        df_res = pd.DataFrame(resilience_rows).sort_values(
            "Relative Drop (%)", ascending=True
        )
        out_path = tables_dir / "02_dom_chaos_resilience.csv"
        df_res.to_csv(out_path, index=False, float_format="%.4f")
        print(f"✅ Generated: {out_path}")

    # --- TABLE 3: Worst Parsed Files ---
    file_stats = {}
    for d in details:
        parser_name = d.get("parser", "")
        if "Manual" in parser_name or "CHAOS" in parser_name:
            continue

        filename = d.get("file", "Sconosciuto")
        if filename not in file_stats:
            file_stats[filename] = {
                "Source": d.get("source", "Sconosciuta"),
                "f1_sum": 0.0,
                "count": 0,
                "total_differences": 0,
            }

        file_stats[filename]["f1_sum"] += d.get("f1", 0)
        file_stats[filename]["count"] += 1
        file_stats[filename]["total_differences"] += len(d.get("differences", []))

    worst_rows = []
    for filename, stats in file_stats.items():
        avg_f1 = stats["f1_sum"] / stats["count"] if stats["count"] > 0 else 0
        worst_rows.append(
            {
                "Filename": filename,
                "Source": stats["Source"],
                "Average F1-score": avg_f1,
                "Total Errors Aggregated": stats["total_differences"],
                "Times Evaluated": stats["count"],
            }
        )

    if worst_rows:
        df_worst = pd.DataFrame(worst_rows).sort_values(
            by=["Average F1-score", "Total Errors Aggregated"], ascending=[True, False]
        )
        out_path = tables_dir / "03_worst_parsed_files.csv"
        df_worst.to_csv(out_path, index=False, float_format="%.4f")
        print(f"✅ Generated: {out_path}")

    # --- TABLE 4: Error Rates per Field ---
    error_counts = {}
    total_evals = 0

    for d in details:
        parser_name = d.get("parser", "")
        if "Manual" in parser_name or "CHAOS" in parser_name:
            continue

        total_evals += 1
        for diff in d.get("differences", []):
            if ":" in diff:
                field = diff.split(":")[0].strip()
                error_counts[field] = error_counts.get(field, 0) + 1

    field_rows = []
    for field, count in error_counts.items():
        field_rows.append(
            {
                "JSON Field": field,
                "Total Error Occurrences": count,
                "Failure Rate (%)": (
                    (count / total_evals) * 100 if total_evals > 0 else 0
                ),
            }
        )

    if field_rows:
        df_fields = pd.DataFrame(field_rows).sort_values(
            "Failure Rate (%)", ascending=False
        )
        out_path = tables_dir / "04_error_rates_per_field.csv"
        df_fields.to_csv(out_path, index=False, float_format="%.2f")
        print(f"✅ Generated: {out_path}")

    # --- TABLE 5 & 6: Latency Analysis ---
    if df_perf is not None:
        # Table 5: Latency per (Model, Strategy) pair
        df_latency_pair = (
            df_perf.groupby(["Model", "Strategy"])["Latency (s)"].mean().reset_index()
        )
        # Ordiniamo prima per modello e poi per latenza (dal più veloce al più lento per quel modello)
        df_latency_pair = df_latency_pair.sort_values(by=["Model", "Latency (s)"])
        out_path_5 = tables_dir / "05_latency_per_model_and_strategy.csv"
        df_latency_pair.to_csv(out_path_5, index=False, float_format="%.3f")
        print(f"✅ Generated: {out_path_5}")

        # Table 6: Latency per Model (Aggregated across all strategies)
        df_latency_model = df_perf.groupby("Model")["Latency (s)"].mean().reset_index()
        # Ordiniamo dal modello più veloce in assoluto al più lento
        df_latency_model = df_latency_model.sort_values(by="Latency (s)")
        out_path_6 = tables_dir / "06_latency_per_model_aggregated.csv"
        df_latency_model.to_csv(out_path_6, index=False, float_format="%.3f")
        print(f"✅ Generated: {out_path_6}")


# Call the function if saving is enabled
if args.save:
    export_all_csv_tables(data)


# Grafici per presentazione!

# --- GRAFICO 10 (SPECIALE PRESENTAZIONE): QUADRANTE MAGICO STRATEGIE ---
print("\nGenerazione grafico speciale per la presentazione...")

# Escludiamo la strategia non desiderata dal grafico di presentazione
df_pres_source = df[df["Strategia"] != "dom-distillation-markdown"]

# 1. Aggreghiamo i dati per Strategia (calcolando la media di F1 e Costo tra tutti i modelli)
# Usiamo df_plot che contiene già i dati filtrati (senza Manual/CHAOS)
df_pres = (
    df_pres_source.groupby("Strategia")
    .agg({"F1-score": "mean", "Costo": "mean"})
    .reset_index()
)

# 2. Calcoliamo l'efficienza economica (File per 1 Dollaro)
df_pres["File_per_Dollaro"] = df_pres["Costo"].apply(lambda x: 1 / x if x > 0 else 0)

# 3. Creiamo la figura con dimensioni ampie e font giganti per il proiettore
plt.figure(figsize=(14, 8))

# Disegniamo i punti GIGANTI
sns.scatterplot(
    data=df_pres,
    x="File_per_Dollaro",
    y="F1-score",
    s=500,  # Punti piu piccoli per ridurre l'effetto affollamento
    color="#bb2e29ff",  # Tono neutro per una resa piu sobria
    legend=False,  # NIENTE LEGENDA, usiamo le etichette dirette
    alpha=0.9,
    edgecolor="white",
    linewidth=1.2,
)

# Impostiamo font enormi per gli assi
plt.xlabel("File processati per 1$", fontsize=22, fontweight="bold")
plt.ylabel("F1-score medio", fontsize=22, fontweight="bold")
plt.xticks(fontsize=17)
plt.yticks(fontsize=17)

# 4. Etichette con posizionamento manuale per la presentazione
labels_above = {"basic-cleanup", "html-to-markdown", "mineru-html"}
custom_offsets = {
    "basic-cleanup": (-35, 16, "left", "bottom"),
    "html-to-markdown": (20, 0, "left", "bottom"),
    "mineru-html": (-10, 14, "right", "bottom"),
    "dom-distillation": (-2, -16, "right", "top"),
}

for _, row in df_pres.iterrows():
    strategy_name = row["Strategia"]
    x = row["File_per_Dollaro"]
    y = row["F1-score"]

    if strategy_name in custom_offsets:
        dx, dy, ha, va = custom_offsets[strategy_name]
    elif strategy_name in labels_above:
        dx, dy, ha, va = (0, 16, "center", "bottom")
    else:
        dx, dy, ha, va = (0, -16, "center", "top")

    plt.annotate(
        strategy_name,
        xy=(x, y),
        xytext=(dx, dy),
        textcoords="offset points",
        fontsize=18,
        fontweight="bold",
        ha=ha,
        va=va,
    )

# Griglia leggera per aiutare l'occhio
plt.grid(True, linestyle="--", alpha=0.6)

plt.tight_layout()
if args.save:
    out_path_pres = charts_dir / "10_presentazione_quadrante.png"
    plt.savefig(out_path_pres, dpi=300)
    print(f"✅ Generato grafico per presentazione: {out_path_pres}")
