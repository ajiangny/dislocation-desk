from dislocation_desk.detect import detect
from dislocation_desk.ingest import cache
from dislocation_desk.replay import replay
from dislocation_desk.synthetic import demo_market


def test_cache_roundtrip(tmp_path):
    con = cache.connect(tmp_path / "c.duckdb")
    df = demo_market()
    assert cache.save(con, "m", df) == len(df)
    back = cache.load(con, "m")
    assert len(back) == len(df)
    assert (back["price"].values == df["price"].values).all()
    assert cache.cached_markets(con) == ["m"]


def test_replay_reveals_alerts_only_after_confirmation():
    df = demo_market()
    final = None
    for frame in replay(df, "m", step=10):
        assert all(a.confirmed_at <= frame.now for a in frame.alerts)
        final = frame
    assert len(final.alerts) == len(detect(df, "m"))
