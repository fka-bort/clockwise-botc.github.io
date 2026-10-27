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

## Using it

Everything you'd change is in the first code cell:

- `DATA_PATH`: a JSON export from the dashboard (**Data & settings → Export**). Defaults to the synthetic sample data.
- `SIDE`: `"good"`, `"evil"` or `"all"`; `MIN_GAMES`; `SHRINK` (0 = raw rates).
- `FEATURES_TO_USE`: which rates to cluster on.
- `K_RANGE`: the k's to evaluate; `K_COMPARE`: the k's to put side by side; `K`: your pick.

Section 3 scores every k (silhouette against a shuffled no-structure baseline, bootstrap stability, elbow,
Calinski–Harabasz, Davies–Bouldin, GMM BIC). Section 4 shows the group profiles for the candidate k's side by side and
how groups split as k grows. Section 5 digs into the `K` you pick. Groups are numbered, not named.
