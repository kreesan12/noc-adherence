import { useEffect, useState } from 'react'
import {
  Box, Button, Dialog, DialogTitle, DialogContent, DialogActions,
  MenuItem, Snackbar, TextField, Typography
} from '@mui/material'
import dayjs from 'dayjs'
import api from '../api'

export default function LeavePlannerPage () {
  const [rows, setRows] = useState([])
  const [open, setOpen] = useState(false)
  const [form, setForm] = useState({ agentId:'', reason:'', from:dayjs(), to:dayjs().add(1,'day') })
  const [agents, setAgents] = useState([])
  const [snack, setSnack] = useState('')

  /* load agents + existing leave once */
  useEffect(() => {
    ;(async () => {
      const [{ data: a },{ data: l }] = await Promise.all([
        api.get('/agents'),
        api.get('/leaves')
      ])
      setAgents(a); setRows(l)
    })()
  }, [])

  async function handleSave () {
    try {
      await api.post('/leaves', {
        ...form,
        startsAt : form.from.format(),
        endsAt   : form.to.format()
      })
      setSnack('Leave captured')
      setOpen(false)
      const { data } = await api.get('/leaves')
      setRows(data)
    } catch { setSnack('Save failed') }
  }

  return (
    <Box p={2}>
      <Typography variant='h5' gutterBottom>Planned leave</Typography>

      <Button onClick={() => setOpen(true)} variant='contained' sx={{ mb:2 }}>
        + Add leave
      </Button>

      {/* quick + dirty table */}
      <pre style={{ whiteSpace:'pre-wrap', fontSize:14 }}>
        {rows.map(r => `${r.agent.fullName}: ${dayjs(r.startsAt).format('DD MMM')} → ${dayjs(r.endsAt).format('DD MMM')} – ${r.reason}`).join('\n')}
      </pre>

      {open && (
        <Dialog open onClose={() => setOpen(false)}>
          <DialogTitle>New leave / PTO</DialogTitle>
          <DialogContent
            sx={{ display:'flex', flexDirection:'column', gap:2, mt:1, minWidth:280 }}
          >
            <TextField
              select label='Agent' value={form.agentId}
              onChange={e => setForm(f => ({ ...f, agentId:+e.target.value }))}
            >
              {agents.map(a => (
                <MenuItem key={a.id} value={a.id}>{a.fullName}</MenuItem>
              ))}
            </TextField>

            <TextField
              label='Reason' fullWidth value={form.reason}
              onChange={e => setForm(f => ({ ...f, reason:e.target.value }))}
            />

            <TextField
              type='date' label='From' InputLabelProps={{ shrink:true }}
              value={form.from.format('YYYY-MM-DD')}
              onChange={e => setForm(f => ({ ...f, from:dayjs(e.target.value) }))}
            />
            <TextField
              type='date' label='To' InputLabelProps={{ shrink:true }}
              value={form.to.format('YYYY-MM-DD')}
              onChange={e => setForm(f => ({ ...f, to:dayjs(e.target.value) }))}
            />
          </DialogContent>
          <DialogActions>
            <Button onClick={() => setOpen(false)}>Cancel</Button>
            <Button onClick={handleSave} disabled={!form.agentId || !form.reason}>
              Save
            </Button>
          </DialogActions>
        </Dialog>
      )}

      <Snackbar open={!!snack} message={snack} autoHideDuration={4000}
                onClose={()=>setSnack('')}/>
    </Box>
  )
}
