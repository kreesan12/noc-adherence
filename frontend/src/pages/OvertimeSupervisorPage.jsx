import React, { useEffect, useMemo, useState } from "react"
import { Box, Button, Chip, Stack, Typography } from "@mui/material"
import { DataGrid } from "@mui/x-data-grid"
import dayjs from "../lib/dayjs.js"
import api from "../api"

function buildIsoFromDateAndTime(workDateIsoOrDate, hhmm) {
  // workDateIsoOrDate can be ISO string or Date
  const d = dayjs(workDateIsoOrDate)
  const [hh, mm] = String(hhmm || "").split(":").map(Number)
  if (!Number.isFinite(hh) || !Number.isFinite(mm)) return null
  return d.hour(hh).minute(mm).second(0).millisecond(0).toISOString()
}

export default function OvertimeSupervisorPage() {
  const [period, setPeriod] = useState(null)
  const [rows, setRows] = useState([])
  const [loading, setLoading] = useState(false)

  async function loadCurrentPeriod() {
    const p = await api.get("/overtime/period/current")
    setPeriod(p.data)
  }

  async function loadEntries(periodId) {
    setLoading(true)
    try {
      const r = await api.get(`/overtime/period/${periodId}/supervisor`)
      setRows(r.data)
    } finally {
      setLoading(false)
    }
  }

  async function generateFixed() {
    if (!period) return
    await api.post(`/overtime/period/${period.id}/generate-fixed`)
    await loadEntries(period.id)
  }

  async function approve(id) {
    await api.post(`/overtime/entry/${id}/supervisor-approve`)
    await loadEntries(period.id)
  }

  const processRowUpdate = async (newRow, oldRow) => {
    // Build PATCH payload only for changed fields
    const patch = {}

    // Work date (if you ever allow editing it later)
    if (newRow.workDate !== oldRow.workDate) patch.workDate = dayjs(newRow.workDate).format("YYYY-MM-DD")

    // Times: allow editing by HH:mm, but store as ISO
    if (newRow._startHHmm && newRow._startHHmm !== oldRow._startHHmm) {
      const iso = buildIsoFromDateAndTime(newRow.workDate, newRow._startHHmm)
      if (iso) patch.startAt = iso
    }
    if (newRow._endHHmm && newRow._endHHmm !== oldRow._endHHmm) {
      const iso = buildIsoFromDateAndTime(newRow.workDate, newRow._endHHmm)
      if (iso) patch.endAt = iso
    }

    if (Number(newRow.totalHours) !== Number(oldRow.totalHours)) patch.totalHours = Number(newRow.totalHours)
    if (Number(newRow.rate) !== Number(oldRow.rate)) patch.rate = Number(newRow.rate)
    if ((newRow.reason ?? "") !== (oldRow.reason ?? "")) patch.reason = newRow.reason ?? null
    if ((newRow.notes ?? "") !== (oldRow.notes ?? "")) patch.notes = newRow.notes ?? null

    if (!Object.keys(patch).length) return newRow

    // You want manager approval if edited
    patch.editReason = "Supervisor adjustment"

    await api.patch(`/overtime/entry/${newRow.id}/supervisor-edit`, patch)
    await loadEntries(period.id)

    return newRow
  }

  useEffect(() => {
    loadCurrentPeriod()
  }, [])

  useEffect(() => {
    if (period?.id) loadEntries(period.id)
  }, [period?.id])

  const columns = useMemo(() => ([
    {
      field: "agent",
      headerName: "Agent",
      flex: 1,
      valueGetter: p => p.row.agent?.fullName || ""
    },
    {
      field: "source",
      headerName: "Source",
      width: 120,
      renderCell: p => <Chip size="small" label={p.value} />
    },
    { field: "status", headerName: "Status", width: 180 },

    {
      field: "workDate",
      headerName: "Date",
      width: 120,
      renderCell: p => dayjs(p.row.workDate).format("YYYY-MM-DD")
    },
    {
      field: "day",
      headerName: "Day",
      width: 90,
      valueGetter: p => dayjs(p.row.workDate).format("ddd")
    },

    // Editable time inputs stored in helper fields
    {
      field: "_startHHmm",
      headerName: "Start",
      width: 110,
      editable: true,
      valueGetter: p => dayjs(p.row.startAt).format("HH:mm"),
    },
    {
      field: "_endHHmm",
      headerName: "End",
      width: 110,
      editable: true,
      valueGetter: p => dayjs(p.row.endAt).format("HH:mm"),
    },

    { field: "totalHours", headerName: "Hours", width: 110, editable: true },
    { field: "rate", headerName: "Rate", width: 90, editable: true },
    { field: "reason", headerName: "Reason", flex: 1, editable: true },

    {
      field: "actions",
      headerName: "Actions",
      width: 160,
      sortable: false,
      renderCell: p => (
        <Button
          size="small"
          onClick={() => approve(p.row.id)}
          disabled={p.row.status !== "SUBMITTED"}
        >
          Approve
        </Button>
      ),
    },
  ]), [period?.id])

  const totals = useMemo(() => {
    const byPerson = new Map()
    for (const r of rows) {
      const name = r.agent?.fullName || "Unknown"
      const v = byPerson.get(name) || { hours: 0, payUnits: 0, fixed: 0, manual: 0 }
      const h = Number(r.totalHours || 0)
      const rate = Number(r.rate || 0)
      v.hours += h
      v.payUnits += h * rate
      if (r.source === "FIXED") v.fixed += 1
      if (r.source === "MANUAL") v.manual += 1
      byPerson.set(name, v)
    }
    return [...byPerson.entries()]
  }, [rows])

  return (
    <Box sx={{ p: 2 }}>
      <Stack direction="row" justifyContent="space-between" alignItems="center" sx={{ mb: 2 }}>
        <Typography variant="h5">Overtime supervisor</Typography>
        <Stack direction="row" spacing={1}>
          <Button variant="outlined" onClick={generateFixed} disabled={!period}>
            Generate fixed overtime
          </Button>
        </Stack>
      </Stack>

      {period && (
        <Typography sx={{ mb: 2, opacity: 0.8 }}>
          Period: {period.label} ({dayjs(period.startDate).format("YYYY-MM-DD")} to {dayjs(period.endDate).format("YYYY-MM-DD")})
        </Typography>
      )}

      <div style={{ height: 560, width: "100%" }}>
        <DataGrid
          rows={rows}
          columns={columns}
          loading={loading}
          getRowId={r => r.id}
          processRowUpdate={processRowUpdate}
          onProcessRowUpdateError={console.error}
          disableRowSelectionOnClick
        />
      </div>

      <Box sx={{ mt: 2 }}>
        <Typography variant="h6">Totals</Typography>
        {totals.map(([name, v]) => (
          <Typography key={name}>
            {name}: {v.hours.toFixed(2)} hours, {v.payUnits.toFixed(2)} pay units, {v.fixed} fixed lines, {v.manual} manual lines
          </Typography>
        ))}
      </Box>
    </Box>
  )
}
