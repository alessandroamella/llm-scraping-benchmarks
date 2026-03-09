#!/usr/bin/env python3

import json
import pandas as pd
import matplotlib.pyplot as plt
import seaborn as sns
from pathlib import Path
import argparse

# Configurazione matplotlib identica al tuo script originale
plt.rcParams["font.family"] = "serif"
plt.rcParams["font.serif"] = ["Computer Modern"]
plt.rcParams["font.size"] = 10
plt.rcParams["axes.labelsize"] = 10
plt.rcParams["xtick.labelsize"] = 9
plt.rcParams["ytick.labelsize"] = 9
plt.rcParams["legend.fontsize"] = 9
sns.set_theme(style="whitegrid")

# Argparse setup
parser = argparse.ArgumentParser(description="Compare Strict vs Lenient benchmark results")
parser.add_argument("--strict", "-s", type=str, required=True, help="Path to the STRICT benchmark JSON file")
parser.add_argument("--lenient", "-l", type=str, required=True, help="Path to the LENIENT benchmark JSON file")
parser.add_argument("--view", "-v", action="store_true", default=False, help="Show plots")
parser.add_argument("--save", action="store_true", default=True, help="Save plots")
parser.add_argument("--no-save", action="store_false", dest="save", help="Do not save plots")
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
    
    print(f"Loading {schema_label} data from: {file_path}")
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
        
        df_list.append({
            "Parser": parser_name,
            "Modello": model_part,
            "Strategia": strategy_part,
            "Schema": schema_label,
            "F1-Score": metrics["avgF1"],
            "Precision": metrics["avgPrecision"],
            "Recall": metrics["avgRecall"],
            "Costo": metrics.get("costPerFile", 0),
            "Hallucination Rate (%)": (1 - metrics["avgPrecision"]) * 100
        })
    return df_list

# 1. Caricamento e unione dati
strict_data = load_data(args.strict, "Strict")
lenient_data = load_data(args.lenient, "Lenient")

if not strict_data or not lenient_data:
    print("⚠️ Dati insufficienti per il confronto. Verifica i file JSON.")
    exit(1)

df = pd.DataFrame(strict_data + lenient_data)

# Palette per i due schemi
schema_palette = {"Strict": "#3498db", "Lenient": "#e74c3c"} # Blu vs Rosso

# --- GRAFICO 1: CONFRONTO F1-SCORE ---
plt.figure(figsize=(16, 8))
ax1 = sns.barplot(
    data=df, 
    x="Parser", 
    y="F1-Score", 
    hue="Schema", 
    palette=schema_palette
)

plt.title("Confronto F1-Score: Strict vs Lenient Schema", fontsize=16, fontweight="bold")
plt.ylabel("F1-Score (0.0 - 1.0)", fontsize=12)
plt.xlabel("Modello [Strategia]", fontsize=12)
plt.ylim(0, 1.15)
plt.xticks(rotation=45, ha="right")
plt.legend(title="Schema", loc="upper left")

# Aggiunta valori sopra le barre
for p in ax1.patches:
    if p.get_height() > 0:
        ax1.annotate(
            format(p.get_height(), ".3f"),
            (p.get_x() + p.get_width() / 2., p.get_height()),
            ha="center", va="bottom",
            xytext=(0, 5), textcoords="offset points",
            fontsize=8, fontweight="bold"
        )

plt.tight_layout()
if args.save:
    plt.savefig("comp_01_f1_score.png", dpi=300)
    print("Generato: comp_01_f1_score.png")


# --- GRAFICO 2: CONFRONTO HALLUCINATION RATE (1 - Precision) ---
plt.figure(figsize=(16, 8))
ax2 = sns.barplot(
    data=df, 
    x="Parser", 
    y="Hallucination Rate (%)", 
    hue="Schema", 
    palette=schema_palette
)

plt.title("Confronto Hallucination Rate (Tasso di invenzione dati)", fontsize=16, fontweight="bold")
plt.ylabel("Hallucination Rate (%)", fontsize=12)
plt.xlabel("Modello [Strategia]", fontsize=12)
# plt.ylim(0, max(df["Hallucination Rate (%)"]) * 1.2)
plt.xticks(rotation=45, ha="right")
plt.legend(title="Schema", loc="upper left")

for p in ax2.patches:
    if p.get_height() > 0:
        ax2.annotate(
            f"{p.get_height():.1f}%",
            (p.get_x() + p.get_width() / 2., p.get_height()),
            ha="center", va="bottom",
            xytext=(0, 5), textcoords="offset points",
            fontsize=8, fontweight="bold"
        )

plt.tight_layout()
if args.save:
    plt.savefig("comp_02_hallucination_rate.png", dpi=300)
    print("Generato: comp_02_hallucination_rate.png")


# --- GRAFICO 3: CONFRONTO COSTI ---
plt.figure(figsize=(16, 8))
ax3 = sns.barplot(
    data=df, 
    x="Parser", 
    y="Costo", 
    hue="Schema", 
    palette=schema_palette
)

plt.title("Confronto Costo Medio per File", fontsize=16, fontweight="bold")
plt.ylabel("Costo stimato ($)", fontsize=12)
plt.xlabel("Modello [Strategia]", fontsize=12)
plt.xticks(rotation=45, ha="right")
plt.legend(title="Schema", loc="upper left")

for p in ax3.patches:
    if p.get_height() > 0:
        ax3.annotate(
            f"${p.get_height():.4f}",
            (p.get_x() + p.get_width() / 2., p.get_height()),
            ha="center", va="bottom",
            xytext=(0, 5), textcoords="offset points",
            fontsize=8, fontweight="bold", rotation=90
        )

plt.tight_layout()
if args.save:
    plt.savefig("comp_03_costo.png", dpi=300)
    print("Generato: comp_03_costo.png")


# --- STAMPA A CONSOLE DEL DELTA (MIGLIORAMENTO/PEGGIORAMENTO) ---
print("\n" + "="*80)
print(f"{'PARSER (Modello [Strategia])':<45} | {'Δ F1':<8} | {'Δ Costo':<10} | {'VERDETTO F1'}")
print("-" * 80)

# Creazione pivot table per calcolare i delta comodamente
pivot_df = df.pivot(index="Parser", columns="Schema", values=["F1-Score", "Costo"])

for parser in pivot_df.index:
    try:
        f1_strict = pivot_df.loc[parser, ("F1-Score", "Strict")]
        f1_lenient = pivot_df.loc[parser, ("F1-Score", "Lenient")]
        
        cost_strict = pivot_df.loc[parser, ("Costo", "Strict")]
        cost_lenient = pivot_df.loc[parser, ("Costo", "Lenient")]
        
        delta_f1 = f1_lenient - f1_strict
        delta_cost = cost_lenient - cost_strict
        
        # Formattazione visiva del verdetto
        if delta_f1 > 0.02:
            verdetto = "🟢 Lenient Vince"
        elif delta_f1 < -0.02:
            verdetto = "🔴 Strict Vince"
        else:
            verdetto = "⚪ Pareggio (±2%)"
            
        print(f"{parser:<45} | {delta_f1:>+8.3f} | ${delta_cost:>+9.5f} | {verdetto}")
        
    except KeyError:
        # Succede se un parser è presente in un run ma non nell'altro
        print(f"{parser:<45} | --- Dati non accoppiati ---")

print("="*80 + "\n")

if args.view:
    plt.show()
