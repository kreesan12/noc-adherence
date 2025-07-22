// frontend/src/components/AssignTab.jsx
import { useState } from 'react'
import {
  DndContext,
  PointerSensor,
  useSensor,
  useSensors,
  closestCenter,
  DragOverlay,
  useDroppable
} from '@dnd-kit/core'
import {
  SortableContext,
  useSortable,
  verticalListSortingStrategy
} from '@dnd-kit/sortable'
import { CSS } from '@dnd-kit/utilities'
import api from '../api'
import { Box, Card, CardContent, Chip, Stack, Typography } from '@mui/material'

export default function AssignTab({ agents, supers, refreshAgents }) {
  // Build lists keyed by supervisorId (string) plus "unassigned"
  const [lists, setLists] = useState(() => {
    const bySup = Object.fromEntries(
      supers.map(s => [String(s.id), []])
    )
    const unassigned = []
    agents.forEach(a => {
      if (a.supervisorId) bySup[String(a.supervisorId)]?.push(a)
      else unassigned.push(a)
    })
    return { unassigned, ...bySup }
  })

  // Drag-and-drop sensors
  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 5 } })
  )

  // Handle drop events
  const handleDragEnd = async ({ active, over }) => {
    if (!over) return

    const fromKey = active.data.current.sortable.containerId
    const toKey =
      over.data.current?.sortable?.containerId  // drop on an item
      ?? over.id                                // drop on empty column

    if (fromKey === toKey) return

    // 1️⃣ Optimistic UI update
    setLists(prev => {
      const src = [...prev[fromKey]]
      const dest = [...prev[toKey]]
      const idx = src.findIndex(a => a.id === active.id)
      dest.push(src.splice(idx, 1)[0])
      return { ...prev, [fromKey]: src, [toKey]: dest }
    })

    // 2️⃣ Persist change & refresh
    const supervisorId = toKey === 'unassigned' ? null : Number(toKey)
    await api.patch(`/agents/${active.id}/supervisor`, { supervisorId })
    await refreshAgents()
  }

  return (
    <DndContext
      sensors={sensors}
      collisionDetection={closestCenter}
      onDragEnd={handleDragEnd}
    >
      {/* Grid container: auto-wrap, top-align, consistent gaps */}
      <Box
        sx={{
          display: 'grid',
          gridTemplateColumns: 'repeat(auto-fill, minmax(220px, 1fr))',
          gap: 2,
          alignItems: 'start'
        }}
      >
        {/* Unassigned bucket */}
        <SupColumn id="unassigned" title="Unassigned" agents={lists.unassigned} />

        {/* One column per supervisor */}
        {supers.map(s => (
          <SupColumn
            key={s.id}
            id={String(s.id)}
            title={s.fullName}
            agents={lists[String(s.id)]}
          />
        ))}
      </Box>

      {/* Drag overlay */}
      <DragOverlay>
        {({ active }) => active ? <Chip label={active.data.current.label} /> : null}
      </DragOverlay>
    </DndContext>
  )
}

function SupColumn({ id, title, agents }) {
  // Make the Card itself a droppable target (even if it's empty)
  const { setNodeRef } = useDroppable({ id })

  return (
    <Card ref={setNodeRef} sx={{ minWidth: 220 }}>
      <CardContent>
        <Typography variant="subtitle1" gutterBottom>
          {title}
        </Typography>
        <SortableContext id={id} items={agents} strategy={verticalListSortingStrategy}>
          <Stack spacing={1}>
            {agents.map(a => <AgentChip key={a.id} agent={a} />)}
          </Stack>
        </SortableContext>
      </CardContent>
    </Card>
  )
}

function AgentChip({ agent }) {
  const { attributes, listeners, setNodeRef, transform, transition } = useSortable({
    id: agent.id,
    data: { label: agent.fullName }
  })

  return (
    <Chip
      ref={setNodeRef}
      label={agent.fullName}
      variant="outlined"
      {...attributes}
      {...listeners}
      sx={{
        cursor: 'grab',
        width: '100%',        // fill the card’s width
        whiteSpace: 'normal', // allow wrapping
        textAlign: 'center',  // center the text
        transform: CSS.Transform.toString(transform),
        transition
      }}
    />
  )
}
