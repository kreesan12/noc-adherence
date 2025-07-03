// frontend/src/pages/SchedulePage.jsx
import { useEffect, useState } from 'react'
import FullCalendar             from '@fullcalendar/react'
import timeGridPlugin           from '@fullcalendar/timegrid'
import dayjs                    from 'dayjs'
import api                      from '../api'

export default function SchedulePage () {
  const [events, setEvents]   = useState([])
  const [weekStart, setStart] = useState(dayjs().startOf('week'))

  useEffect(() => {
    api.get('/schedule', {
      params: { week: weekStart.format('YYYY-MM-DD') }
    })
    .then(res => {
      // group identical shifts on the same day
      const groups = {}
      res.data.forEach(s => {
        const date = dayjs(s.startAt).format('YYYY-MM-DD')
        const start = s.startAt
        const end   = s.endAt
        const key   = `${date}|${start}|${end}`
        if (!groups[key]) {
          groups[key] = { start, end, names: [], count: 0 }
        }
        groups[key].count++
        groups[key].names.push(s.agent.fullName)
      })
      // turn into FullCalendar events
      const evts = Object.values(groups).map(g => ({
        title: String(g.count),
        start: g.start,
        end:   g.end,
        extendedProps: { names: g.names }
      }))
      setEvents(evts)
    })
    .catch(console.error)
  }, [weekStart])

  return (
    <FullCalendar
      plugins={[timeGridPlugin]}
      initialView="timeGridWeek"
      datesSet={arg => setStart(dayjs(arg.start))}
      events={events}
      height="auto"
      eventDidMount={info => {
        // native tooltip on hover
        info.el.setAttribute(
          'title',
          info.event.extendedProps.names.join('\n')
        )
      }}
    />
  )
}
