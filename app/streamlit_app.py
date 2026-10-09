"""Dislocation Desk dashboard.   streamlit run app/streamlit_app.py

Pick a market, press Play to replay the day, and watch alert cards appear as
the detector confirms each move. Falls back to a synthetic market until real
data has been cached with scripts/pull_data.py.
"""

import sys
import time
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

import pandas as pd  # noqa: E402
import plotly.graph_objects as go  # noqa: E402
import streamlit as st  # noqa: E402
from plotly.subplots import make_subplots  # noqa: E402

from dislocation_desk import config, expose  # noqa: E402
from dislocation_desk.detect import DetectorParams, Spike, detect  # noqa: E402
from dislocation_desk.explain import explain, headlines, news_window  # noqa: E402
from dislocation_desk.ingest import cache  # noqa: E402
from dislocation_desk.synthetic import demo_market  # noqa: E402

SYNTHETIC = {"id": "synthetic-demo", "name": "Fed cuts in December (synthetic demo)", "event_type": "fed_rates"}

st.set_page_config(page_title="Dislocation Desk", layout="wide")
st.title("Dislocation Desk")
st.caption("Which event odds just broke, why, and which names are exposed.")


@st.cache_data
def load_market(market_id: str) -> pd.DataFrame:
    if market_id == SYNTHETIC["id"]:
        return demo_market()
    return cache.load(cache.connect(), market_id)


@st.cache_data(show_spinner="Explaining the move...")
def card_text(spike_dict: dict, market_name: str, event_type: str, query: str) -> tuple[str, list[dict]]:
    s = Spike(**{k: v for k, v in spike_dict.items() if k != "direction"})
    start, end = news_window(s)
    heads = headlines(query, start, end) if query else []
    return explain(s, market_name, heads, expose.note(event_type)), heads


# ---- sidebar: market + detector params ---------------------------------------------------
try:
    cached = set(cache.cached_markets(cache.connect()))
except Exception:
    cached = set()
options = [m for m in config.markets() if m["id"] in cached] + [SYNTHETIC]
with st.sidebar:
    market = st.selectbox("Market", options, format_func=lambda m: m["name"])
    st.subheader("Detector")
    p = DetectorParams(
        window=st.slider("Jump window (min)", 5, 60, 15),
        score_threshold=st.slider("Alert threshold (score)", 2.0, 10.0, 4.0, 0.5),
        hold=st.slider("Must hold for (min)", 5, 120, 30),
        vol_min_ratio=st.slider("Volume needed (× usual)", 1.5, 10.0, 2.0, 0.5),
    )
    news_query = st.text_input("News query for this market", value='"Federal Reserve" OR Powell')
    speed = st.slider("Replay speed (bars per tick)", 1, 60, 15)

df = load_market(market["id"])
if df.empty:
    st.warning("No data cached for this market yet.")
    st.stop()
spikes = detect(df, market["id"], p)

# ---- replay clock -----------------------------------------------------------------------
if "pos" not in st.session_state or st.session_state.get("market") != market["id"]:
    st.session_state.pos, st.session_state.market, st.session_state.playing = len(df), market["id"], False
c1, c2, c3 = st.columns([1, 1, 6])
if c1.button("▶ Play from start"):
    st.session_state.pos, st.session_state.playing = p.baseline, True
if c2.button("⏹ Stop"):
    st.session_state.playing = False
pos = c3.slider("Replay time", p.baseline, len(df), st.session_state.pos, label_visibility="collapsed")
if not st.session_state.playing:
    st.session_state.pos = pos
now = df.index[st.session_state.pos - 1]
visible = df.iloc[: st.session_state.pos]
alerts = [s for s in spikes if s.confirmed_at <= now]

# ---- chart ------------------------------------------------------------------------------
fig = make_subplots(rows=2, cols=1, shared_xaxes=True, row_heights=[0.75, 0.25], vertical_spacing=0.03)
fig.add_trace(go.Scatter(x=visible.index, y=visible["price"], name="Probability", line=dict(width=2)), row=1, col=1)
if visible["volume"].notna().any():
    fig.add_trace(go.Bar(x=visible.index, y=visible["volume"], name="Volume", opacity=0.5), row=2, col=1)
for s in alerts:
    color = "rgba(220,50,50,0.15)" if s.kind == "jump" else "rgba(240,160,30,0.15)"
    fig.add_vrect(x0=s.start, x1=s.peak, fillcolor=color, line_width=0, row=1, col=1)
    fig.add_trace(go.Scatter(x=[s.peak], y=[s.p_after], mode="markers", marker=dict(size=12, symbol="x"),
                             name=f"{s.kind} alert", showlegend=False), row=1, col=1)
fig.update_yaxes(tickformat=".0%", row=1, col=1)
fig.update_xaxes(range=[df.index[0], df.index[-1]])
fig.update_layout(height=480, margin=dict(l=10, r=10, t=10, b=10), legend=dict(orientation="h"))
st.plotly_chart(fig, use_container_width=True)
st.caption(f"Replay clock: {now:%Y-%m-%d %H:%M} UTC · {len(alerts)} alert(s) so far")

# ---- alert cards ------------------------------------------------------------------------
for s in reversed(alerts):
    why, heads = card_text(s.to_dict(), market["name"], market["event_type"], news_query)
    exp = expose.exposed(market["event_type"])
    with st.container(border=True):
        tag = "🔴 JUMP" if s.kind == "jump" else "🟠 DRIFT"
        st.markdown(f"**{tag} · {market['name']}** — {s.headline()}")
        st.markdown(f"**Why:** {why}")
        names = ", ".join(exp["etfs"])
        if exp["companies"]:
            names += " · " + ", ".join(c["company"] for c in exp["companies"][:5])
        st.markdown(f"**Exposed ({exp['label']}):** {names}")
        if exp["note"]:
            st.caption(exp["note"])
        st.caption(f"Move {s.start:%H:%M}–{s.peak:%H:%M}, confirmed {s.confirmed_at:%H:%M} UTC · score {s.score:.1f} · held {s.persistence:.0%}")
        if heads:
            with st.expander(f"{len(heads)} headlines in window"):
                for h in heads:
                    st.markdown(f"- [{h['title']}]({h['url']}) · {h['domain']}")

if st.session_state.playing:
    if st.session_state.pos < len(df):
        time.sleep(0.15)
        st.session_state.pos = min(len(df), st.session_state.pos + speed)
        st.rerun()
    st.session_state.playing = False
