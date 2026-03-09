#!/usr/bin/env python3

import json
import pandas as pd
import matplotlib.pyplot as plt
import seaborn as sns
from pathlib import Path
import argparse

# Configurazione matplotlib
plt.rcParams["font.family"] = "serif"
plt.rcParams["font.serif"] = ["Computer Modern"]
plt.rcParams["font.size"] = 10
plt.rcParams["axes.labelsize"] = 10
plt.rcParams["xtick.labelsize"] = 9
plt.rcParams["ytick.labelsize"] = 9
plt.rcParams["legend.fontsize"] = 9
sns.set_theme(style="whitegrid")

# Argparse setup
parser = argparse.ArgumentParser(
    description="Compare Strict vs Lenient benchmark results"
)
parser.add_argument(
    "--strict",
    "-s",
    type=str,
    required=True,
    help="Path to the STRICT benchmark JSON file",
)
parser.add_argument(
    "--lenient",
    "-l",
    type=str,
    required=True,
    help="Path to the LENIENT benchmark JSON file",
)
parser.add_argument(
    "--view", "-v", action="store_true", default=False, help="Show plots"
)
parser.add_argument("--save", action="store_true", default=True, help="Save plots")
parser.add_argument(
    "--no-save", action="store_false", dest="save", help="Do not save plots"
)
args = parser.parse_args()


# Helper function to shorten model names
def normalize_model_name(model_name: str) -> str:
    aliases = {
        "meta-llama/llama-4-scout-17b-16e-instruct": "llama-4-scout-17b",
    }
    for full_name, short_name in aliases.items():
        if model_name == full_name or model_name.startswith(f"{full_name} "):
            return short_name
    return model_name


# Helper function to normalize strategy names
def normalize_strategy_name(strategy_name: str) -> str:
    return strategy_name.replace(" (Lenient)", "").replace(" (Strict)", "")


def load_data(file_path: str, schema_label: str) -> list:
    path = Path(file_path)
    if not path.exists():
        raise FileNotFoundError(f"File not found: {file_path}")

    print(f"Caricamento dati {schema_label} da: {file_path}")
    with open(path, "r", encoding="utf-8") as f:
        data = json.load(f)

    df_list = []
    summary = data.get("summary", {})

    for name, metrics in summary.items():
        model_part = normalize_model_name(name.split(" [")[0])
        strategy_part = normalize_strategy_name(name.split("[")[-1].replace("]", ""))

        # Ignora modelli manuali e chaos per un confronto pulito tra schemi
        if "Manual" in model_part or "CHAOS" in name:
            continue

        parser_name = f"{model_part} [{strategy_part}]"

        df_list.append(
            {
                "Parser": parser_name,
                "Modello": model_part,
                "Strategia": strategy_part,
                "Schema": schema_label,
                "F1-score": metrics["avgF1"],
                "Hallucination rate (%)": (1 - metrics["avgPrecision"]) * 100,
            }
        )
    return df_list


# 1. Caricamento e unione dati
strict_data = load_data(args.strict, "Strict")
lenient_data = load_data(args.lenient, "Lenient")

if not strict_data or not lenient_data:
    print("⚠️ Dati insufficienti per il confronto. Verifica i file JSON.")
    exit(1)

df = pd.DataFrame(strict_data + lenient_data)

# Palette per i due schemi
schema_palette = {"Strict": "#3498db", "Lenient": "#e74c3c"}  # Blu vs Rosso


