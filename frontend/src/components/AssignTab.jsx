/* Drag-and-drop supervisor assignment tab
   --------------------------------------------------------------- */
import { useState } from 'react'
import {
  DndContext, closestCenter,
  PointerSensor, useSensor, useSensors,
  DragOverlay
} from '@dnd-kit/core'
import {
  SortableContext, useSortable,
  verticalListSortingStrategy
} from '@dnd-kit/sortable'
import { CSS } from '@dnd-kit/utilities'
import api from '../api'

import {
  Card, CardContent, Chip, Stack, Typography
} from '@mui/material'

export default function AssignTab ({ agents, supers, refreshAgents }) {
  /* ─────────── build list-per-supervisor once ─────────── */
  const [lists, setLists] = useState(() => {
    const bySup = Object.fromEntries(supers.map(s => [s.id, []]))
    const unassigned = []
    agents.forEach(a => {
      if (a.supervisorId) bySup[a.supervisorId]?.push(a)
      else unassigned.push(a)
    })
    return { unassigned, ...bySup }   // key = 'unassigned' or supervisorId
  })

  /* ─────────── DnD sensors & handlers ─────────────────── */
  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint:{ distance:5 } })
  )

  const handleDragEnd = async ({ active, over }) => {
    if (!over) return

    const fromKey = active.data.current.sortable.containerId
    const toKey   = over.data.current.sortable.containerId
    if (fromKey === toKey) return

    /* 1️⃣ optimistic UI */
    setLists(prev => {
      const from  = [...prev[fromKey]]
      const to    = [...prev[toKey]]
      const idx   = from.findIndex(a => a.id === active.id)
      to.push(from.splice(idx, 1)[0])
      return { ...prev, [fromKey]: from, [toKey]: to }
    })

    /* 2️⃣ persist */
    const supervisorId = toKey === 'unassigned' ? null : Number(toKey)
    await api.patch(`/agents/${active.id}/supervisor`, { supervisorId })
    await refreshAgents()
  }

  /* ─────────── render ─────────────────────────────────── */
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
                     title={s.fullName} agents={lists[s.id]} />
        ))}
      </Stack>

      {/* chip follows the cursor while dragging */}
      <DragOverlay dropAnimation={null}>
        {({ active }) =>
          active ? <Chip label={active.data.current.label} /> : null}
      </DragOverlay>
    </DndContext>
  )
}

/* ───── helper column & chip components ────────────────── */
function SupColumn ({ id, title, agents }) {
  return (
    <Card sx={{ minWidth:220, mb:2 }}>
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
      sx={{ cursor:'grab', ...style }}
    />
  )
}
