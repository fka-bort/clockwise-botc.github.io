"""Git clean filter: removes outputs and run counts from notebooks as they're committed.

Charts and tables in a run notebook show real players' names, so they stay on your computer: the copy in git only
ever has the code. Your working copy keeps its outputs. Set up once per clone (from the repo root):

    git config filter.strip-notebook-outputs.clean "python3 analysis/tools/strip_outputs.py"
    git config filter.strip-notebook-outputs.required true

.gitattributes routes every .ipynb through it. With `required`, a commit fails rather than letting outputs through if
python3 can't run.
"""
import json
import sys

nb = json.load(sys.stdin)
for cell in nb.get("cells", []):
    if cell.get("cell_type") == "code":
        cell["outputs"] = []
        cell["execution_count"] = None
    cell.get("metadata", {}).pop("execution", None)
nb.get("metadata", {}).pop("widgets", None)
json.dump(nb, sys.stdout, indent=1, ensure_ascii=False)
sys.stdout.write("\n")
