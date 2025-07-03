import { useEffect, useState } from 'react'
import {
  DataGrid, GridToolbar,
} from '@mui/x-data-grid'
import {
  Button, Dialog, DialogTitle, DialogContent,
  Stack, TextField, Checkbox, FormControlLabel, MenuItem
} from '@mui/material'
import api from '../api'

export default function AgentsPage () {
  const [rows, setRows]   = useState([])
  const [open, setOpen]   = useState(false)
  const [form, setForm]   = useState({
    fullName:'', email:'', role:'NOC-I', standby:false
  })

  /* ───────── fetch once ───────── */
  useEffect(() => {
    api.get('/agents').then(r => setRows(r.data))
  }, [])

  /* ───────── grid columns ─────── */
  const cols = [
    { field:'id',       headerName:'ID',      width:70 },
    { field:'fullName', headerName:'Name',    flex:1  },
    { field:'email',    headerName:'Email',   flex:1  },
    { field:'role',     headerName:'Role',    width:110 },
    {
      field:'standbyFlag', headerName:'Stand-by', width:110,
      valueGetter: ({ row }) => row?.standbyFlag ? '✅' : '—'
    }
  ]

  /* ───────── save new agent ───── */
  async function handleSave () {
    await api.post('/agents', {
      fullName: form.fullName,
      email:    form.email,
      role:     form.role,
      standby:  form.standby
    })
    const { data } = await api.get('/agents')
    setRows(data)
    setOpen(false)
  }

  return (
    <>
      <Button variant="contained" sx={{ mb:2 }} onClick={()=>setOpen(true)}>
        + Add agent
      </Button>

      <DataGrid rows={rows} columns={cols}
                autoHeight disableRowSelectionOnClick
                slots={{ toolbar:GridToolbar }}/>

      <Dialog open={open} onClose={()=>setOpen(false)}>
        <DialogTitle>New agent</DialogTitle>
        <DialogContent>
          <Stack spacing={2} sx={{ mt:1, width:320 }}>
            <TextField label="Full name" value={form.fullName} required
                       onChange={e=>setForm({ ...form, fullName:e.target.value })}/>
            <TextField label="Email" type="email" value={form.email} required
                       onChange={e=>setForm({ ...form, email:e.target.value })}/>
            <TextField label="Role" select value={form.role}
                       onChange={e=>setForm({ ...form, role:e.target.value })}>
              {['NOC-I','NOC-II','Supervisor'].map(r=>
                <MenuItem key={r} value={r}>{r}</MenuItem>)}
            </TextField>
            <FormControlLabel control={
              <Checkbox checked={form.standby}
                        onChange={e=>setForm({ ...form, standby:e.target.checked })}/>
            } label="Stand-by rota"/>
            <Button variant="contained" onClick={handleSave}>Save</Button>
          </Stack>
        </DialogContent>
      </Dialog>
    </>
  )
}
