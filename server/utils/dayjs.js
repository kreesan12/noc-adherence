// server/utils/dayjs.js  (backend helper)
// or   src/lib/dayjs.js  (frontend helper)
import dayjs from 'dayjs'
import utc   from 'dayjs/plugin/utc'
import tz    from 'dayjs/plugin/timezone'

dayjs.extend(utc)
dayjs.extend(tz)

export default dayjs          // optional re-export
