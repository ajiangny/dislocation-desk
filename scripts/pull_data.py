"""Pull history for every configured market into the local DuckDB cache.

    python scripts/pull_data.py --days 7
    python scripts/pull_data.py --start 2025-12-09 --end 2025-12-11   # a specific demo window
"""

import argparse
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

import pandas as pd  # noqa: E402

from dislocation_desk import config  # noqa: E402
from dislocation_desk.ingest import cache, fetch, to_grid  # noqa: E402

ap = argparse.ArgumentParser()
ap.add_argument("--days", type=int, default=7)
ap.add_argument("--start")
ap.add_argument("--end")
args = ap.parse_args()

end = pd.Timestamp(args.end, tz="UTC") if args.end else pd.Timestamp.now(tz="UTC")
start = pd.Timestamp(args.start, tz="UTC") if args.start else end - pd.Timedelta(days=args.days)

con = cache.connect()
for m in config.markets():
    if "TODO" in str(m.get("token_id", "")) + str(m.get("ticker", "")):
        print(f"skip {m['id']}: fill in its IDs in config/markets.yaml")
        continue
    try:
        n = cache.save(con, m["id"], to_grid(fetch(m, start, end)))
        print(f"{m['id']}: {n} bars")
    except Exception as e:
        print(f"{m['id']}: FAILED {type(e).__name__}: {e}")
