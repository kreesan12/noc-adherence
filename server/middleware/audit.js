export default prisma => (req, res, next) => {
          res.audit = async (action, table, recordId, delta) => {
            await prisma.auditLog.create({
              data: {
                supervisorId: req.user.id,
                action,
                table,
                recordId,
                delta,
              }
            })
          }
}
