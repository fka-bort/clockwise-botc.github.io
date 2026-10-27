# Playstyle analysis (Python)

`playstyles.ipynb` runs the same analysis as the dashboard's **Playstyles** tab, with extra checks on how strong the
clusters are: how many groups to use, a permutation test for "is there any structure at all", bootstrap stability,
per-player silhouettes, a PCA biplot and a Ward dendrogram. `playstyles.py` holds the shared logic (fates, features,
shrinkage) and mirrors `extension/src/playstyles.js`.

## Run it in VS Code

1. Install the **Python** and **Jupyter** extensions in VS Code.
2. In a terminal in this folder:
   ```
   python3 -m venv .venv
   source .venv/bin/activate
   pip install -r requirements.txt
   ```
3. Open `playstyles.ipynb`, pick the `.venv` kernel (top right), and **Run All**.

It runs on `../sample-data/botc-sample-games.json` (synthetic games) out of the box. For your community's games, export
JSON from the dashboard (**Data & settings → Export**) and set `DATA_PATH` in the first code cell. `SIDE`, `MIN_GAMES`
and `K` are there too.
