import React, { useEffect, useState } from "react"
import { Box, Button, Stack, Typography } from "@mui/material"
import { DataGrid } from "@mui/x-data-grid"
import dayjs from "../lib/dayjs.js"
import api from "../api"


export default function OvertimeManagerPage() {
  const [period, setPeriod] = useState(null)
  const [rows, setRows] = useState([])
  const [loading, setLoading] = useState(false)

  async function loadCurrentPeriod() {
    const p = await axios.get("/api/overtime/period/current")
    setPeriod(p.data)
  }

  async function loadQueue(periodId) {
    setLoading(true)
    try {
      const r = await axios.get(`/api/overtime/period/${periodId}/manager`)
      setRows(r.data)
    } finally {
      setLoading(false)
    }
  }

  async function approve(id) {
    await axios.post(`/api/overtime/entry/${id}/manager-approve`)
    await loadQueue(period.id)
  }

  function exportZip() {
    window.location.href = `/api/overtime/period/${period.id}/export`
  }

  useEffect(() => {
    loadCurrentPeriod()
  }, [])

  useEffect(() => {
    if (period?.id) loadQueue(period.id)
  }, [period?.id])

  const columns = [
    { field: "agent", headerName: "Agent", flex: 1, valueGetter: p => p.row.agent?.fullName || "" },
    { field: "source", headerName: "Source", width: 120 },
    { field: "workDate", headerName: "Date", width: 120, valueGetter: p => dayjs(p.row.workDate).format("YYYY-MM-DD") },
    { field: "startAt", headerName: "Start", width: 100, valueGetter: p => dayjs(p.row.startAt).format("HH:mm") },
    { field: "endAt", headerName: "End", width: 100, valueGetter: p => dayjs(p.row.endAt).format("HH:mm") },
    { field: "totalHours", headerName: "Hours", width: 100 },
    { field: "rate", headerName: "Rate", width: 90 },
    { field: "editedRequiresManager", headerName: "Edited", width: 100, valueGetter: p => (p.row.editedRequiresManager ? "Yes" : "No") },
    {
      field: "actions",
      headerName: "Actions",
      width: 150,
      renderCell: p => (
        <Button size="small" onClick={() => approve(p.row.id)}>
          Approve
        </Button>
      ),
    },
  ]

  return (
    <Box sx={{ p: 2 }}>
      <Stack direction="row" justifyContent="space-between" alignItems="center" sx={{ mb: 2 }}>
        <Typography variant="h5">Overtime manager</Typography>
        <Button variant="contained" onClick={exportZip} disabled={!period}>
          Export approved templates
        </Button>
      </Stack>

      {period && (
        <Typography sx={{ mb: 2, opacity: 0.8 }}>
          Period: {period.label}
        </Typography>
      )}

      <div style={{ height: 560, width: "100%" }}>
        <DataGrid rows={rows} columns={columns} loading={loading} getRowId={r => r.id} />
      </div>
    </Box>
  )
}
