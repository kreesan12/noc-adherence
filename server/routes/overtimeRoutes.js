import express from "express"
import dayjs from "dayjs"
import {
  ensureCurrentPeriod,
  ensurePeriodForDate,
  generateFixedOvertimeForPeriod,
  manualRateForDate,
  assertManualWithin7Days,
} from "../services/overtimeService.js"
import { hoursBetween } from "../utils/timeCalc.js"

const router = express.Router()

// Replace these with your real auth middleware
function requireSupervisor(req, res, next) {
  if (!req.user || req.user.type !== "supervisor") return res.status(401).json({ error: "Unauthorized" })
  next()
}
function requireManager(req, res, next) {
  if (!req.user || req.user.type !== "manager") return res.status(401).json({ error: "Unauthorized" })
  next()
}
function requireAgent(req, res, next) {
  if (!req.user || req.user.type !== "agent") return res.status(401).json({ error: "Unauthorized" })
  next()
}

export default function overtimeRoutes(prisma) {
  router.get("/period/current", async (req, res) => {
    const period = await ensureCurrentPeriod(prisma)
    res.json(period)
  })

  router.post("/period/ensure", requireSupervisor, async (req, res) => {
    const { date } = req.body
    const period = await ensurePeriodForDate(prisma, date || new Date())
    res.json(period)
  })

  router.post("/period/:periodId/generate-fixed", requireSupervisor, async (req, res) => {
    const periodId = Number(req.params.periodId)
    const supervisorId = req.user.id

    const out = await generateFixedOvertimeForPeriod(prisma, periodId, supervisorId)
    res.json(out)
  })

  // Staff manual capture
  router.post("/manual", requireAgent, async (req, res) => {
    const agentId = req.user.id
    const { workDate, startAt, endAt, breakStart, breakEnd, reason, notes } = req.body

    assertManualWithin7Days(workDate)

    const period = await ensurePeriodForDate(prisma, workDate)

    const holidays = await prisma.publicHoliday.findMany({
      where: { isActive: true },
      select: { date: true },
    })
    const holidaySet = new Set(holidays.map(h => dayjs(h.date).format("YYYY-MM-DD")))

    const rate = manualRateForDate(workDate, holidaySet)
    const totalHours = hoursBetween(startAt, endAt, breakStart, breakEnd)

    const entry = await prisma.overtimeEntry.create({
      data: {
        periodId: period.id,
        agentId,
        source: "MANUAL",
        status: "SUBMITTED",
        workDate: new Date(workDate),
        startAt: new Date(startAt),
        endAt: new Date(endAt),
        totalHours,
        rate,
        reason,
        notes,
        createdByAgentId: agentId,
      },
    })

    res.json(entry)
  })

  // Supervisor view: show fixed + manual for their agents in a period
  router.get("/period/:periodId/supervisor", requireSupervisor, async (req, res) => {
    const periodId = Number(req.params.periodId)
    const supervisorId = req.user.id

    const agents = await prisma.agent.findMany({
      where: { supervisorId },
      select: { id: true },
    })
    const agentIds = agents.map(a => a.id)

    const entries = await prisma.overtimeEntry.findMany({
      where: {
        periodId,
        agentId: { in: agentIds },
      },
      include: { agent: true },
      orderBy: [{ agentId: "asc" }, { workDate: "asc" }, { startAt: "asc" }],
    })

    res.json(entries)
  })

  // Supervisor edit with audit versioning and manager requirement
  router.patch("/entry/:id/supervisor-edit", requireSupervisor, async (req, res) => {
    const supervisorId = req.user.id
    const id = Number(req.params.id)

    const existing = await prisma.overtimeEntry.findUnique({ where: { id } })
    if (!existing) return res.status(404).json({ error: "Not found" })

    const before = existing
    const patch = req.body

    const updated = await prisma.overtimeEntry.update({
      where: { id },
      data: {
        ...patch,
        supervisorId,
        editedRequiresManager: true,
        status: "SUPERVISOR_APPROVED",
        supervisorApprovedAt: new Date(),
      },
    })

    await prisma.overtimeEntryVersion.create({
      data: {
        entryId: id,
        editedBy: `supervisor:${supervisorId}`,
        reason: patch.editReason || "Supervisor edit",
        before,
        after: updated,
      },
    })

    res.json(updated)
  })

  router.post("/entry/:id/supervisor-approve", requireSupervisor, async (req, res) => {
    const supervisorId = req.user.id
    const id = Number(req.params.id)

    const updated = await prisma.overtimeEntry.update({
      where: { id },
      data: {
        supervisorId,
        status: "SUPERVISOR_APPROVED",
        supervisorApprovedAt: new Date(),
      },
    })

    res.json(updated)
  })

  router.post("/entry/:id/reject", requireSupervisor, async (req, res) => {
    const id = Number(req.params.id)
    const { notes } = req.body

    const updated = await prisma.overtimeEntry.update({
      where: { id },
      data: {
        status: "REJECTED",
        notes: notes || "Rejected",
      },
    })

    res.json(updated)
  })

  // Manager approval queue
  router.get("/period/:periodId/manager", requireManager, async (req, res) => {
    const periodId = Number(req.params.periodId)

    const entries = await prisma.overtimeEntry.findMany({
      where: {
        periodId,
        status: "SUPERVISOR_APPROVED",
      },
      include: { agent: true },
      orderBy: [{ agentId: "asc" }, { workDate: "asc" }, { startAt: "asc" }],
    })

    res.json(entries)
  })

  router.post("/entry/:id/manager-approve", requireManager, async (req, res) => {
    const managerId = req.user.id
    const id = Number(req.params.id)

    const updated = await prisma.overtimeEntry.update({
      where: { id },
      data: {
        managerId,
        status: "MANAGER_APPROVED",
        managerApprovedAt: new Date(),
      },
    })

    res.json(updated)
  })

  return router
}
