import { useState } from 'react'
import { Box, Button, Paper, Snackbar } from '@mui/material'
import Papa from 'papaparse'
import api from '../api'

export default function RosterUpload() {
  const [snack, setSnack] = useState('')
  const onFiles = (files) => {
    const file = files[0]
    Papa.parse(file, {
      header: true,
      skipEmptyLines: true,
      complete: async ({ data }) => {
        await api.post('/roster', data)
        setSnack('Roster uploaded ✔')
      }
    })
  }
  return (
    <Paper sx={{ p:3, textAlign:'center' }}
           onDragOver={e=>e.preventDefault()}
           onDrop={e=>{e.preventDefault(); onFiles(e.dataTransfer.files)}}>
      <Box>Drag & drop CSV roster here</Box>
      <Button sx={{ mt:2 }} variant="contained"
        component="label">Browse CSV
        <input type="file" hidden accept=".csv" onChange={e=>onFiles(e.target.files)}/>
      </Button>
      <Snackbar open={Boolean(snack)} message={snack} autoHideDuration={3000}
                onClose={()=>setSnack('')}/>
    </Paper>
  )
}
