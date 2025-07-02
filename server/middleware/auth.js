import jwt from 'jsonwebtoken'
export default requiredRole => (req, res, next) => {
  const token = req.headers.authorization?.split(' ')[1]
  if (!token) return res.sendStatus(401)
  try {
    const user = jwt.verify(token, process.env.JWT_SECRET)
    if (requiredRole &&
        user.role !== 'admin' &&
        user.role !== requiredRole) return res.sendStatus(403)
    req.user = user
    next()
  } catch { res.sendStatus(403) }
}
