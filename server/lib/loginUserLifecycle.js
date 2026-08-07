export async function detachSupervisorReferences(tx, supervisorId) {
  await tx.agent.updateMany({
    where: { supervisorId },
    data: { supervisorId: null }
  })

  await tx.attendanceLog.updateMany({
    where: { supervisorId },
    data: { supervisorId: null }
  })

  await tx.auditLog.updateMany({
    where: { supervisorId },
    data: { supervisorId: null }
  })

  await tx.overtimeEntry.updateMany({
    where: { supervisorId },
    data: { supervisorId: null }
  })

  await tx.storedSignature.deleteMany({
    where: { supervisorId }
  })
}

export async function detachManagerReferences(tx, managerId) {
  await tx.overtimeEntry.updateMany({
    where: { managerId },
    data: { managerId: null }
  })

  await tx.storedSignature.deleteMany({
    where: { managerId }
  })
}

export async function migrateSupervisorSignatureToManager(tx, supervisorId, managerId) {
  const signature = await tx.storedSignature.findUnique({
    where: { supervisorId }
  })

  if (!signature?.imageDataUrl) return

  await tx.storedSignature.upsert({
    where: { managerId },
    update: {
      role: 'manager',
      imageDataUrl: signature.imageDataUrl
    },
    create: {
      role: 'manager',
      managerId,
      imageDataUrl: signature.imageDataUrl
    }
  })
}

export async function migrateManagerSignatureToSupervisor(tx, managerId, supervisorId) {
  const signature = await tx.storedSignature.findUnique({
    where: { managerId }
  })

  if (!signature?.imageDataUrl) return

  await tx.storedSignature.upsert({
    where: { supervisorId },
    update: {
      role: 'supervisor',
      imageDataUrl: signature.imageDataUrl
    },
    create: {
      role: 'supervisor',
      supervisorId,
      imageDataUrl: signature.imageDataUrl
    }
  })
}
