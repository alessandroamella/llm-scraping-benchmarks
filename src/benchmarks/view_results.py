#!/usr/bin/env python3

import json
import pandas as pd
import matplotlib.pyplot as plt
import seaborn as sns
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
            "F1-Score": metrics["avgF1"],
            "Costo": metrics.get("costPerFile", 0),
            "Latenza": metrics["avgDuration"] / 1000,  # Convertiamo in secondi
        }
    )

df = pd.DataFrame(df_list)

# --- GRAFICO 1: CONFRONTO METRICHE DI ACCURATEZZA ---
# Trasformiamo il dataframe in formato "long" per seaborn
df_metrics = df.melt(
    id_vars=["Modello", "Strategia"],
    value_vars=["Precision", "Recall", "F1-Score"],
    var_name="Metrica",
    value_name="Punteggio",
)

plt.figure(figsize=(14, 8))
ax = sns.barplot(
    data=df_metrics, x="Modello", y="Punteggio", hue="Metrica", palette="viridis"
)

# Style the error bars (delta lines) - red and thicker
for line in ax.lines:
    line.set_color("red")
    line.set_linewidth(2.5)

plt.title(
    "Accuratezza per modello",
    fontsize=16,
    fontweight="bold",
)
plt.ylabel("Punteggio (0.0 - 1.0)", fontsize=12)
plt.xlabel("Modello AI", fontsize=12)
plt.ylim(0, 1.1)  # Spazio per le etichette
plt.legend(title="Metrica", bbox_to_anchor=(1.05, 1), loc="upper left")

# Aggiunta dei valori sopra le barre
for p in ax.patches:
    if p.get_height() > 0:
        ax.annotate(
            format(p.get_height(), ".2f"),
            (p.get_x() + p.get_width() / 2.0, p.get_height()),
            ha="center",
            va="bottom",
            xytext=(0, 12),
            textcoords="offset points",
            fontsize=9,
        )

plt.tight_layout()
if args.save:
    plt.savefig("01_accuratezza_modelli.png", dpi=300)
    print("Generato: 01_accuratezza_modelli.png")
if args.view:
    plt.show()

# --- GRAFICO 1.1: ACCURATEZZA PER STRATEGIA DI PRE-PROCESSING ---
# Raggruppiamo i dati per strategia e calcoliamo la media delle metriche
df_strategy_grouped = (
    df.groupby("Strategia")
    .agg(
        {
            "Precision": "mean",
            "Recall": "mean",
            "F1-Score": "mean",
        }
    )
    .reset_index()
)

# Trasformiamo in formato "long" per seaborn
df_strategy_metrics = df_strategy_grouped.melt(
    id_vars=["Strategia"],
    value_vars=["Precision", "Recall", "F1-Score"],
    var_name="Metrica",
    value_name="Punteggio",
)

plt.figure(figsize=(12, 7))
ax = sns.barplot(
    data=df_strategy_metrics,
    x="Strategia",
    y="Punteggio",
    hue="Metrica",
    palette="viridis",
)

# Style the error bars (delta lines) - red and thicker
for line in ax.lines:
    line.set_color("red")
    line.set_linewidth(2.5)

plt.title(
    "Accuratezza per strategia di pre-processing",
    fontsize=16,
    fontweight="bold",
)
plt.ylabel("Punteggio medio (0.0 - 1.0)", fontsize=12)
plt.xlabel("Strategia di pre-processing", fontsize=12)
plt.ylim(0, 1.1)  # Spazio per le etichette
plt.legend(title="Metrica", bbox_to_anchor=(1.05, 1), loc="upper left")
plt.xticks(rotation=15, ha="right")

# Aggiunta dei valori sopra le barre
for p in ax.patches:
    if p.get_height() > 0:
        ax.annotate(
            format(p.get_height(), ".3f"),
            (p.get_x() + p.get_width() / 2.0, p.get_height()),
            ha="center",
            va="bottom",
            xytext=(0, 12),
            textcoords="offset points",
            fontsize=9,
        )