# Funzione helper per generare i grafici
def create_comparison_plot(
    data, x_col, y_col, title, ylabel, xlabel, filename, is_percentage=False
):
    plt.figure(figsize=(12, 7))

    # errorbar=None è fondamentale qui: siccome stiamo aggregando per modello o per strategia,
    # seaborn calcolerebbe la media e mostrerebbe la varianza (le lineette nere).
    # Rimuovendole, abbiamo barre pulite che rappresentano la media esatta.
    ax = sns.barplot(
        data=data, x=x_col, y=y_col, hue="Schema", palette=schema_palette, errorbar=None
    )

    plt.title(title, fontsize=16, fontweight="bold")
    plt.ylabel(ylabel, fontsize=12)
    plt.xlabel(xlabel, fontsize=12)

    if is_percentage:
        plt.ylim(0, data[y_col].max() * 1.25)  # Lascia spazio per il testo in cima
    else:
        plt.ylim(0, 1.15)

    plt.xticks(rotation=25, ha="right")
    plt.legend(title="Schema", loc="upper left")

    # Aggiunta valori sopra le barre
    for p in ax.patches:
        height = p.get_height()
        # Controllo per evitare errori su barre vuote/NaN
        if pd.notna(height) and height > 0:
            text = f"{height:.1f}%" if is_percentage else f"{height:.3f}"
            ax.annotate(
                text,
                (p.get_x() + p.get_width() / 2.0, height),
                ha="center",
                va="bottom",
                xytext=(0, 5),
                textcoords="offset points",
                fontsize=9,
                fontweight="bold",
            )

    plt.tight_layout()
    if args.save:
        plt.savefig(filename, dpi=300)
        print(f"Generato: {filename}")


# --- GRAFICI 1: CONFRONTO F1-SCORE ---

# 1a. Raggruppato per Modello (media tra le varie strategie)
create_comparison_plot(
    data=df,
    x_col="Modello",
    y_col="F1-score",
    title="Confronto F1-score medio per modello: schema strict vs lenient",
    ylabel="F1-score medio (0.0 - 1.0)",
    xlabel="Modello AI",
    filename="comp_01a_f1_per_modello.png",
    is_percentage=False,
)

# 1b. Raggruppato per Strategia (media tra i vari modelli)
create_comparison_plot(
    data=df,
    x_col="Strategia",
    y_col="F1-score",
    title="Confronto F1-score medio per strategia di pre-processing: strict vs lenient",
    ylabel="F1-score medio (0.0 - 1.0)",
    xlabel="Strategia di pre-processing",
    filename="comp_01b_f1_per_strategia.png",
    is_percentage=False,
)


# --- GRAFICI 2: CONFRONTO HALLUCINATION RATE (1 - Precision) ---

# 2a. Raggruppato per Modello
create_comparison_plot(
    data=df,
    x_col="Modello",
    y_col="Hallucination rate (%)",
    title="Confronto hallucination rate per modello",
    ylabel="Tasso di allucinazione medio (%)",
    xlabel="Modello AI",
    filename="comp_02a_hallucination_per_modello.png",
    is_percentage=True,
)

# 2b. Raggruppato per Strategia
create_comparison_plot(
    data=df,
    x_col="Strategia",
    y_col="Hallucination rate (%)",
    title="Confronto hallucination rate per strategia di pre-processing",
    ylabel="Tasso di allucinazione medio (%)",
    xlabel="Strategia di pre-processing",
    filename="comp_02b_hallucination_per_strategia.png",
    is_percentage=True,
)


# --- STAMPA A CONSOLE DEL DELTA (MIGLIORAMENTO/PEGGIORAMENTO) ---
# Ho mantenuto la stampa dettagliata per parser, rimuovendo il costo
print("\n" + "=" * 80)
print(f"{'PARSER (Modello [Strategia])':<50} | {'Δ F1':<8} | {'VERDETTO'}")
print("-" * 80)

pivot_df = df.pivot(index="Parser", columns="Schema", values="F1-score")

for parser in pivot_df.index:
    try:
        f1_strict = pivot_df.loc[parser, "Strict"]
        f1_lenient = pivot_df.loc[parser, "Lenient"]

        delta_f1 = f1_lenient - f1_strict

        # Formattazione visiva del verdetto
        if delta_f1 > 0.02:
            verdetto = "🟢 Lenient vince"
        elif delta_f1 < -0.02:
            verdetto = "🔴 Strict vince"
        else:
            verdetto = "⚪ Pareggio (±2%)"

        print(f"{parser:<50} | {delta_f1:>+8.3f} | {verdetto}")

    except KeyError:
        print(f"{parser:<50} | --- Dati non accoppiati ---")

print("=" * 80 + "\n")

if args.view:
    plt.show()
