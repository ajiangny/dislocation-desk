import numpy as np
import pandas as pd

from dislocation_desk.detect import DetectorParams, detect, detect_drifts, detect_jumps, logit, robust_z
from dislocation_desk.synthetic import add_drift, add_fat_finger, add_jump, demo_market, quiet_market


def test_logit_symmetry():
    p = pd.Series([0.1, 0.5, 0.9])
    lg = logit(p)
    assert abs(lg.iloc[1]) < 1e-12
    assert np.isclose(lg.iloc[0], -lg.iloc[2])


def test_robust_z_ignores_earlier_outlier():
    x = pd.Series(np.r_[np.zeros(100), 50.0, np.zeros(100), 1.0])
    z = robust_z(x, baseline=150, min_scale=0.1)
    # one huge earlier value must not shrink the z of the later move
    assert z.iloc[-1] >= 9


def test_quiet_market_has_no_jumps():
    for seed in range(5):
        assert detect_jumps(quiet_market(seed=seed)) == []


def test_real_jump_fires_near_injection():
    df = add_jump(quiet_market(seed=1), at=700, size=0.9)
    spikes = detect_jumps(df, "m")
    assert len(spikes) == 1
    s = spikes[0]
    assert s.direction == "up"
    assert abs((s.peak - df.index[700]).total_seconds()) <= 30 * 60
    assert s.volume_ratio > 2


def test_fat_finger_does_not_fire():
    df = add_fat_finger(quiet_market(seed=2), at=500, size=1.5)
    assert detect_jumps(df) == []


def test_jump_without_volume_is_damped():
    base = quiet_market(seed=3)
    loud = add_jump(base, at=700, size=0.9, vol_mult=6.0)
    thin = add_jump(base, at=700, size=0.9, vol_mult=1.0)
    p = DetectorParams()
    assert detect_jumps(loud, params=p)
    assert max((s.score for s in detect_jumps(thin, params=p)), default=0) < max(s.score for s in detect_jumps(loud, params=p))


def test_slow_drift_caught_by_cusum_not_jump():
    df = add_drift(quiet_market(seed=4), at=600, size=-0.8, over=300)
    assert detect_jumps(df) == []
    drifts = detect_drifts(df)
    assert drifts and drifts[0].direction == "down"
    assert df.index[600] <= drifts[0].peak <= df.index[1000]


def test_demo_market_end_to_end():
    spikes = detect(demo_market(), "demo")
    kinds = [s.kind for s in spikes]
    assert "jump" in kinds and "drift" in kinds
    # nothing fires on the fat finger around bar 420
    ff = demo_market().index[420]
    assert not any(abs((s.peak - ff).total_seconds()) < 45 * 60 for s in spikes)
