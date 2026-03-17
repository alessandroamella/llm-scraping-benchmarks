#!/usr/bin/env python3

import json
import pandas as pd
import matplotlib.pyplot as plt
import seaborn as sns
from matplotlib.ticker import FuncFormatter
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

charts_dir = Path("charts")
charts_dir.mkdir(exist_ok=True)

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
                "Hallucination rate": (1 - metrics["avgPrecision"]),
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
    data,
    x_col,
    y_col,
    title,
    ylabel,
    xlabel,
    filename,
    is_percentage=False,
    broken_axis_range=None,
):
    if broken_axis_range:
        # Broken axis: zoom sulla zona di interesse
        zoom_min, zoom_max = broken_axis_range

        fig, (ax1, ax2) = plt.subplots(
            2, 1, sharex=True, figsize=(12, 8), gridspec_kw={"height_ratios": [3, 1]}
        )
        fig.subplots_adjust(hspace=-0.02)

        # Disegniamo sui due assi
        sns.barplot(
            data=data,
            x=x_col,
            y=y_col,
            hue="Schema",
            palette=schema_palette,
            errorbar="sd",
            capsize=0.08,
            ax=ax1,
        )
        sns.barplot(
            data=data,
            x=x_col,
            y=y_col,
            hue="Schema",
            palette=schema_palette,
            errorbar="sd",
            capsize=0.08,
            ax=ax2,
        )

        # Impostiamo i limiti
        ax1.set_ylim(zoom_min, zoom_max)
        ax2.set_ylim(0, 0.1)

        # Nascondiamo le etichette y al bordo del taglio per evitare overlap (es. 0.800 / 0.100)
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

        # Formattiamo le error bars
        for ax in [ax1, ax2]:
            for line in ax.lines:
                line.set_color("red")
                line.set_linewidth(2.0)

        # Bisciolina bianca sui bordi di taglio (intervallo omesso)
        wave_amp = 0.028
        num_waves = 21
        x_points = []
        y_wave_top = []
        y_wave_bottom = []

        # Limita la bisciolina all'area coperta dalle barre (senza toccare gli assi laterali)
        first_bar = ax1.patches[0]
        bars_per_category = len(data["Schema"].unique())
        categories_count = len(data[x_col].unique())
        last_bar = ax1.patches[categories_count * bars_per_category - 1]
        left_data = first_bar.get_x()
        right_data = last_bar.get_x() + last_bar.get_width()

        left_axes = ax1.transAxes.inverted().transform(
            ax1.transData.transform((left_data, 0))
        )[0]
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

        # ax1.set_title(title, fontsize=16, fontweight="bold")
        ax1.set_ylabel(ylabel, fontsize=12)
        ax2.set_ylabel("")
        ax2.set_xlabel(xlabel, fontsize=12)
        ax2.tick_params(axis="x", rotation=25)
        ax1.legend(title="Schema", loc="upper left", fontsize=10)
        ax2.get_legend().remove()

        # Annotazioni solo sull'asse superiore
        # for p in ax1.patches:
        #     height = p.get_height()
        #     if pd.notna(height) and height > 0:
        #         text = f"{height:.1f}%" if is_percentage else f"{height:.3f}"
        #         ax1.annotate(
        #             text,
        #             (p.get_x() + p.get_width() / 2.0, height),
        #             ha="center",
        #             va="bottom",
        #             xytext=(0, 5),
        #             textcoords="offset points",
        #             fontsize=9,
        #             fontweight="bold",
        #         )
    else:
        # Grafico standard senza broken axis
        plt.figure(figsize=(12, 7))

        ax = sns.barplot(
            data=data,
            x=x_col,
            y=y_col,
            hue="Schema",
            palette=schema_palette,
            errorbar="sd",
            capsize=0.08,
        )

        # plt.title(title, fontsize=16, fontweight="bold")
        plt.ylabel(ylabel, fontsize=12)
        plt.xlabel(xlabel, fontsize=12)

        if is_percentage:
            plt.ylim(0, data[y_col].max() * 1.25)
        else:
            plt.ylim(0, 0.2)

        plt.xticks(rotation=25, ha="right")
        plt.legend(title="Schema", loc="upper left", fontsize=10)

        # Formattiamo le error bars come negli altri grafici
        for line in ax.lines:
            line.set_color("red")
            line.set_linewidth(2.0)

        # Aggiunta valori sopra le barre
        # for p in ax.patches:
        #     height = p.get_height()
        #     if pd.notna(height) and height > 0:
        #         text = f"{height:.1f}%" if is_percentage else f"{height:.3f}"
        #         ax.annotate(
        #             text,
        #             (p.get_x() + p.get_width() / 2.0, height),
        #             ha="center",
        #             va="bottom",
        #             xytext=(0, 5),
        #             textcoords="offset points",
        #             fontsize=9,
        #             fontweight="bold",
        #         )

    if broken_axis_range:
        # Evita che tight_layout riapra il gap tra i due pannelli broken-axis
        fig.subplots_adjust(left=0.09, right=0.985, top=0.94, bottom=0.20, hspace=-0.06)
    else:
        plt.tight_layout()
    if args.save:
        plt.savefig(charts_dir / filename, dpi=300)
        print(f"Generato: charts/{filename}")


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
    broken_axis_range=(0.8, 1.0),
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
    broken_axis_range=(0.8, 1.0),
)


# --- GRAFICI 2: CONFRONTO TASSO DI ALLUCINAZIONE (1 - Precision) ---

# 2a. Raggruppato per Modello
create_comparison_plot(
    data=df,
    x_col="Modello",
    y_col="Hallucination rate",
    title="Confronto tasso di allucinazione per modello",
    ylabel="Tasso di allucinazione medio (0.0 - 1.0)",
    xlabel="Modello AI",
    filename="comp_02a_hallucination_per_modello.png",
    is_percentage=False,
)

# 2b. Raggruppato per Strategia
create_comparison_plot(
    data=df,
    x_col="Strategia",
    y_col="Hallucination rate",
    title="Confronto tasso di allucinazione per strategia di pre-processing",
    ylabel="Tasso di allucinazione medio (0.0 - 1.0)",
    xlabel="Strategia di pre-processing",
    filename="comp_02b_hallucination_per_strategia.png",
    is_percentage=False,
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
