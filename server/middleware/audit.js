export default prisma => (req, res, next) => {
  res.audit = async (action, table, recordId, delta={}) =>
    prisma.auditLog.create({
      data:{ actorId:req.user?.id, action, table, recordId, delta }
    })
  next()
}
