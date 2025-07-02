import { Router } from 'express'
export default prisma => {
  const r = Router()

  r.post('/forecast', async (req, res) => {
    await prisma.volumeForecast.createMany({ data:req.body })
    res.json({ ok:true })
  })

  r.patch('/actual', async (req, res) => {
    await prisma.volumeActual.createMany({ data:req.body })
    res.json({ ok:true })
  })

  return r
}
