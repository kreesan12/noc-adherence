import jwt from 'jsonwebtoken'
import { getJwtSecret } from '../lib/jwtSecret.js'

export default requiredRole => (req, res, next) => {
  const token = req.headers.authorization?.split(' ')[1]
  if (!token) return res.sendStatus(401)

  try {
    const user = jwt.verify(token, getJwtSecret())
    if (
      requiredRole &&
      user.role !== 'admin' &&
      user.role !== 'manager' &&
      user.role !== requiredRole
    ) {
      return res.sendStatus(403)
    }

    req.user = user
    next()
  } catch {
    res.sendStatus(403)
  }
}
