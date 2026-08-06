import { useEffect, useMemo, useState } from 'react'
import {
  Box,
  Button,
  Dialog,
  DialogContent,
  DialogTitle,
  MenuItem,
  Paper,
  Stack,
  TextField,
  Typography
} from '@mui/material'
import AddRoundedIcon from '@mui/icons-material/AddRounded'
import RestartAltRoundedIcon from '@mui/icons-material/RestartAltRounded'
import { DragDropContext, Droppable, Draggable } from '@hello-pangea/dnd'
import dayjs from 'dayjs'
import { useAuth } from '../context/AuthContext'
import api from '../api'
import { PageShell, SectionCard, FilterStrip } from '../components/ui/PageScaffold'
import { canAccessEngineering } from '../utils/access'

const ACCENT = '#0f766e'

function partition(rows) {
  const grouped = {}
  for (const row of rows) {
    const key = row.nldGroup || 'Un-grouped'
    ;(grouped[key] ??= []).push(row)
  }
  return grouped
}

export default function NldMappingPage() {
  const { user } = useAuth()
  const canEdit = canAccessEngineering(user?.role)

  const [circuits, setCircuits] = useState([])
  const [groups, setGroups] = useState({})
  const [openNew, setOpenNew] = useState(false)
  const [newName, setNewName] = useState('')
  const [query, setQuery] = useState('')

  async function loadCircuits() {
    const response = await api.get('/engineering/circuits')
    setCircuits(response.data ?? [])
    setGroups(partition(response.data ?? []))
  }

  useEffect(() => {
    loadCircuits().catch(console.error)
  }, [])

  async function onDragEnd(result) {
    if (!result.destination) return
    const { draggableId, destination, source } = result
    const from = source.droppableId
    const to = destination.droppableId
    if (from === to) return

    const row = groups[from]?.find((entry) => String(entry.id) === draggableId)
    if (!row) return

    setGroups((prev) => {
      const next = { ...prev }
      next[from] = (next[from] || []).filter((entry) => entry.id !== row.id)
      ;(next[to] ??= []).push({ ...row, nldGroup: to === 'Un-grouped' ? null : to })
      return next
    })

    try {
      await api.patch(`/engineering/circuit/${row.id}`, {
        nldGroup: to === 'Un-grouped' ? null : to
      })
    } catch (error) {
      console.error(error)
      await loadCircuits()
    }
  }

  function addGroup() {
    const value = newName.trim()
    if (!value) return
    setGroups((current) => ({ ...current, [value]: current[value] || [] }))
    setOpenNew(false)
    setNewName('')
  }

  const filteredGroups = useMemo(() => {
    const term = query.trim().toLowerCase()
    if (!term) return groups

    return Object.fromEntries(
      Object.entries(groups)
        .map(([groupName, items]) => [
          groupName,
          items.filter((item) => {
            return [item.circuitId, item.nodeA, item.nodeB, groupName]
              .filter(Boolean)
              .some((value) => String(value).toLowerCase().includes(term))
          })
        ])
        .filter(([, items]) => items.length > 0)
    )
  }, [groups, query])

  const groupCount = Object.keys(groups).length

  return (
    <PageShell
      eyebrow="Engineering"
      title="NLD Mapping"
      description="Group circuits into NLD lanes, search the current mapping estate, and drag circuits between groups when you need to rebalance or clean up classifications."
      accent={ACCENT}
      stats={[
        { label: 'Circuits', value: circuits.length, helper: 'loaded into the board' },
        { label: 'Groups', value: groupCount, helper: 'current NLD lanes' },
        { label: 'Filtered Lanes', value: Object.keys(filteredGroups).length, helper: query ? 'matching current search' : 'currently visible' },
        { label: 'Edit Access', value: canEdit ? 'Enabled' : 'View only', helper: canEdit ? 'drag and group changes allowed' : 'sign in with elevated access to edit' }
      ]}
    >
      <SectionCard
        title="Filters and Actions"
        subtitle="Search by circuit, node, or group, then create new lanes or reload the current state."
        accent={ACCENT}
      >
        <FilterStrip>
          <TextField
            label="Search mapping"
            size="small"
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            sx={{ minWidth: 260, flex: 1 }}
          />
          <Button variant="outlined" startIcon={<RestartAltRoundedIcon />} onClick={() => loadCircuits().catch(console.error)}>
            Refresh
          </Button>
          {canEdit ? (
            <Button variant="contained" startIcon={<AddRoundedIcon />} onClick={() => setOpenNew(true)}>
              New NLD Group
            </Button>
          ) : null}
        </FilterStrip>
      </SectionCard>

      <SectionCard
        title="Mapping Board"
        subtitle="Drag circuits between groups to persist a new NLD assignment."
        accent={ACCENT}
      >
        <DragDropContext onDragEnd={onDragEnd}>
          <Box
            sx={{
              display: 'grid',
              gridTemplateColumns: 'repeat(auto-fit, minmax(260px, 1fr))',
              gap: 1
            }}
          >
            {Object.entries(filteredGroups).map(([groupName, items]) => (
              <Lane key={groupName} id={groupName} items={items} canEdit={canEdit} />
            ))}
          </Box>
        </DragDropContext>
      </SectionCard>

      <Dialog open={openNew} onClose={() => setOpenNew(false)}>
        <DialogTitle>Create NLD Group</DialogTitle>
        <DialogContent>
          <Stack spacing={2} sx={{ mt: 1, width: 320 }}>
            <TextField label="Group name" value={newName} onChange={(event) => setNewName(event.target.value)} autoFocus />
            <Button variant="contained" onClick={addGroup}>Add Group</Button>
          </Stack>
        </DialogContent>
      </Dialog>
    </PageShell>
  )
}

function Lane({ id, items, canEdit }) {
  return (
    <Paper elevation={0} sx={{ p: 1.05, borderRadius: 2.2, border: '1px solid', borderColor: 'divider', bgcolor: 'rgba(255,255,255,0.82)' }}>
      <Stack direction="row" alignItems="center" justifyContent="space-between" sx={{ mb: 0.8 }}>
        <Typography variant="subtitle1" sx={{ fontWeight: 700 }}>
          {id}
        </Typography>
        <Typography variant="caption" sx={{ color: 'text.secondary' }}>
          {items.length} circuits
        </Typography>
      </Stack>

      <Droppable droppableId={id} isDropDisabled={!canEdit}>
        {(provided) => (
          <Box ref={provided.innerRef} {...provided.droppableProps} sx={{ minHeight: 58 }}>
            {items.map((row, index) => (
              <Draggable key={row.id} draggableId={String(row.id)} index={index} isDragDisabled={!canEdit}>
                {(dragProvided) => (
                  <Paper
                    ref={dragProvided.innerRef}
                    {...dragProvided.draggableProps}
                    {...dragProvided.dragHandleProps}
                    sx={{
                      p: 0.9,
                      mb: 0.75,
                      bgcolor: '#fafafa',
                      borderRadius: 1.7,
                      cursor: canEdit ? 'grab' : 'default',
                      border: '1px solid',
                      borderColor: 'divider'
                    }}
                  >
                    <Typography variant="body2" sx={{ fontWeight: 700 }}>
                      {row.circuitId}
                    </Typography>
                    <Typography variant="caption" sx={{ display: 'block' }}>
                      {row.nodeA} - {row.nodeB}
                    </Typography>
                    <Typography variant="caption" color="text.secondary">
                      Updated {dayjs(row.updatedAt).format('YY-MM-DD HH:mm')}
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
}
