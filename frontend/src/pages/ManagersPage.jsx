// frontend/src/pages/ManagersPage.jsx
import { useEffect, useState } from 'react'
import {
  Box, Typography, Button, Stack, TextField, Dialog,
  DialogTitle, DialogContent, MenuItem
} from '@mui/material'
import { DataGrid, GridToolbar } from '@mui/x-data-grid'
import DeleteIcon from '@mui/icons-material/Delete'
import AddIcon    from '@mui/icons-material/Add'
import { useAuth } from '../context/AuthContext'

/*  🔹 helper functions live in api/managers.js  */
import {
  listManagers,
  addManager,
  deleteManager
} from '../api/managers'

export default function ManagersPage () {
  const { user } = useAuth()
  const isAdmin  = user?.role === 'admin'

  /* state */
  const [rows, setRows] = useState([])
  const [open, setOpen] = useState(false)
  const [form, setForm] = useState({
    fullName:'', email:'', password:'', role:'manager'
  })

  /* load once */
  useEffect(() => { refresh() }, [])
  const refresh = async () =>
    setRows((await listManagers()).data)

  /* save new */
  const save = async () => {
    await addManager(form)        // 🔹 helper
    await refresh()
    setOpen(false)
    setForm({ fullName:'', email:'', password:'', role:'manager' })
  }

  /* delete */
  const del = async (id) => {
    if (!window.confirm('Delete manager?')) return
    await deleteManager(id)       // 🔹 helper
    await refresh()
  }

  /* columns */
  const cols = [
    { field:'id', width:70 },
    { field:'fullName', flex:1, headerName:'Name' },
    { field:'email', flex:1 },
    { field:'role', width:140 },
    {
      field:'actions',
      headerName:'', width:70, sortable:false, filterable:false,
      renderCell:p=> isAdmin && (
        <Button size="small" color="error" onClick={()=>del(p.row.id)}>
          <DeleteIcon fontSize="inherit" />
        </Button>
      )
    }
  ]

  /* render */
  return (
    <Box p={2}>
      <Stack direction="row" alignItems="center" mb={2}>
        <Typography variant="h5" fontWeight={700} sx={{ flexGrow:1 }}>
          Managers / Engineers
        </Typography>
        {isAdmin && (
          <Button variant="contained" startIcon={<AddIcon/>}
                  onClick={() => setOpen(true)}>
            New
          </Button>
        )}
      </Stack>

      <DataGrid
        rows={rows}
        columns={cols}
        autoHeight
        disableRowSelectionOnClick
        slots={{ toolbar: GridToolbar }}
        getRowId={r => r.id}
      />

      {/* dialog */}
      <Dialog open={open} onClose={() => setOpen(false)}>
        <DialogTitle>Add manager / engineer</DialogTitle>
        <DialogContent>
          <Stack spacing={2} sx={{ mt:1, width:320 }}>
            <TextField label="Full name"   value={form.fullName} required
                       onChange={e=>setForm({...form,fullName:e.target.value})}/>
            <TextField label="Email" type="email" value={form.email} required
                       onChange={e=>setForm({...form,email:e.target.value})}/>
            <TextField label="Password" type="password" value={form.password} required
                       onChange={e=>setForm({...form,password:e.target.value})}/>
            <TextField label="Role" select value={form.role}
                       onChange={e=>setForm({...form,role:e.target.value})}>
              <MenuItem value="manager">manager</MenuItem>
              <MenuItem value="engineering">engineering</MenuItem>
            </TextField>
            <Button variant="contained" onClick={save}>Save</Button>
          </Stack>
        </DialogContent>
      </Dialog>
    </Box>
  )
}
