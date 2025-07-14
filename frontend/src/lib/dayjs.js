// server/utils/dayjs.js      ← back-end
// or src/lib/dayjs.js        ← front-end (whichever you created)

import utc from 'dayjs/plugin/utc.js'
import tz  from 'dayjs/plugin/timezone.js'

import dayjs from 'dayjs'

dayjs.extend(utc)
dayjs.extend(tz)

export default dayjs        // optional re-export
