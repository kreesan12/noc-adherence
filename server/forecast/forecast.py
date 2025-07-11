#!/usr/bin/env python3
import sys, json
import pandas as pd
from prophet import Prophet

# ────────────────────────────────────────────────────────────────
# 1) Read JSON payload from stdin
#    Expected fields:
#      rows            list[{date, calls, tickets}, …]
#      lookBackMonths  int
#      horizonMonths   int
# ────────────────────────────────────────────────────────────────
cfg  = json.loads(sys.stdin.read())
rows = cfg["rows"]
back = int(cfg["lookBackMonths"])
hzn  = int(cfg["horizonMonths"])

df       = pd.DataFrame(rows)
df["ds"] = pd.to_datetime(df["date"])
df["y"]  = df["calls"] + df["tickets"]

# ────────────────────────────────────────────────────────────────
# 2) Flag “freeze” days  (25-31 OR 1-5 of each month)
# ────────────────────────────────────────────────────────────────
df["freeze"] = df["ds"].dt.day.apply(lambda d: 1 if (d >= 25 or d <= 5) else 0)

# only keep the look-back window
cutoff = df["ds"].max() - pd.DateOffset(months=back)
daily  = (
    df[df["ds"] >= cutoff]
    .groupby("ds")
    .agg({"y": "sum", "freeze": "max"})   # day is flagged iff any hour flagged
    .reset_index()
)

# ────────────────────────────────────────────────────────────────
# 3) Fit Prophet  (weekly seasonality + custom regressor)
# ────────────────────────────────────────────────────────────────
m = Prophet(
    weekly_seasonality=True,
    yearly_seasonality=False,
    daily_seasonality=False,
    seasonality_mode="additive"
)
# add the freeze dummy
m.add_regressor("freeze", mode="additive")
# optional: uncomment to allow a smooth monthly curve
# m.add_seasonality(name="monthly", period=30.5, fourier_order=5)

m.fit(daily)

# ────────────────────────────────────────────────────────────────
# 4) Build future frame & predict
# ────────────────────────────────────────────────────────────────
future = m.make_future_dataframe(periods=hzn * 30, freq="D")
future["freeze"] = future["ds"].dt.day.apply(
    lambda d: 1 if (d >= 25 or d <= 5) else 0
)

fcst = m.predict(future)[["ds", "yhat"]]

# ────────────────────────────────────────────────────────────────
# 5) Emit JSON back to Node
# ────────────────────────────────────────────────────────────────
out = [
    {
        "date": row.ds.strftime("%Y-%m-%d"),
        "expectedContacts": max(0, round(row.yhat))
    }
    for row in fcst.itertuples()
]
print(json.dumps(out))
