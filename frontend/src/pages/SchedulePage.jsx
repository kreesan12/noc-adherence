import FullCalendar from '@fullcalendar/react'
import timeGridPlugin from '@fullcalendar/timegrid'
import { useEffect, useState } from 'react'
import dayjs from 'dayjs'
import api from '../api'

export default function SchedulePage() {
  const [events, setEvents] = useState([])
  useEffect(()=>{
    const weekStart = dayjs().startOf('week').format('YYYY-MM-DD')
    api.get(`/schedule?week=${weekStart}`).then(r=>{
      setEvents(r.data.map(s=>({
        title : s.agent.fullName,
        start : s.startAt,
        end   : s.endAt,
        color : s.attendance?.status==='late' ? '#ff1744' :
                s.attendance?.status==='present' ? '#00e676' : '#2979ff'
      })))
    })
  },[])
  return (
    <FullCalendar plugins={[timeGridPlugin]}
      initialView="timeGridWeek"
      events={events}
      height="auto"/>
  )
}
