// frontend/src/pages/StaffingPage.jsx
import { useEffect, useState, useMemo } from 'react'
import {
  Box, TextField, Button, Typography,
  MenuItem, Select, InputLabel, FormControl,
  Table, TableHead, TableBody, TableRow, TableCell,
  Tooltip
} from '@mui/material'
import {
  LocalizationProvider, DatePicker
} from '@mui/x-date-pickers'
import { AdapterDayjs } from '@mui/x-date-pickers/AdapterDayjs'
import dayjs from 'dayjs'
import api from '../api'
import moment from 'moment'
import Timeline from 'react-calendar-timeline'
// Note: make sure your index.html has:
// <link rel="stylesheet" href="https://unpkg.com/react-calendar-timeline/lib/Timeline.css"/>

export default function StaffingPage() {
  // state
  const [roles, setRoles]         = useState([])
  const [team, setTeam]           = useState('')
  const [startDate, setStartDate] = useState(dayjs())
  const [callAht, setCallAht]     = useState(300)
  const [ticketAht, setTicketAht] = useState(240)
  const [sl, setSL]               = useState(0.8)
  const [threshold, setThreshold] = useState(20)
  const [shrinkage, setShrinkage] = useState(0.3)
  const [weeks, setWeeks]         = useState(3)

  const [forecast, setForecast]         = useState([])
  const [blocks, setBlocks]             = useState([])
  const [bestStartHours, setBestStart]  = useState([])
  const [personSchedule, setPersonSchedule] = useState({})

  // load roles once
  useEffect(() => {
    api.get('/agents').then(res => {
      const uniq = [...new Set(res.data.map(a=>a.role))]
      setRoles(uniq)
      if (uniq.length) setTeam(uniq[0])
    })
  }, [])

  // helper to build 5-day weeks
  function getWorkDates(start, wks) {
    const dates = []
    for (let w=0; w<wks; w++) {
      const base = dayjs(start).add(w*7, 'day')
      for (let d=0; d<5; d++) {
        dates.push(base.add(d,'day').format('YYYY-MM-DD'))
      }
    }
    return dates
  }

  // build heatmap schedules & deficits
  const { scheduled, deficit, maxReq, maxSch, maxDef } = useMemo(() => {
    const sched = {}
    blocks.forEach(b => {
      getWorkDates(b.startDate, weeks).forEach(date => {
        for (let h=b.startHour; h<b.startHour+b.length; h++) {
          const key = `${date}|${h}`
          sched[key] = (sched[key]||0) + b.count
        }
      })
    })
    const def = {}
    forecast.forEach(d => {
      d.staffing.forEach(({hour,requiredAgents}) => {
        const key = `${d.date}|${hour}`
        def[key] = (sched[key]||0) - requiredAgents
      })
    })
    const rMax = Math.max(0, ...forecast.flatMap(d=>d.staffing.map(s=>s.requiredAgents)))
    const sMax = Math.max(0, ...Object.values(sched))
    const dMax = Math.max(0, ...Object.values(def).map(v=>Math.abs(v)))
    return { scheduled: sched, deficit: def, maxReq: rMax, maxSch: sMax, maxDef: dMax }
  }, [blocks, forecast, weeks])

  // 1) forecast
  const calcForecast = async () => {
    const start = startDate.format('YYYY-MM-DD')
    const end   = startDate.add(weeks,'week').subtract(1,'day').format('YYYY-MM-DD')
    const res = await api.post('/erlang/staff/bulk-range', {
      role: team,
      start, end,
      callAhtSeconds:   callAht,
      ticketAhtSeconds: ticketAht,
      serviceLevel:     sl,
      thresholdSeconds: threshold,
      shrinkage
    })
    setForecast(res.data)
    setBlocks([])
    setBestStart([])
    setPersonSchedule({})
  }

  // 2) assign rotations
  const assignToStaff = async () => {
    if (!forecast.length) return alert('Run Forecast first')
    const res = await api.post('/erlang/staff/schedule', {
      staffing:    forecast,
      weeks,
      shiftLength: 9,
      topN:        5
    })
    setBestStart(res.data.bestStartHours)
    setBlocks(res.data.solution)

    // bucket into per-employee
    let empIdx = 1
    const assignments = []
    res.data.solution.forEach(b => {
      for (let i=0; i<b.count; i++) {
        assignments.push({ employee: empIdx, ...b })
        empIdx++
      }
    })
    const schedByEmp = {}
    assignments.forEach(({employee,startDate,startHour}) => {
      getWorkDates(startDate, weeks).forEach(date => {
        schedByEmp[employee] = schedByEmp[employee]||[]
        schedByEmp[employee].push({day: date, hour: startHour})
      })
    })
    setPersonSchedule(schedByEmp)
  }

  // 3) Gantt data
  const [groups, items] = useMemo(() => {
    const gr = Object.keys(personSchedule).map(e=>({
      id: Number(e),
      title: `Emp ${e}`
    }))
    const it = []
    let id=1
    Object.entries(personSchedule).forEach(([emp,arr]) => {
      arr.forEach(({day, hour})=>{
        const start = moment(day,'YYYY-MM-DD').hour(hour)
        const end   = start.clone().add(9,'hour')
        it.push({
          id: id++,
          group: Number(emp),
          title: `${hour}:00`,
          start_time: start,
          end_time: end,
          itemProps: {'data-tooltip':`${day} @ ${hour}:00`}
        })
      })
    })
    return [gr, it]
  }, [personSchedule, weeks])

  return (
    <LocalizationProvider dateAdapter={AdapterDayjs}>
      <Box sx={{p:3}}>
        <Typography variant="h4" gutterBottom>
          Staffing Forecast & Scheduling
        </Typography>

        {/* Controls */}
        <Box sx={{display:'flex', flexWrap:'wrap', gap:2, mb:4}}>
          <FormControl sx={{minWidth:140}}>
            <InputLabel>Team</InputLabel>
            <Select value={team} onChange={e=>setTeam(e.target.value)} label="Team">
              {roles.map(r=> <MenuItem key={r} value={r}>{r}</MenuItem>)}
            </Select>
          </FormControl>

          <DatePicker
            label="Forecast Start"
            value={startDate}
            onChange={d=>d&&setStartDate(d)}
            renderInput={params=><TextField {...params} size="small"/>}
          />

          <FormControl sx={{minWidth:120}}>
            <InputLabel>Rotation (weeks)</InputLabel>
            <Select value={weeks} onChange={e=>setWeeks(+e.target.value)} label="Rotation">
              {[1,2,3,4,5].map(w=> <MenuItem key={w} value={w}>{w}</MenuItem>)}
            </Select>
          </FormControl>

          <TextField label="Call AHT (sec)"   type="number" size="small" value={callAht}    onChange={e=>setCallAht(+e.target.value)}/>
          <TextField label="Ticket AHT (sec)" type="number" size="small" value={ticketAht} onChange={e=>setTicketAht(+e.target.value)}/>
          <TextField label="Service Level %"   type="number" size="small" value={sl*100}     onChange={e=>setSL(+e.target.value/100)}/>
          <TextField label="Threshold (sec)"   type="number" size="small" value={threshold} onChange={e=>setThreshold(+e.target.value)}/>
          <TextField label="Shrinkage %"        type="number" size="small" value={shrinkage*100} onChange={e=>setShrinkage(+e.target.value/100)}/>

          <Button variant="contained" onClick={calcForecast}>Calculate Forecast</Button>
          <Button
            variant="contained"
            onClick={assignToStaff}
            disabled={!forecast.length}
            sx={{ ml:2 }}
          >
            Assign to Staff
          </Button>
        </Box>

        {/* 1) Required Agents Heatmap */}
        {forecast.length>0 && (
          <Box sx={{mb:4, overflowX:'auto'}}>
            <Typography variant="h6">Required Agents Heatmap</Typography>
            <Table size="small">
              <TableHead>
                <TableRow>
                  <TableCell>Hour</TableCell>
                  {forecast.map(d=>
                    <TableCell key={d.date}>{d.date}</TableCell>
                  )}
                </TableRow>
              </TableHead>
              <TableBody>
                {Array.from({length:24},(_,h)=>(
                  <TableRow key={h}>
                    <TableCell>{h}:00</TableCell>
                    {forecast.map(d=>{
                      const req = d.staffing.find(s=>s.hour===h)?.requiredAgents||0
                      const alpha = maxReq ? (req/maxReq)*0.8+0.2 : 0.2
                      return (
                        <Tooltip key={d.date} title={`Req: ${req}`}>
                          <TableCell sx={{backgroundColor:`rgba(33,150,243,${alpha})`}}>
                            {req}
                          </TableCell>
                        </Tooltip>
                      )
                    })}
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </Box>
        )}

        {/* 2) Scheduled Coverage Heatmap */}
        {blocks.length>0 && (
          <Box sx={{mb:4, overflowX:'auto'}}>
            <Typography variant="h6">Scheduled Coverage Heatmap</Typography>
            <Table size="small">
              <TableHead>
                <TableRow>
                  <TableCell>Hour</TableCell>
                  {forecast.map(d=>
                    <TableCell key={d.date}>{d.date}</TableCell>
                  )}
                </TableRow>
              </TableHead>
              <TableBody>
                {Array.from({length:24},(_,h)=>(
                  <TableRow key={h}>
                    <TableCell>{h}:00</TableCell>
                    {forecast.map(d=>{
                      const cov = scheduled[`${d.date}|${h}`]||0
                      const alpha = maxSch ? (cov/maxSch)*0.8+0.2 : 0.2
                      return (
                        <Tooltip key={d.date} title={`Sch: ${cov}`}>
                          <TableCell sx={{backgroundColor:`rgba(76,175,80,${alpha})`}}>
                            {cov}
                          </TableCell>
                        </Tooltip>
                      )
                    })}
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </Box>
        )}

        {/* 3) Deficit Heatmap */}
        {blocks.length>0 && (
          <Box sx={{mb:4, overflowX:'auto'}}>
            <Typography variant="h6">Under-/Over-Staffing Heatmap</Typography>
            <Table size="small">
              <TableHead>
                <TableRow>
                  <TableCell>Hour</TableCell>
                  {forecast.map(d=>
                    <TableCell key={d.date}>{d.date}</TableCell>
                  )}
                </TableRow>
              </TableHead>
              <TableBody>
                {Array.from({length:24},(_,h)=>(<
                  TableRow key={h}>
                    <TableCell>{h}:00</TableCell>
                    {forecast.map(d=>{
                      const val = deficit[`${d.date}|${h}`]||0
                      const ratio = maxDef ? (Math.abs(val)/maxDef)*0.8+0.2 : 0.2
                      const col = val<0
                        ? `rgba(244,67,54,${ratio})`
                        : `rgba(76,175,80,${ratio})`
                      return (
                        <Tooltip key={d.date} title={`Deficit: ${val}`}>
                          <TableCell sx={{backgroundColor:col}}>
                            {val}
                          </TableCell>
                        </Tooltip>
                      )
                    })}
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </Box>
        )}

        {/* 4) Assigned Shift-Block Types */}
        {blocks.length>0 && (
          <Box sx={{mb:4, overflowX:'auto'}}>
            <Typography variant="h6">Assigned Shift-Block Types</Typography>
            <Table size="small">
              <TableHead>
                <TableRow>
                  <TableCell>#</TableCell>
                  <TableCell>Start Date</TableCell>
                  <TableCell>Start Hour</TableCell>
                  <TableCell>Length (h)</TableCell>
                  <TableCell>Count</TableCell>
                </TableRow>
              </TableHead>
              <TableBody>
                {blocks.map((b,i)=>(
                  <TableRow key={i}>
                    <TableCell>{i+1}</TableCell>
                    <TableCell>{b.startDate}</TableCell>
                    <Tooltip title={`Starts at ${b.startHour}:00`}>
                      <TableCell>{b.startHour}:00</TableCell>
                    </Tooltip>
                    <TableCell>{b.length}</TableCell>
                    <TableCell>{b.count}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </Box>
        )}

        {/* 5) Staff Gantt Calendar */}
        {groups.length>0 && (
          <Box sx={{mt:4}}>
            <Typography variant="h6" gutterBottom>
              Staff Gantt (6-month view)
            </Typography>
            <Box sx={{height:500, border:'1px solid #ddd'}}>
              <Timeline
                groups={groups}
                items={items}
                defaultTimeStart={moment(startDate.format('YYYY-MM-DD'))}
                defaultTimeEnd={moment(startDate.format('YYYY-MM-DD')).add(6,'month')}
                canMove={false}
                canResize={false}
                itemTouchSendsClick={true}
                itemRenderer={({ item, style }) => (
                  <div
                    style={{
                      ...style,
                      backgroundColor: '#1976d2',
                      color: '#fff',
                      borderRadius: 4,
                      padding: '2px 4px'
                    }}
                    title={item.itemProps['data-tooltip']}
                  >
                    {item.title}
                  </div>
                )}
              />
            </Box>
          </Box>
        )}
      </Box>
    </LocalizationProvider>
  )
}
