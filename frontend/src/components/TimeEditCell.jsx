// frontend/src/components/TimeEditCell.jsx
import { useState, useEffect } from 'react'
import { TimePicker } from '@mui/x-date-pickers/TimePicker'
import { TextField } from '@mui/material'
import dayjs from 'dayjs'

export default function TimeEditCell(props) {
  const { id, field, value, api } = props
  // value is an ISO string, or null
  const [time, setTime] = useState(value ? dayjs(value) : null)

  // keep local if outside changes
  useEffect(() => {
    setTime(value ? dayjs(value) : null)
  }, [value])

  const handleChange = newValue => {
    setTime(newValue)
    const iso = newValue ? newValue.toISOString() : null
    api.setEditCellValue({ id, field, value: iso }, event => {
      // commit on blur or immediate
      api.commitCellChange({ id, field })
      api.setCellMode(id, field, 'view')
    })
  }

  return (
    <TimePicker
      label=""
      value={time}
      onChange={handleChange}
      renderInput={params => <TextField {...params} />}
    />
  )
}