plt.tight_layout()
if args.save:
    plt.savefig("01.1_accuratezza_strategie.png", dpi=300)
    print("Generato: 01.1_accuratezza_strategie.png")
if args.view:
    plt.show()

# --- GRAFICO 1.2: IMPATTO DELLE STRATEGIE PER MODELLO ---
# Raggruppiamo per Modello le diverse strategie
plt.figure(figsize=(14, 8))
ax = sns.barplot(
    data=df,
    x="Modello",
    y="F1-Score",
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
plt.ylabel("F1-Score (0.0 - 1.0)", fontsize=12)
plt.xlabel("Modello AI", fontsize=12)
plt.ylim(0, 1.1)  # Spazio per le etichette
plt.legend(title="Strategia", bbox_to_anchor=(1.05, 1), loc="upper left")
plt.xticks(rotation=25, ha="right")

# Aggiunta dei valori sopra le barre
for p in ax.patches:
    if p.get_height() > 0:
        ax.annotate(
            format(p.get_height(), ".2f"),
            (p.get_x() + p.get_width() / 2.0, p.get_height()),
            ha="center",
            va="bottom",
            xytext=(0, 8),
            textcoords="offset points",
            fontsize=8,
        )

plt.tight_layout()
if args.save:
    plt.savefig("01.2_strategie_per_modello.png", dpi=300)
    print("Generato: 01.2_strategie_per_modello.png")
if args.view:
    plt.show()

# --- GRAFICO 2: FRONTIERA DI PARETO (COSTO VS ACCURATEZZA) ---
plt.figure(figsize=(12, 7))
sns.scatterplot(
    data=df, x="Costo", y="F1-Score", hue="Modello", style="Strategia", s=200
)

plt.title("Costo/file vs. F1-Score", fontsize=16, fontweight="bold")
plt.xlabel("Costo stimato per file ($)", fontsize=12)
plt.ylabel("F1-Score", fontsize=12)
plt.grid(True, linestyle="--", alpha=0.7)
plt.gca().invert_xaxis()  # Best values (low cost, high F1) in top-right

# Annotazione dei punti con sfondo per migliore leggibilità
texts = []
for i in range(df.shape[0]):
    texts.append(
        plt.text(
            df.Costo[i],
            df["F1-Score"][i],
            f"{df.Modello[i]}",
            fontsize=9,
            bbox=dict(
                boxstyle="round,pad=0.3", facecolor="white", edgecolor="none", alpha=0.7
            ),
        )
    )

# This automatically moves the labels to avoid overlaps
adjust_text(texts, arrowprops=dict(arrowstyle="->", color="gray", lw=0.5))

plt.tight_layout()
if args.save:
    plt.savefig("02_costo_vs_accuratezza.png", dpi=300)
    print("Generato: 02_costo_vs_accuratezza.png")
if args.view:
    plt.show()

# --- GRAFICO 3: LATENZA (TEMPO DI RISPOSTA) ---
plt.figure(figsize=(12, 6))
df_sorted_time = df.sort_values("Latenza")
sns.barplot(
    data=df_sorted_time, x="Latenza", y="Modello", hue="Strategia", palette="magma"
)

plt.title("Velocità media (secondi/file)", fontsize=16, fontweight="bold")
plt.xlabel("Tempo in secondi", fontsize=12)
plt.ylabel("Modello", fontsize=12)

plt.tight_layout()
if args.save:
    plt.savefig("03_latenza_modelli.png", dpi=300)
    print("Generato: 03_latenza_modelli.png")
if args.view:
    plt.show()

# --- GRAFICO 4: HALLUCINATION RATE ---
# Calcolo Hallucination Rate dalla Summary (1 - Precision)
hallucination_rows = []
for name, metrics in summary.items():
    model_part = normalize_model_name(name.split(" [")[0])
    strategy_part = normalize_strategy_name(name.split("[")[-1].replace("]", ""))

    # Ignora modelli con 'Manual' e 'CHAOS'
    if "Manual" in model_part or "CHAOS" in name:
        continue

    hallucination_rate = (1 - metrics["avgPrecision"]) * 100

    hallucination_rows.append(
        {
            "Model": f"{model_part} [{strategy_part}]",
            "Modello": model_part,
            "Strategia": strategy_part,
            "Hallucination rate (%)": hallucination_rate,
            "Avg Precision": metrics["avgPrecision"],
        }
    )

df_hallucination = pd.DataFrame(hallucination_rows).sort_values(
    "Hallucination rate (%)"
)

plt.figure(figsize=(14, 8))
ax = sns.barplot(
    data=df_hallucination,
    y="Model",
    x="Hallucination rate (%)",
    hue="Strategia",
    palette="RdYlGn_r",  # Rosso per male, giallo neutro, verde per bene
    orient="h",
)

plt.title(
    "Hallucination rate per modello",
    fontsize=16,
    fontweight="bold",
)
plt.xlabel("Hallucination rate (%)", fontsize=12)
plt.ylabel("Modello [strategia]", fontsize=12)

# Aggiunta dei valori sopra le barre
for i, p in enumerate(ax.patches):
    if p.get_width() > 0:
        ax.annotate(
            format(p.get_width(), ".2f") + "%",
            (p.get_width(), p.get_y() + p.get_height() / 2.0),
            ha="left",
            va="center",
            xytext=(5, 0),
            textcoords="offset points",
            fontsize=9,
            fontweight="bold",
        )

plt.legend(title="Strategia", bbox_to_anchor=(1.05, 1), loc="upper left")
plt.tight_layout()
if args.save:
    plt.savefig("04_hallucination_rate.png", dpi=300)
    print("Generato: 04_hallucination_rate.png")
if args.view:
    plt.show()

# --- GRAFICO 5: PHANTOM strike rATE ---
# Analisi specifiche delle allucinazioni "Phantom Strikes"
phantom_counts = {}
for detail in data.get("details", []):
    model = detail["parser"]
    if model not in phantom_counts:
        phantom_counts[model] = {"total": 0, "phantoms": 0}

    phantom_counts[model]["total"] += 1
    for diff in detail.get("differences", []):
        if "isStrike: Expected false, got true" in diff:
            phantom_counts[model]["phantoms"] += 1

phantom_rows = []
for model, counts in phantom_counts.items():
    model_part = normalize_model_name(model.split(" [")[0])

    # Ignora modelli con 'Manual' e 'CHAOS'
    if "Manual" in model_part or "CHAOS" in model:
        continue

    rate = (counts["phantoms"] / counts["total"]) * 100 if counts["total"] > 0 else 0
    strategy_part = normalize_strategy_name(model.split("[")[-1].replace("]", ""))

    phantom_rows.append(
        {
            "Model": f"{model_part} [{strategy_part}]",
            "Modello": model_part,
            "Strategia": strategy_part,
            "Phantom strike rate (%)": rate,
            "Phantom Count": counts["phantoms"],
            "Total Tests": counts["total"],
        }
    )

df_phantoms = pd.DataFrame(phantom_rows).sort_values(
    "Phantom strike rate (%)", ascending=False
)

fig, ax = plt.subplots(figsize=(14, 8))
bars = ax.barh(
    df_phantoms["Model"],
    df_phantoms["Phantom strike rate (%)"],
    color=df_phantoms["Phantom strike rate (%)"].apply(
        lambda x: "#2ecc71" if x == 0 else "#e74c3c" if x >= 50 else "#f39c12"
    ),
)

plt.title(
    "Phantom strike rate per modello",
    fontsize=16,
    fontweight="bold",
)
plt.xlabel("Phantom strike rate (%)", fontsize=12)
plt.ylabel("Modello [strategia]", fontsize=12)

# Aggiunta dei valori sopra le barre
for i, (bar, rate, count, total) in enumerate(
    zip(
        bars,
        df_phantoms["Phantom strike rate (%)"],
        df_phantoms["Phantom Count"],
        df_phantoms["Total Tests"],
    )
):
    label = f"{rate:.1f}% ({int(count)}/{int(total)})"
    ax.annotate(
        label,
        xy=(bar.get_width(), bar.get_y() + bar.get_height() / 2.0),
        xytext=(5, 0),
        textcoords="offset points",
        ha="left",
        va="center",
        fontsize=10,
        fontweight="bold",
    )

# Legenda colori
# legend_elements = [
#     Patch(facecolor="#2ecc71", label="OK (0%)"),
#     Patch(facecolor="#f39c12", label="Attenzione (1-99%)"),
#     Patch(facecolor="#e74c3c", label="Critico (≥50%)"),
# ]
# ax.legend(handles=legend_elements, loc="lower right", fontsize=10)

plt.tight_layout()
if args.save:
    plt.savefig("05_phantom_strike_rate.png", dpi=300)
    print("Generato: 05_phantom_strike_rate.png")
if args.view:
    plt.show()

# --- GRAFICO 6: RESILIENZA AL DOM CHAOS ---
resilience_data = []

# Cerchiamo le coppie standard vs chaos
for name, metrics in summary.items():
    if "[CHAOS]" in name:
        # Troviamo il nome del test "base" rimuovendo il tag [CHAOS]
        base_name = name.replace(" [CHAOS]", "")

        # Se esiste la controparte standard nel report
        if base_name in summary:
            # Normalize the model name and extract strategy
            model_part = normalize_model_name(base_name.split(" [")[0])
            strategy_part = normalize_strategy_name(
                base_name.split("[")[-1].replace("]", "")
            )
            normalized_parser_name = f"{model_part} [{strategy_part}]"

            std_score = summary[base_name]["avgF1"]
            chaos_score = metrics["avgF1"]

            # Calcolo perdita di performance
            drop = std_score - chaos_score
            drop_pct = (drop / std_score * 100) if std_score > 0 else 0

            # Aggiungiamo riga Standard
            resilience_data.append(
                {
                    "Parser": normalized_parser_name,
                    "Condizione": "DOM normale",
                    "F1-Score": std_score,
                    "Delta %": 0,
                }
            )

            # Aggiungiamo riga Chaos
            resilience_data.append(
                {
                    "Parser": normalized_parser_name,
                    "Condizione": "DOM modificato",
                    "F1-Score": chaos_score,
                    "Delta %": -drop_pct,
                }
            )

if resilience_data:
    df_resilience = pd.DataFrame(resilience_data)

    plt.figure(figsize=(12, 7))

    # Palette colori: blu per standard, rosso per chaos
    custom_palette = {"DOM normale": "#3498db", "DOM modificato": "#e74c3c"}

    ax = sns.barplot(
        data=df_resilience,
        x="Parser",
        y="F1-Score",
        hue="Condizione",
        palette=custom_palette,
    )

    plt.title(
        "Resilienza ai cambiamenti del DOM",
        fontsize=16,
        fontweight="bold",
    )
    plt.ylabel("F1-Score", fontsize=12)
    plt.xlabel("Parser / modello [strategia]", fontsize=12)
    plt.ylim(0, 1.15)  # Spazio extra per annotazioni
    plt.legend(loc="upper right")
    plt.xticks(rotation=15)  # Rotazione leggera per leggere meglio i nomi lunghi

    # Annotazioni sulle barre
    # Iteriamo sulle patches (barre) per aggiungere i valori
    # Nota: Seaborn non garantisce l'ordine, quindi usiamo l'altezza della barra
    for p in ax.patches:
        height = p.get_height()
        if height > 0:  # Evita annotazioni su barre a 0
            ax.annotate(
                f"{height:.2f}",
                (p.get_x() + p.get_width() / 2.0, height),
                ha="center",
                va="bottom",
                xytext=(0, 5),
                textcoords="offset points",
                fontsize=10,
                fontweight="bold",
            )

    plt.tight_layout()
    if args.save:
        plt.savefig("06_resilienza_dom.png", dpi=300)
        print("Generato: 06_resilienza_dom.png")
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
        plt.savefig("07_consumo_token_strategie.png", dpi=300)
        print("Generato: 07_consumo_token_strategie.png")
    if args.view:
        plt.show()
else:
    print(
        "⚠️ Nessun dato sui token trovato nel JSON. Salto il grafico del consumo token."
    )
