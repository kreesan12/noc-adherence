#!/usr/bin/env python3
import sys, json
import pandas as pd
from prophet import Prophet
from datetime import timedelta

# ---------- 1) read payload -------------------------------------------------
cfg   = json.loads(sys.stdin.read())
rows  = cfg["rows"]               # [{date, calls, tickets}, …]
back  = int(cfg["lookBackMonths"])
hzn   = int(cfg["horizonMonths"])

df          = pd.DataFrame(rows)
df["ds"]    = pd.to_datetime(df["date"])
df["y"]     = df["calls"] + df["tickets"]

# --- freeze window flag  (25-31 OR 1-5)  ------------------------------------
df["freeze"] = df["ds"].dt.day.apply(
    lambda d: 1 if (d >= 25 or d <= 5) else 0
)

# keep only look-back window
cutoff_date  = df["ds"].max() - pd.DateOffset(months=back)
daily        = (
    df[df["ds"] >= cutoff_date]
    .groupby("ds")
    .agg({"y":"sum", "freeze":"max"})   # ≥1 freeze flag → 1
    .reset_index()
)

# ---------- 2)  fit Prophet --------------------------------------------------
m = Prophet(
        weekly_seasonality=True,
        yearly_seasonality=False,
        daily_seasonality=False,
        seasonality_mode="additive"
    )

# optional smooth monthly component (≈ 30½-day period)
# m.add_seasonality(name="monthly", period=30.5, fourier_order=5)

# the special change-freeze regressor
m.add_regressor("freeze", mode="additive")

m.fit(daily)

# ---------- 3)  make future frame (+freeze flag) -----------------------------
future = m.make_future_dataframe(periods=hzn*30, freq="D")
future["freeze"] = future["ds"].dt.day.apply(
    lambda d: 1 if (d >= 25 or d <= 5) else 0
)

fcst = m.predict(future)[["ds", "yhat"]]

# ---------- 4)  emit JSON back to Node --------------------------------------
out = [
    {
        "date": row.ds.strftime("%Y-%m-%d"),
        "expectedContacts": max(0, round(row.yhat))
    }
    for row in fcst.itertuples()
]
print(json.dumps(out))
