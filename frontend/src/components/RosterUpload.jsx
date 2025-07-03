// frontend/src/components/RosterUpload.jsx
import { useState } from 'react'
import { Box, Button, Paper, Snackbar } from '@mui/material'
import api from '../api'

export default function RosterUpload() {
  const [snack, setSnack] = useState('')

  const onFiles = (files) => {
    const file = files[0]
    const reader = new FileReader()

    reader.onload = async (e) => {
      const csvText = e.target.result
      try {
        const { data } = await api.post('/roster', { csv: csvText })
        setSnack(`Roster uploaded ✔  (${data.added} rows)`)
      } catch (err) {
        setSnack(`Error: ${err.response?.data?.error || err.message}`)
      }
    }

    reader.onerror = () => {
      setSnack('Failed to read file')
    }

    reader.readAsText(file)
  }

  return (
    <Paper
      sx={{ p:3, textAlign:'center' }}
      onDragOver={e => e.preventDefault()}
      onDrop={e => { e.preventDefault(); onFiles(e.dataTransfer.files) }}
    >
      <Box>Drag & drop CSV roster here</Box>
      <Button sx={{ mt:2 }} variant="contained" component="label">
        Browse CSV
        <input
          type="file"
          hidden
          accept=".csv"
          onChange={e => onFiles(e.target.files)}
        />
      </Button>
      <Snackbar
        open={Boolean(snack)}
        message={snack}
        autoHideDuration={3000}
        onClose={() => setSnack('')}
      />
    </Paper>
  )
}
