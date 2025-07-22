/* frontend/src/components/AssignTab.jsx */
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
import { Card, CardContent, Chip, Stack, Typography } from '@mui/material'

export default function AssignTab ({ agents, supers, refreshAgents }) {
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

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 5 } })
  )

  const handleDragEnd = async ({ active, over }) => {
    if (!over) return

    const fromKey = active.data.current.sortable.containerId
    const toKey =
      over.data.current?.sortable?.containerId  // drop on item
      ?? over.id                                // drop on empty column

    if (fromKey === toKey) return

    // optimistic UI
    setLists(prev => {
      const from = [...prev[fromKey]]
      const to   = [...prev[toKey]]
      const idx  = from.findIndex(a => a.id === active.id)
      to.push(from.splice(idx, 1)[0])
      return { ...prev, [fromKey]: from, [toKey]: to }
    })

    // persist
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
      <Stack direction="row" spacing={2} flexWrap="wrap">
        <SupColumn id="unassigned" title="Unassigned" agents={lists.unassigned} />
        {supers.map(s => (
          <SupColumn
            key={s.id}
            id={String(s.id)}
            title={s.fullName}
            agents={lists[String(s.id)]}
          />
        ))}
      </Stack>

      <DragOverlay>
        {({ active }) =>
          active ? <Chip label={active.data.current.label} /> : null}
      </DragOverlay>
    </DndContext>
  )
}

/* ─────────── Column + Chip helpers ───────────────── */
function SupColumn ({ id, title, agents }) {
  // register the droppable container and get its ref setter
  const { setNodeRef } = useDroppable({ id })

  return (
    <Card ref={setNodeRef} sx={{ minWidth: 220, mb: 2 }}>
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
