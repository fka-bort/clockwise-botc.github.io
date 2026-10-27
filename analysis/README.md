# Playstyle analysis (Python)

`playstyles.ipynb` is a workbench for deciding whether players fall into playstyles, how many, and on which rates,
before anything is named or put on the dashboard. `playstyles.py` holds the shared logic (fates, features, shrinkage)
and mirrors `extension/src/playstyles.js`.

## Run it in VS Code

1. Install the **Python** and **Jupyter** extensions in VS Code.
2. In a terminal in this folder:
   ```
   python3 -m venv .venv
   source .venv/bin/activate
   pip install -r requirements.txt
   ```
3. Open `playstyles.ipynb`, pick the `.venv` kernel (top right), and **Run All**.

## Your data stays out of git

- Put the dashboard's export (**Data & settings → Export**, CSV or JSON) in `analysis/data/`. That folder is in
  `.gitignore`. The notebook reads it by default (`DATA_PATH = "data"`); with several exports there, it takes the
  latest.
- Notebook outputs (charts and tables with real names) are stripped as the notebook is committed; your copy keeps
  them. This needs a one-time setup in each clone, from the repo root:
  ```
  git config filter.strip-notebook-outputs.clean "python3 analysis/tools/strip_outputs.py"
  git config filter.strip-notebook-outputs.required true
  ```
- To try it without real data, set `DATA_PATH = "../sample-data/botc-sample-games.json"` (made-up games).

## Using it

Everything you'd change is in the first code cell: `SIDE` (`"good"`, `"evil"` or `"all"`), `MIN_GAMES`, `SHRINK`
(0 = raw rates), `FEATURES_TO_USE`, `K_RANGE` (k's to evaluate), `K_COMPARE` (k's side by side) and `K` (your pick).

Section 3 scores every k (silhouette against a shuffled no-structure baseline, bootstrap stability, elbow,
Calinski–Harabasz, Davies–Bouldin, GMM BIC). Section 4 shows the group profiles for the candidate k's side by side and
how groups split as k grows. Section 5 digs into the `K` you pick. Groups are numbered, not named.

## What the CSV export can't tell apart

- Night deaths show up at the start of the next day, so a death counts as an **execution** when the player was
  nominated that day with enough votes, and otherwise as **killed** (by the demon or an ability).
- Voters are listed by name; a handful of names that can't be matched to a seat in that game are skipped.
