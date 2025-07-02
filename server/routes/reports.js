import { Router } from 'express'
import dayjs from 'dayjs'

export default prisma => {
  const r = Router()

  // staffing / occupancy report
  r.get('/staffing', async (req,res)=>{
    const date = dayjs(req.query.date)
    const start = date.startOf('day').toDate()
    const end   = date.endOf('day').toDate()

    // get heads per hour
    const shifts = await prisma.shift.findMany({
      where:{ shiftDate:{ equals: start }},
      include:{ attendance:true }
    })
    const heads = Array.from({length:24}, (_,h)=>(
      shifts.filter(s=>{
        const st = dayjs(s.startAt).hour(), en = dayjs(s.endAt).hour()
        return h>=st && h<=en && s.attendance?.status!=='no_show'
      }).length))

    // volumes
    const fc = await prisma.volumeForecast.findMany()
    const ac = await prisma.volumeActual.findMany({
      where:{ eventTime:{ gte:start, lte:end }}
    })
    const data = Array.from({length:24}, (_,h)=>({
      hour:h,
      forecastCalls: fc.find(f=>f.hour===h)?.expectedCalls ?? 0,
      actualCalls  : ac.find(a=>dayjs(a.eventTime).hour()===h)?.calls ?? 0,
      staffedHeads : heads[h]
    }))
    res.json(data)
  })

  // audit feed
  r.get('/audit', async (req,res)=>{
    const since = new Date(req.query.since || Date.now()-86400000)
    const log = await prisma.auditLog.findMany({
      where:{ ts:{ gte:since } }, orderBy:{ ts:'desc' }
    })
    res.json(log)
  })

  return r
}
