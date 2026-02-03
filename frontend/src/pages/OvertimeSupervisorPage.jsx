import React, { useEffect, useMemo, useState } from "react"
import { Box, Button, Chip, Stack, Typography } from "@mui/material"
import { DataGrid } from "@mui/x-data-grid"
import dayjs from "../lib/dayjs.js"
import api from "../api"
import { listOvertimeEntries } from '../api/overtime'



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

  async function editRow(row) {
    const patch = {
      workDate: row.workDate,
      startAt: row.startAt,
      endAt: row.endAt,
      totalHours: row.totalHours,
      rate: row.rate,
      reason: row.reason,
      notes: row.notes,
      editReason: "Supervisor adjustment",
    }
    await api.patch(`/overtime/entry/${row.id}/supervisor-edit`, patch)
    await loadEntries(period.id)
    return row
  }

  useEffect(() => {
    loadCurrentPeriod()
  }, [])

  useEffect(() => {
    if (period?.id) loadEntries(period.id)
  }, [period?.id])

  const columns = useMemo(() => ([
    { field: "agent", headerName: "Agent", flex: 1, valueGetter: p => p.row.agent?.fullName || "" },
    { field: "source", headerName: "Source", width: 120, renderCell: p => <Chip size="small" label={p.value} /> },
    { field: "status", headerName: "Status", width: 170 },
    { field: "workDate", headerName: "Date", width: 120, valueGetter: p => dayjs(p.row.workDate).format("YYYY-MM-DD") },
    { field: "day", headerName: "Day", width: 90, valueGetter: p => dayjs(p.row.workDate).format("ddd") },
    { field: "startAt", headerName: "Start", width: 110, valueGetter: p => dayjs(p.row.startAt).format("HH:mm"), editable: true },
    { field: "endAt", headerName: "End", width: 110, valueGetter: p => dayjs(p.row.endAt).format("HH:mm"), editable: true },
    { field: "totalHours", headerName: "Hours", width: 110, editable: true },
    { field: "rate", headerName: "Rate", width: 90, editable: true },
    { field: "reason", headerName: "Reason", flex: 1, editable: true },
    {
      field: "actions",
      headerName: "Actions",
      width: 160,
      sortable: false,
      renderCell: p => (
        <Button size="small" onClick={() => approve(p.row.id)} disabled={p.row.status !== "SUBMITTED"}>
          Approve
        </Button>
      ),
    },
  ]), [])

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
          <Button variant="outlined" onClick={generateFixed} disabled={!period}>Generate fixed overtime</Button>
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
          processRowUpdate={editRow}
          experimentalFeatures={{ newEditingApi: true }}
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
