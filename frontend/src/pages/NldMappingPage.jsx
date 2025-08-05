// frontend/src/pages/NldMappingPage.jsx
import { useEffect, useState } from 'react'
import {
  Box, Paper, Typography, Stack, Button, TextField, Dialog,
  DialogTitle, DialogContent, IconButton
} from '@mui/material'
import AddIcon from '@mui/icons-material/Add'
import { DragDropContext, Droppable, Draggable } from '@hello-pangea/dnd'
import { useAuth } from '../context/AuthContext'
import api        from '../api'
import dayjs      from 'dayjs'

export default function NldMappingPage () {
  const { user } = useAuth()
  const canEdit  = user?.role === 'engineering'

  /* ---------------- state ---------------- */
  const [circuits,setCircuits] = useState([])          // raw list
  const [groups,  setGroups]   = useState({})          // { NLD1:[rows…], … }

  /* modal for new group */
  const [openNew,setOpenNew] = useState(false)
  const [newName,setNewName] = useState('')

  /* -------------- load once -------------- */
  useEffect(()=>{
    api.get('/engineering/circuits').then(res=>{
      setCircuits(res.data)
      setGroups(partition(res.data))
    })
  },[])

  /* helper: partition rows by nldGroup */
  function partition(rows){
    const g = {}
    for (const r of rows){
      const key = r.nldGroup || 'Un-grouped'
      ;(g[key] ??= []).push(r)
    }
    return g
  }

  /* -------------- DnD handlers ----------- */
  async function onDragEnd(result){
    if (!result.destination) return
    const { draggableId, destination, source } = result
    const from = source.droppableId
    const to   = destination.droppableId
    if (from === to) return

    // find circuit
    const row = groups[from].find(r=>String(r.id)===draggableId)

    // optimistic UI
    setGroups(prev=>{
      const next = { ...prev }
      next[from] = next[from].filter(r=>r.id!==row.id)
      ;(next[to] ??= []).push({ ...row, nldGroup: to==='Un-grouped' ? null : to })
      return next
    })

    // persist
    try{
      await api.patch(`/engineering/circuit/${row.id}`,{
        nldGroup: to==='Un-grouped' ? null : to
      })
    }catch(e){
      console.error(e)
      // on error, reload fresh state
      const { data } = await api.get('/engineering/circuits')
      setGroups(partition(data))
    }
  }

  /* -------------- render lane ------------- */
  const Lane = ({ id, items }) => (
    <Paper elevation={0} sx={{ p:2, minWidth:260 }}>
      <Typography variant="subtitle1" fontWeight={600} mb={1}>
        {id} <Typography component="span" variant="caption">({items.length})</Typography>
      </Typography>

      <Droppable droppableId={id} isDropDisabled={!canEdit}>
        {provided=>(
          <Box ref={provided.innerRef} {...provided.droppableProps}
               sx={{ minHeight:50 }}>
            {items.map((r,idx)=>(
              <Draggable key={r.id} draggableId={String(r.id)} index={idx}
                         isDragDisabled={!canEdit}>
                {prov=>(
                  <Paper
                    ref={prov.innerRef} {...prov.draggableProps} {...prov.dragHandleProps}
                    sx={{ p:1, mb:1, bgcolor:'#fafafa', cursor: canEdit?'grab':'default' }}
                  >
                    <Typography variant="body2" fontWeight={600}>
                      {r.circuitId}
                    </Typography>
                    <Typography variant="caption">
                      {r.nodeA} – {r.nodeB}
                    </Typography><br/>
                    <Typography variant="caption" color="text.secondary">
                      {dayjs(r.updatedAt).format('YY-MM-DD HH:mm')}
                    </Typography>
                  </Paper>
                )}
              </Draggable>
            ))}
            {provided.placeholder}
          </Box>
        )}
      </Droppable>
    </Paper>
  )

  /* -------------- create new group ---------- */
  function addGroup(){
    if (!newName.trim()) return
    setGroups(g=>({ ...g, [newName.trim()]:[] }))
    setOpenNew(false); setNewName('')
  }

  /* -------------- main render --------------- */
  return (
    <Box p={2}>
      <Stack direction="row" alignItems="center" mb={2} spacing={2}>
        <Typography variant="h5" fontWeight={700}>NLD Mapping</Typography>
        {canEdit && (
          <Button startIcon={<AddIcon/>} variant="contained"
                  onClick={()=>setOpenNew(true)}>
            New NLD
          </Button>
        )}
      </Stack>

      <DragDropContext onDragEnd={onDragEnd}>
        <Stack direction="row" spacing={2} flexWrap="wrap">
          {Object.entries(groups).map(([id,items])=>(
            <Lane key={id} id={id} items={items} />
          ))}
        </Stack>
      </DragDropContext>

      {/* new-group dialog */}
      <Dialog open={openNew} onClose={()=>setOpenNew(false)}>
        <DialogTitle>Create NLD Group</DialogTitle>
        <DialogContent>
          <Stack spacing={2} sx={{ mt:1, width:300 }}>
            <TextField label="Name" value={newName}
                       onChange={e=>setNewName(e.target.value)} autoFocus/>
            <Button variant="contained" onClick={addGroup}>Add</Button>
          </Stack>
        </DialogContent>
      </Dialog>
    </Box>
  )
}
