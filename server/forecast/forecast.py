#!/usr/bin/env python3
import sys, json
import pandas as pd
import numpy as np
from prophet import Prophet

cfg  = json.loads(sys.stdin.read())
rows = cfg["rows"]
back = int(cfg["lookBackMonths"])
hzn  = int(cfg["horizonMonths"])

# optional: planning risk level (default p50-ish)
# allowed: "mean" (yhat), "p50" (yhat), "p80" (closer to yhat_upper), "p20" (closer to yhat_lower)
risk = (cfg.get("risk", "p50") or "p50").lower()

df = pd.DataFrame(rows)
df["ds"] = pd.to_datetime(df["date"])
df["y"]  = (df["calls"].fillna(0) + df["tickets"].fillna(0)).astype(float)

# freeze days: 25-31 OR 1-5
df["freeze"] = df["ds"].dt.day.apply(lambda d: 1 if (d >= 25 or d <= 5) else 0)

# lookback window
cutoff = df["ds"].max() - pd.DateOffset(months=back)
daily = (
    df[df["ds"] >= cutoff]
    .groupby("ds", as_index=False)
    .agg(y=("y", "sum"), freeze=("freeze", "max"))
)

# --- Outlier handling (winsorise daily totals) ---
# cap at p95, floor at p05 inside the lookback
p05 = daily["y"].quantile(0.05)
p95 = daily["y"].quantile(0.95)
daily["y"] = daily["y"].clip(lower=p05, upper=p95)

# --- Logistic growth to keep forecasts sane ---
# cap is a soft ceiling above recent high values
cap = max(1.0, float(daily["y"].quantile(0.95) * 1.30))
daily["cap"] = cap
daily["floor"] = 0.0

m = Prophet(
    growth="logistic",
    weekly_seasonality=True,
    yearly_seasonality=False,
    daily_seasonality=False,
    seasonality_mode="additive",
    changepoint_prior_scale=0.10,     # less jumpy trend
    seasonality_prior_scale=10.0,     # allow weekday pattern
    interval_width=0.80
)

m.add_regressor("freeze", mode="additive")
m.add_seasonality(name="monthly", period=30.5, fourier_order=5)

m.fit(daily.rename(columns={"y": "y"}))

future = m.make_future_dataframe(periods=hzn * 30, freq="D")
future["freeze"] = future["ds"].dt.day.apply(lambda d: 1 if (d >= 25 or d <= 5) else 0)
future["cap"] = cap
future["floor"] = 0.0

pred = m.predict(future)[["ds", "yhat", "yhat_lower", "yhat_upper"]]

def choose_value(row):
    if risk == "mean" or risk == "p50":
        return row.yhat
    if risk == "p80":
        # lean upward, but not full upper bound
        return 0.3 * row.yhat + 0.7 * row.yhat_upper
    if risk == "p20":
        return 0.3 * row.yhat + 0.7 * row.yhat_lower
    return row.yhat

out = []
for r in pred.itertuples(index=False):
    val = max(0.0, float(choose_value(r)))
    out.append({
        "date": r.ds.strftime("%Y-%m-%d"),
        "expectedContacts": int(round(val))
    })

print(json.dumps(out))
