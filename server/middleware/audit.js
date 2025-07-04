// server/middleware/audit.js
export default prisma => (req, res, next) => {
  // attach a fire-and-forget audit helper
  res.audit = async (action, table, recordId, delta) => {
    try {
      await prisma.auditLog.create({
        data: {
          supervisorId: req.user.id,
          action,
          table,
          recordId,
          delta,
        }
      });
    } catch (err) {
      console.error('❌ audit failed', err);
    }
  };

  // **don’t forget this** or your routes will never run
  next();
};
