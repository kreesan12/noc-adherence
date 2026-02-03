import React, { useMemo, useState } from "react"
import { Box, Button, Card, CardContent, TextField, Typography } from "@mui/material"
import dayjs from "../lib/dayjs.js"
import api from "../api"
import { listOvertimeEntries } from '../api/overtime'



function toIso(dateStr, timeStr) {
  return dayjs(`${dateStr} ${timeStr}`, "YYYY-MM-DD HH:mm").toISOString()
}

export default function OvertimeCapturePage() {
  const [workDate, setWorkDate] = useState(dayjs().format("YYYY-MM-DD"))
  const [startTime, setStartTime] = useState("18:00")
  const [endTime, setEndTime] = useState("20:00")
  const [reason, setReason] = useState("")
  const [notes, setNotes] = useState("")
  const [saving, setSaving] = useState(false)

  const minDate = useMemo(() => dayjs().subtract(7, "day").format("YYYY-MM-DD"), [])

  const canSave = workDate >= minDate && reason.trim().length > 0

  async function submit() {
    setSaving(true)
    try {
      await axios.post("/api/overtime/manual", {
        workDate,
        startAt: toIso(workDate, startTime),
        endAt: toIso(workDate, endTime),
        reason,
        notes,
      })
      setReason("")
      setNotes("")
      alert("Submitted")
    } catch (e) {
      alert(e?.response?.data?.error || e.message)
    } finally {
      setSaving(false)
    }
  }

  return (
    <Box sx={{ p: 2 }}>
      <Typography variant="h5" sx={{ mb: 2 }}>Overtime capture</Typography>

      <Card>
        <CardContent sx={{ display: "grid", gap: 2, maxWidth: 520 }}>
          <TextField
            label="Work date"
            type="date"
            value={workDate}
            inputProps={{ min: minDate, max: dayjs().format("YYYY-MM-DD") }}
            onChange={e => setWorkDate(e.target.value)}
          />

          <TextField
            label="Start time"
            type="time"
            value={startTime}
            onChange={e => setStartTime(e.target.value)}
          />

          <TextField
            label="End time"
            type="time"
            value={endTime}
            onChange={e => setEndTime(e.target.value)}
          />

          <TextField
            label="Reason"
            value={reason}
            onChange={e => setReason(e.target.value)}
          />

          <TextField
            label="Notes"
            value={notes}
            onChange={e => setNotes(e.target.value)}
            multiline
            minRows={2}
          />

          <Button
            variant="contained"
            disabled={!canSave || saving}
            onClick={submit}
          >
            Submit
          </Button>

          <Typography variant="body2" sx={{ opacity: 0.8 }}>
            Manual overtime can only be captured within the last 7 days.
          </Typography>
        </CardContent>
      </Card>
    </Box>
  )
}
