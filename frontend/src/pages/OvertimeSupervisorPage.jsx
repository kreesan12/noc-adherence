// frontend/src/pages/OvertimeSupervisorPage.jsx
import React, { useEffect, useMemo, useState } from "react"
import { Alert, Box, Button, Chip, Stack, Typography } from "@mui/material"
import { DataGrid } from "@mui/x-data-grid"
import dayjs from "dayjs"
import api from "../api"

export default function OvertimeSupervisorPage() {
  const [period, setPeriod] = useState(null)
  const [rows, setRows] = useState([])
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState("")

  async function loadCurrentPeriod() {
    setError("")
    const p = await api.get("/overtime/period/current")
    setPeriod(p.data)
  }

  async function loadEntries(periodId) {
    setLoading(true)
    setError("")
    try {
      const r = await api.get(`/overtime/period/${periodId}/supervisor`)
      setRows(Array.isArray(r.data) ? r.data : [])
    } catch (e) {
      console.error(e)
      const msg =
        e?.response?.status === 403
          ? "403 Forbidden. Your login role is not allowed to access supervisor overtime endpoints."
          : e?.response?.data?.error || e?.message || "Failed to load overtime entries"
      setError(msg)
      setRows([])
    } finally {
      setLoading(false)
    }
  }

  async function generateFixed() {
    if (!period) return
    setLoading(true)
    setError("")
    try {
      await api.post(`/overtime/period/${period.id}/generate-fixed`)
      await loadEntries(period.id)
    } catch (e) {
      console.error(e)
      const msg =
        e?.response?.data?.error || e?.message || "Failed to generate fixed overtime"
      setError(msg)
    } finally {
      setLoading(false)
    }
  }

  async function approve(id) {
    if (!period) return
    setError("")
    try {
      await api.post(`/overtime/entry/${id}/supervisor-approve`)
      await loadEntries(period.id)
    } catch (e) {
      console.error(e)
      const msg =
        e?.response?.data?.error || e?.message || "Failed to approve entry"
      setError(msg)
    }
  }

  // NOTE: Editing times in a grid is tricky because your fields are ISO strings.
  // This keeps edit for numeric/text safely. If you want start/end edits, we can add a custom time editor.
  async function editRow(newRow, oldRow) {
    if (!period) return oldRow
    setError("")
    try {
      const patch = {
        totalHours: Number(newRow.totalHours),
        rate: Number(newRow.rate),
        reason: newRow.reason ?? null,
        notes: newRow.notes ?? null,
        editReason: "Supervisor adjustment",
      }
      await api.patch(`/overtime/entry/${newRow.id}/supervisor-edit`, patch)
      return newRow
    } catch (e) {
      console.error(e)
      const msg =
        e?.response?.data?.error || e?.message || "Failed to save edits"
      setError(msg)
      return oldRow
    }
  }

  useEffect(() => {
    loadCurrentPeriod().catch(err => {
      console.error(err)
      setError(err?.message || "Failed to load current period")
    })
  }, [])

  useEffect(() => {
    if (period?.id) loadEntries(period.id)
  }, [period?.id])

  const columns = useMemo(
    () => [
      {
        field: "agentName",
        headerName: "Agent",
        flex: 1,
        renderCell: params => params.row?.agent?.fullName || "Unknown",
        sortable: true,
      },
      {
        field: "supervisorName",
        headerName: "Supervisor",
        flex: 1,
        renderCell: params => params.row?.supervisor?.fullName || "Unassigned",
        sortable: true,
      },
      {
        field: "source",
        headerName: "Source",
        width: 120,
        renderCell: params => <Chip size="small" label={params.value} />,
      },
      { field: "status", headerName: "Status", width: 170 },
      {
        field: "workDate",
        headerName: "Date",
        width: 120,
        renderCell: params => (params.value ? dayjs(params.value).format("YYYY-MM-DD") : ""),
      },
      {
        field: "day",
        headerName: "Day",
        width: 90,
        valueGetter: (_v, row) => (row?.workDate ? dayjs(row.workDate).format("ddd") : ""),
      },
      {
        field: "startAt",
        headerName: "Start",
        width: 110,
        renderCell: params => (params.value ? dayjs(params.value).format("HH:mm") : ""),
      },
      {
        field: "endAt",
        headerName: "End",
        width: 110,
        renderCell: params => (params.value ? dayjs(params.value).format("HH:mm") : ""),
      },
      { field: "totalHours", headerName: "Hours", width: 110, editable: true },
      { field: "rate", headerName: "Rate", width: 90, editable: true },
      { field: "reason", headerName: "Reason", flex: 1, editable: true },
      {
        field: "actions",
        headerName: "Actions",
        width: 160,
        sortable: false,
        renderCell: params => (
          <Button
            size="small"
            onClick={() => approve(params.row.id)}
            disabled={params.row.status !== "SUBMITTED"}
          >
            Approve
          </Button>
        ),
      },
    ],
    [period]
  )

  const totals = useMemo(() => {
    const byPerson = new Map()
    for (const r of rows || []) {
      const name = r?.agent?.fullName || "Unknown"
      const v = byPerson.get(name) || { hours: 0, payUnits: 0, fixed: 0, manual: 0 }
      const h = Number(r?.totalHours || 0)
      const rate = Number(r?.rate || 0)
      v.hours += h
      v.payUnits += h * rate
      if (r?.source === "FIXED") v.fixed += 1
      if (r?.source === "MANUAL") v.manual += 1
      byPerson.set(name, v)
    }
    return [...byPerson.entries()]
  }, [rows])

  return (
    <Box sx={{ p: 2 }}>
      <Stack direction="row" justifyContent="space-between" alignItems="center" sx={{ mb: 2 }}>
        <Typography variant="h5">Overtime supervisor</Typography>
        <Button variant="outlined" onClick={generateFixed} disabled={!period || loading}>
          Generate fixed overtime
        </Button>
      </Stack>

      {period && (
        <Typography sx={{ mb: 2, opacity: 0.8 }}>
          Period: {period.label} ({dayjs(period.startDate).format("YYYY-MM-DD")} to{" "}
          {dayjs(period.endDate).format("YYYY-MM-DD")})
        </Typography>
      )}

      {error && <Alert severity="error" sx={{ mb: 2 }}>{error}</Alert>}

      <div style={{ height: 560, width: "100%" }}>
        <DataGrid
          rows={rows}
          columns={columns}
          loading={loading}
          getRowId={r => r.id}
          processRowUpdate={editRow}
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
