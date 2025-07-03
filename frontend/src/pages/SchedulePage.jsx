// frontend/src/pages/SchedulePage.jsx
import { useEffect, useState } from 'react'
import FullCalendar             from '@fullcalendar/react'
import timeGridPlugin           from '@fullcalendar/timegrid'
import dayjs                    from 'dayjs'
import api                      from '../api'

export default function SchedulePage () {
  const [events, setEvents]   = useState([])
  const [weekStart, setStart] = useState(dayjs().startOf('week'))

  // (re)load whenever the visible week changes
  useEffect(() => {
    api.get('/schedule', {
      params: { date: weekStart.format('YYYY-MM-DD') }
    })
    .then(res => {
      const rows = res.data.map(s => ({
        title : s.agent.fullName,
        start : s.startAt,
        end   : s.endAt,
        color : s.attendance?.status === 'late'    ? '#ff1744' :
                s.attendance?.status === 'present' ? '#00e676' : '#2979ff'
      }))
      setEvents(rows)
    })
    .catch(err => console.error(err))
  }, [weekStart])

  return (
    <FullCalendar
      plugins={[timeGridPlugin]}
      initialView="timeGridWeek"
      datesSet={arg => setStart(dayjs(arg.start))}
      events={events}
      height="auto"
    />
  )
}
