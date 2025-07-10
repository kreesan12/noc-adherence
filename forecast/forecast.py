#!/usr/bin/env python3
import sys, json, pandas as pd
from prophet import Prophet
from datetime import timedelta
# 1) ---------------- read payload from stdin -----------------
cfg   = json.loads(sys.stdin.read())
rows  = cfg["rows"]              # list of dicts from Node
back  = int(cfg["lookBackMonths"])
hzn   = int(cfg["horizonMonths"])

df          = pd.DataFrame(rows)
df["ds"]    = pd.to_datetime(df["date"])
df["y"]     = df["calls"] + df["tickets"]        # total demand
cutoff_date = df["ds"].max() - pd.DateOffset(months=back)
daily       = df[df["ds"] >= cutoff_date].groupby("ds").sum().reset_index()

# 2) ---------------- fit Prophet -----------------------------
m = Prophet(weekly_seasonality=True,
            yearly_seasonality=False,
            daily_seasonality=False,
            seasonality_mode="additive")
m.fit(daily)

future = m.make_future_dataframe(periods=hzn*30, freq="D")
fcst   = m.predict(future)[["ds", "yhat"]]

# 3) ---------------- output JSON -----------------------------
out = [
  {"date": row.ds.strftime("%Y-%m-%d"),
   "expectedContacts": max(0, round(row.yhat))}
  for row in fcst.itertuples()
]
print(json.dumps(out))
