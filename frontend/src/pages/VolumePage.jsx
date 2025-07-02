import { useEffect, useState } from 'react'
import { BarChart, Bar, XAxis, YAxis, Tooltip, Legend, ResponsiveContainer } from 'recharts'
import api from '../api'
import dayjs from 'dayjs'

export default function VolumePage() {
  const [data,setData] = useState([])
  const date = dayjs().format('YYYY-MM-DD')

  useEffect(()=>{
    api.get(`/reports/staffing?date=${date}`).then(r=>setData(r.data))
  },[date])

  return (
    <ResponsiveContainer width="100%" height={400}>
      <BarChart data={data}>
        <XAxis dataKey="hour"/>
        <YAxis/>
        <Tooltip/>
        <Legend/>
        <Bar dataKey="forecastCalls" name="Forecast Calls" stackId="a"/>
        <Bar dataKey="actualCalls"   name="Actual Calls"   stackId="a"/>
        <Bar dataKey="staffedHeads"  name="Heads on Shift" fill="#00e676"/>
      </BarChart>
    </ResponsiveContainer>
  )
}
