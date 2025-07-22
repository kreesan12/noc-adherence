/* frontend/src/components/AssignTab.jsx */
import { useState } from 'react'
import {
  DndContext, PointerSensor, useSensor, useSensors, closestCenter,
  DragOverlay, useDroppable
} from '@dnd-kit/core'
import {
  SortableContext, useSortable, verticalListSortingStrategy
} from '@dnd-kit/sortable'
import { CSS } from '@dnd-kit/utilities'
import api from '../api'
import {
  Card, CardContent, Chip, Stack, Typography
} from '@mui/material'

export default function AssignTab ({ agents, supers, refreshAgents }) {
  /* ---------- build list-per-supervisor ---------- */
  const [lists, setLists] = useState(() => {
    const bySup = Object.fromEntries(
      supers.map(s => [String(s.id), []])      // keys are strings
    )
    const unassigned = []
    agents.forEach(a => {
      if (a.supervisorId) bySup[String(a.supervisorId)]?.push(a)
      else unassigned.push(a)
    })
    return { unassigned, ...bySup }
  })

  /* ---------- dnd sensors ---------- */
  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 5 } })
  )

  /* ---------- drag finished ---------- */
  const handleDragEnd = async ({ active, over }) => {
    if (!over) return

    const fromKey = active.data.current.sortable.containerId
    const toKey =
      over.data.current?.sortable?.containerId    // when over an item
      ?? over.id                                  // when over empty column

    if (fromKey === toKey) return            // no actual move

    /* optimistic UI move */
    setLists(prev => {
      const from = [...prev[fromKey]]
      const to   = [...prev[toKey]]
      const idx  = from.findIndex(a => a.id === active.id)
      to.push(from.splice(idx, 1)[0])
      return { ...prev, [fromKey]: from, [toKey]: to }
    })

    /* persist & refresh */
    const supervisorId = toKey === 'unassigned' ? null : Number(toKey)
    await api.patch(`/agents/${active.id}/supervisor`, { supervisorId })
    await refreshAgents()
  }

  /* ---------- render ---------- */
  return (
    <DndContext
      sensors={sensors}
      collisionDetection={closestCenter}
      onDragEnd={handleDragEnd}
    >
      <Stack direction="row" spacing={2} flexWrap="wrap">
        {/* unassigned column */}
        <SupColumn id="unassigned" title="Unassigned"
                   agents={lists.unassigned} />

        {/* one column per supervisor */}
        {supers.map(s => (
          <SupColumn key={s.id} id={String(s.id)}
                     title={s.fullName}
                     agents={lists[String(s.id)]} />
        ))}
      </Stack>

      {/* chip follows cursor */}
      <DragOverlay>
        {({ active }) =>
          active ? <Chip label={active.data.current.label} /> : null}
      </DragOverlay>
    </DndContext>
  )
}

/* ---------- column & chip helpers ---------- */
function SupColumn ({ id, title, agents }) {
  /* make whole column a droppable target (even when empty) */
  useDroppable({ id })

  return (
    <Card sx={{ minWidth: 220, mb: 2 }}>
      <CardContent>
        <Typography variant="subtitle1" gutterBottom>{title}</Typography>
        <SortableContext id={id} items={agents}
                         strategy={verticalListSortingStrategy}>
          <Stack spacing={1}>
            {agents.map(a => <AgentChip key={a.id} agent={a} />)}
          </Stack>
        </SortableContext>
      </CardContent>
    </Card>
  )
}

function AgentChip ({ agent }) {
  const {
    attributes, listeners, setNodeRef, transform, transition
  } = useSortable({
    id: agent.id,
    data: { label: agent.fullName }
  })

  const style = {
    transform: CSS.Transform.toString(transform),
    transition
  }

  return (
    <Chip
      ref={setNodeRef}
      label={agent.fullName}
      variant="outlined"
      {...attributes}
      {...listeners}
      sx={{ cursor: 'grab', ...style }}
    />
  )
}
