import express from "express"
import ExcelJS from "exceljs"
import archiver from "archiver"
import dayjs from "dayjs"

const router = express.Router()

function requireManager(req, res, next) {
  if (!req.user || req.user.type !== "manager") return res.status(401).json({ error: "Unauthorized" })
  next()
}

async function makeWorkbook({ period, agent, entries, supervisorSig, managerSig }) {
  const wb = new ExcelJS.Workbook()
  const ws = wb.addWorksheet("Overtime")

  ws.addRow(["Overtime claim"])
  ws.addRow([`Period`, period.label])
  ws.addRow([`Employee`, agent.fullName])
  ws.addRow([])

  ws.addRow(["Date", "Day", "Start", "End", "Hours", "Rate", "Source", "Reason"])
  for (const e of entries) {
    const d = dayjs(e.workDate)
    ws.addRow([
      d.format("YYYY-MM-DD"),
      d.format("ddd"),
      dayjs(e.startAt).format("HH:mm"),
      dayjs(e.endAt).format("HH:mm"),
      Number(e.totalHours),
      Number(e.rate),
      e.source,
      e.reason || "",
    ])
  }

  ws.addRow([])
  const totalHours = entries.reduce((a, e) => a + Number(e.totalHours), 0)
  const totalPayUnits = entries.reduce((a, e) => a + Number(e.totalHours) * Number(e.rate), 0)
  ws.addRow(["Totals", "", "", "", totalHours, "", "", ""])
  ws.addRow(["Total pay units", "", "", "", totalPayUnits, "", "", ""])

  ws.addRow([])
  ws.addRow(["Supervisor signature"])
  ws.addRow([supervisorSig ? "Stored" : "Missing"])

  ws.addRow([])
  ws.addRow(["Manager signature"])
  ws.addRow([managerSig ? "Stored" : "Missing"])

  return wb
}

export default function overtimeExportRoutes(prisma) {
  router.get("/period/:periodId/export", requireManager, async (req, res) => {
    const periodId = Number(req.params.periodId)

    const period = await prisma.overtimePeriod.findUnique({ where: { id: periodId } })
    if (!period) return res.status(404).json({ error: "Period not found" })

    const approved = await prisma.overtimeEntry.findMany({
      where: { periodId, status: "MANAGER_APPROVED" },
      include: { agent: true, supervisor: true },
      orderBy: [{ agentId: "asc" }, { workDate: "asc" }, { startAt: "asc" }],
    })

    const byAgent = new Map()
    for (const e of approved) {
      if (!byAgent.has(e.agentId)) byAgent.set(e.agentId, { agent: e.agent, entries: [], supervisorId: e.supervisorId })
      byAgent.get(e.agentId).entries.push(e)
    }

    res.setHeader("Content-Type", "application/zip")
    res.setHeader("Content-Disposition", `attachment; filename="overtime_${period.key}.zip"`)

    const archive = archiver("zip", { zlib: { level: 9 } })
    archive.pipe(res)

    for (const [agentId, obj] of byAgent.entries()) {
      const supervisorSig = obj.supervisorId
        ? await prisma.storedSignature.findUnique({ where: { supervisorId: obj.supervisorId } })
        : null

      const managerSig = await prisma.storedSignature.findUnique({ where: { managerId: req.user.id } })

      const wb = await makeWorkbook({
        period,
        agent: obj.agent,
        entries: obj.entries,
        supervisorSig,
        managerSig,
      })

      const buf = await wb.xlsx.writeBuffer()
      const safeName = obj.agent.fullName.replaceAll(" ", "_")
      archive.append(Buffer.from(buf), { name: `${safeName}_${period.key}.xlsx` })
    }

    await archive.finalize()
  })

  return router
}
