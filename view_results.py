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

# plt.title(
#     "Accuratezza per modello",
#     fontsize=16,
#     fontweight="bold",
# )
plt.ylabel("Punteggio (0.0 - 1.0)", fontsize=12)
plt.xlabel("Modello AI", fontsize=12)
plt.ylim(0, 1.1)  # Spazio per le etichette
# plt.legend(title="Metrica", bbox_to_anchor=(1.05, 1), loc="upper left")

# Legenda DENTRO il grafico (no bbox_to_anchor), metti in alto in mezzo, fai che siano orizzontali
plt.legend(
    title="Metrica",
    loc="upper center",
    ncol=3,
    fontsize=10,
)

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
    plt.savefig(charts_dir / "01_accuratezza_modelli.png", dpi=300)
    print("Generato: charts/01_accuratezza_modelli.png")
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

# plt.title(
#     "Accuratezza per strategia di pre-processing",
#     fontsize=16,
#     fontweight="bold",
# )
plt.ylabel("Punteggio medio (0.0 - 1.0)", fontsize=12)
plt.xlabel("Strategia di pre-processing", fontsize=12)
plt.ylim(0, 1.1)  # Spazio per le etichette
# plt.legend(title="Metrica", bbox_to_anchor=(1.05, 1), loc="upper left")
plt.legend(
    title="Metrica",
    loc="upper right",
    ncol=3,
    fontsize=10,
)
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
    plt.savefig(charts_dir / "01.1_accuratezza_strategie.png", dpi=300)
    print("Generato: charts/01.1_accuratezza_strategie.png")
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
    y="F1-Score",
    hue="Modello",
    style="Strategia",
    s=200,
)

# plt.title("Efficienza economica vs. accuratezza", fontsize=16, fontweight="bold")
plt.xlabel("Numero di file processabili con 1$", fontsize=12)
plt.ylabel("F1-Score", fontsize=12)
plt.grid(True, linestyle="--", alpha=0.7)

# Aggiungiamo margini per dare spazio alle etichette
plt.margins(x=0.15, y=0.15)

# Annotazione dei punti con sfondo per migliore leggibilità
# Una label per modello (il punto con il massimo F1-Score)
texts = []
for model in df_plot["Modello"].unique():
    model_data = df_plot[df_plot["Modello"] == model]
    # Troviamo il punto con il massimo F1-Score per questo modello
    best_point = model_data.loc[model_data["F1-Score"].idxmax()]

    texts.append(
        plt.text(
            best_point["File_per_Dollaro"],
            best_point["F1-Score"],
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
    data=df_sorted_time, x="Latenza", y="Modello", hue="Strategia", palette="magma"
)

# plt.title("Velocità media (secondi/file)", fontsize=16, fontweight="bold")
plt.xlabel("Tempo in secondi", fontsize=12)
plt.ylabel("Modello", fontsize=12)

plt.tight_layout()
if args.save:
    plt.savefig(charts_dir / "03_latenza_modelli.png", dpi=300)
    print("Generato: charts/03_latenza_modelli.png")
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
    plt.savefig(charts_dir / "04_hallucination_rate.png", dpi=300)
    print("Generato: charts/04_hallucination_rate.png")
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
    plt.savefig(charts_dir / "05_phantom_strike_rate.png", dpi=300)
    print("Generato: charts/05_phantom_strike_rate.png")
if args.view:
    plt.show()

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
                "F1-Score": avg_std,
            }
        )

        # Aggiungiamo riga Chaos
        resilience_data.append(
            {
                "Metodo/Strategia": group,
                "Condizione": "DOM modificato",
                "F1-Score": avg_chaos,
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
        y="F1-Score",
        hue="Condizione",
        palette=custom_palette,
    )

    # plt.title(
    #     "Resilienza ai cambiamenti del DOM per strategia (media aggregata dei modelli AI)",
    #     fontsize=16,
    #     fontweight="bold",
    # )
    plt.ylabel("F1-Score medio (aggregato sui modelli AI)", fontsize=12)
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

# --- GRAFICO 8: PERFORMANCE (F1-SCORE) PER SOURCE (AZIENDA) ---
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
            "F1-Score": d.get("f1", 0),
        }
    )

if details_data:
    df_details = pd.DataFrame(details_data)

    # Raggruppiamo per calcolare la media dell'F1-Score per Source e Modello
    # In questo grafico ignoriamo la separazione per strategia (usiamo la media generale del modello)
    # oppure puoi filtrare per la tua strategia "vincente", ad esempio:
    # df_details = df_details[df_details["Strategia"] == "html-to-markdown"]

    plt.figure(figsize=(14, 8))
    ax = sns.barplot(
        data=df_details,
        x="Source",
        y="F1-Score",
        hue="Modello",
        palette="viridis",
        errorbar=None,  # Nascondiamo le barre di errore per maggiore pulizia visiva
    )

    plt.title(
        "F1-Score medio per modello su ciascun dataset",
        fontsize=16,
        fontweight="bold",
    )
    plt.ylabel("F1-Score (0.0 - 1.0)", fontsize=12)
    plt.xlabel("Sorgente dati (azienda)", fontsize=12)
    plt.ylim(0, 1.15)
    plt.legend(title="Modello AI", bbox_to_anchor=(1.05, 1), loc="upper left")

    # Aggiunta dei valori sopra le barre
    for p in ax.patches:
        height = p.get_height()
        if height > 0:
            ax.annotate(
                format(height, ".2f"),
                (p.get_x() + p.get_width() / 2.0, height),
                ha="center",
                va="bottom",
                xytext=(0, 5),
                textcoords="offset points",
                fontsize=8,
            )

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
                "F1-Score": metrics.get("avgF1", 0),
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
        df_perf_sorted = df_perf.sort_values("F1-Score", ascending=False)
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
                        "Standard F1-Score": base_f1,
                        "Chaos F1-Score": chaos_f1,
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
                "Average F1-Score": avg_f1,
                "Total Errors Aggregated": stats["total_differences"],
                "Times Evaluated": stats["count"],
            }
        )

    if worst_rows:
        df_worst = pd.DataFrame(worst_rows).sort_values(
            by=["Average F1-Score", "Total Errors Aggregated"], ascending=[True, False]
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
