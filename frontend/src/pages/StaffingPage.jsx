// frontend/src/pages/StaffingPage.jsx
import { useEffect, useMemo, useState } from 'react';
import {
  Box, TextField, Button, Typography,
  MenuItem, Select, InputLabel, FormControl, Switch,
  Table, TableHead, TableBody, TableRow, TableCell,
  Tooltip, FormControlLabel
} from '@mui/material';
import {
  LocalizationProvider, DatePicker
} from '@mui/x-date-pickers';
import { AdapterDayjs } from '@mui/x-date-pickers/AdapterDayjs';
import dayjs from 'dayjs';
import isSameOrBefore from 'dayjs/plugin/isSameOrBefore';
dayjs.extend(isSameOrBefore);

import * as XLSX from 'xlsx';
import api from '../api';

/* components that already live in /src/components ---------- */
import RequiredHeatmap  from '../components/RequiredHeatmap';
import CoverageGrid      from '../components/CoverageGrid';
import ShiftBlockTable   from '../components/ShiftBlockTable';   // ← if you had one
/* --------------------------------------------------------- */

export default function StaffingPage() {
  /* ──────────────────────────────────────────────────────────
     1.  Constants
  ────────────────────────────────────────────────────────── */
  const HORIZON_MONTHS = 6;
  const SHIFT_LENGTH   = 9;
  const MAX_ITERS      = 50;          // binary-search iterations

  /* ──────────────────────────────────────────────────────────
     2.  React state
  ────────────────────────────────────────────────────────── */
  const [roles, setRoles]               = useState([]);
  const [team,  setTeam]                = useState('');
  const [startDate, setStartDate]       = useState(dayjs());
  const [callAht, setCallAht]           = useState(300);
  const [ticketAht, setTicketAht]       = useState(240);
  const [sl,   setSL]                   = useState(0.8);
  const [threshold, setThreshold]       = useState(20);
  const [shrinkage, setShrinkage]       = useState(0.3);
  const [weeks, setWeeks]               = useState(3);

  const [forecast, setForecast]             = useState([]);
  const [blocks, setBlocks]                 = useState([]);
  const [bestStartHours, setBestStart]      = useState([]);
  const [personSchedule, setPersonSchedule] = useState({});
  const [useFixedStaff, setUseFixedStaff]   = useState(false);
  const [fixedStaff, setFixedStaff]         = useState(0);

  /* ──────────────────────────────────────────────────────────
     3.  Load unique team (role) list once
  ────────────────────────────────────────────────────────── */
  useEffect(() => {
    api.get('/agents')
      .then(res => {
        const uniq = [...new Set(res.data.map(a => a.role))];
        setRoles(uniq);
        if (uniq.length) setTeam(uniq[0]);
      })
      .catch(console.error);
  }, []);

  /* ──────────────────────────────────────────────────────────
     4.  Helpers
  ────────────────────────────────────────────────────────── */
  /** return an array of YYYY-MM-DD strings for N weeks × Mon-Fri */
  function getWorkDates(start, wCount) {
    const out = [];
    for (let w = 0; w < wCount; w++) {
      const base = dayjs(start).add(w * 7, 'day');
      for (let d = 0; d < 5; d++) {
        out.push(base.add(d, 'day').format('YYYY-MM-DD'));
      }
    }
    return out;
  }

  /** deterministic round-robin allocation of shift blocks */
  function buildSchedule(blocks, reqMap) {
    const schedByEmp = {};
    const totalEmp   = blocks.reduce((s, b) => s + b.count, 0);
    const queue      = Array.from({ length: totalEmp }, (_, i) => i + 1);
    queue.forEach(id => (schedByEmp[id] = []));

    const coverMap = {};   // heads working (excluding lunch)
    const lunchMap = {};   // heads currently at lunch

    const horizonEnd = dayjs(startDate).add(HORIZON_MONTHS, 'month');
    const cycles     = Math.ceil(
      (horizonEnd.diff(startDate, 'day') + 1) / (weeks * 7)
    );

    const sorted = [...blocks].sort(
      (a, b) => a.patternIndex - b.patternIndex || a.startHour - b.startHour
    );

    for (let ci = 0; ci < cycles; ci++) {
      let offset = 0;
      sorted.forEach(block => {
        const group = queue.slice(offset, offset + block.count);

        group.forEach(empId => {
          getWorkDates(block.startDate, weeks).forEach(dtStr => {
            const d = dayjs(dtStr).add(ci * weeks * 7, 'day');
            if (d.isAfter(horizonEnd, 'day')) return;
            const day = d.format('YYYY-MM-DD');

            /* — choose a lunch hour inside the shift — */
            const candidates = [];
            for (let off = 2; off <= 5; off++) {
              const h          = block.startHour + off;
              if (h >= block.startHour + SHIFT_LENGTH) break;
              const k          = `${day}|${h}`;
              const onDuty     = coverMap[k]  ?? 0;
              const lunches    = lunchMap[k]  ?? 0;
              const required   = reqMap[k]    ?? 0;
              const projected  = onDuty - lunches - 1;
              const surplus    = projected - required;
              if (surplus >= 0) {
                candidates.push({ h, surplus, lunches });
              }
            }

            const breakHour = candidates.length
              ? candidates.sort((a, b) =>
                  a.surplus - b.surplus ||
                  a.lunches - b.lunches ||
                  a.h - b.h
                )[0].h
              : (
                  block.breakOffset != null
                    ? block.startHour + block.breakOffset
                    : block.startHour + Math.floor(block.length / 2)
                );

            /* — record shift for employee — */
            schedByEmp[empId].push({ day, hour: block.startHour, breakHour });

            /* — update coverage counters — */
            for (let h = block.startHour; h < block.startHour + SHIFT_LENGTH; h++) {
              const k = `${day}|${h}`;
              coverMap[k] = (coverMap[k] ?? 0) + 1;
            }
            const lk = `${day}|${breakHour}`;
            lunchMap[lk] = (lunchMap[lk] ?? 0) + 1;
          });
        });

        offset += block.count;
      });

      /* rotate queue for fair distribution */
      queue.unshift(queue.pop());
    }

    return schedByEmp;
  }

  /* ──────────────────────────────────────────────────────────
     5.  Derived data (req/scheduled/deficit maps, maxima)
  ────────────────────────────────────────────────────────── */
  const {
    reqMap,             // full required-headcount map YYYY-MM-DD|H → #
    scheduled,          // actual heads scheduled (excl. lunch)
    deficit,            // scheduled − required   (negative = understaff)
    maxReq, maxSch, maxDef
  } = useMemo(() => {
    /* required map ----------------------------------------- */
    const req = {};
    forecast.forEach(d =>
      d.staffing.forEach(({ hour, requiredAgents }) => {
        req[`${d.date}|${hour}`] = requiredAgents;
      })
    );

    /* scheduled map ---------------------------------------- */
    const sch = {};
    Object.values(personSchedule).forEach(arr =>
      arr.forEach(({ day, hour, breakHour }) => {
        for (let h = hour; h < hour + SHIFT_LENGTH; h++) {
          if (h === breakHour) continue;           // skip lunch
          const k = `${day}|${h}`;
          sch[k]  = (sch[k] ?? 0) + 1;
        }
      })
    );

    /* deficit map ------------------------------------------ */
    const def = {};
    new Set([...Object.keys(req), ...Object.keys(sch)]).forEach(k => {
      def[k] = (sch[k] ?? 0) - (req[k] ?? 0);
    });

    const allReq = Object.values(req);
    const allSch = Object.values(sch);
    const allDef = Object.values(def).map(v => Math.abs(v));

    return {
      reqMap    : req,
      scheduled : sch,
      deficit   : def,
      maxReq    : allReq.length ? Math.max(...allReq) : 0,
      maxSch    : allSch.length ? Math.max(...allSch) : 0,
      maxDef    : allDef.length ? Math.max(...allDef) : 0
    };
  }, [personSchedule, forecast]);

  const anyShort = def => Object.values(def).some(v => v < 0);

  /* ──────────────────────────────────────────────────────────
     6.  API actions
  ────────────────────────────────────────────────────────── */
  /* (a) build 6-month FORECAST ------------------------------ */
  const calcForecast = async () => {
    const start = startDate.format('YYYY-MM-DD');
    const end   = startDate.add(HORIZON_MONTHS, 'month')
                           .subtract(1, 'day')
                           .format('YYYY-MM-DD');

    const { data } = await api.post('/erlang/staff/bulk-range', {
      role: team,
      start, end,
      callAhtSeconds   : callAht,
      ticketAhtSeconds : ticketAht,
      serviceLevel     : sl,
      thresholdSeconds : threshold,
      shrinkage
    });

    setForecast(data);
    setBlocks([]);
    setBestStart([]);
    setPersonSchedule({});
  };

  /* (b) assign shift blocks & build concrete schedule ------- */
  const assignToStaff = async () => {
    if (!forecast.length) {
      alert('Run Forecast first');
      return;
    }

    /* build quick lookup map for constraints */
    const req = {};
    forecast.forEach(d =>
      d.staffing.forEach(({ hour, requiredAgents }) => {
        req[`${d.date}|${hour}`] = requiredAgents;
      })
    );

    /* internal solver helper */
    const solve = async cap => {
      const body = {
        staffing    : forecast,
        weeks,
        shiftLength : SHIFT_LENGTH,
        topN        : 5
      };
      if (cap > 0) body.maxStaff = cap;

      const { data } = await api.post('/erlang/staff/schedule', body);
      const sched   = buildSchedule(data.solution, req);

      /* derive deficit for this solution */
      const cov = {};
      Object.values(sched).forEach(arr =>
        arr.forEach(({ day, hour, breakHour }) => {
          for (let h = hour; h < hour + SHIFT_LENGTH; h++) {
            if (h === breakHour) continue;
            const k  = `${day}|${h}`;
            cov[k]   = (cov[k] ?? 0) + 1;
          }
        })
      );
      const def = {};
      Object.keys(req).forEach(k => { def[k] = (cov[k] ?? 0) - req[k]; });

      return {
        solution  : data.solution,
        bestStart : data.bestStartHours,
        schedule  : sched,
        deficit   : def,
        headCnt   : data.solution.reduce((s, b) => s + b.count, 0)
      };
    };

    /* — fixed-cap branch ----------------------------------- */
    if (useFixedStaff && fixedStaff > 0) {
      const plan = await solve(fixedStaff);
      setBlocks(plan.solution);
      setBestStart(plan.bestStart);
      setPersonSchedule(plan.schedule);
      return;
    }

    /* — adaptive binary search for minimal head-count ------- */
    let lo = 0, hi = 1, plan = await solve(hi);
    while (anyShort(plan.deficit)) {
      hi *= 2;
      if (hi > 10000) break;      // sanity guard
      plan = await solve(hi);
    }
    let best = plan;
    for (let i = 0; i < MAX_ITERS && hi - lo > 1; i++) {
      const mid = Math.floor((lo + hi) / 2);
      const cur = await solve(mid);
      if (anyShort(cur.deficit)) lo = mid;
      else { hi = mid; best = cur; }
    }

    setBlocks(best.solution);
    setBestStart(best.bestStart);
    setPersonSchedule(best.schedule);
    setFixedStaff(best.headCnt);   // ready for “fixed” toggle next time
  };

  /* (c) export employee schedule to Excel ------------------- */
  const exportExcel = () => {
    const rows = [];
    Object.entries(personSchedule).forEach(([emp, arr]) =>
      arr.forEach(({ day, hour, breakHour }) => {
        rows.push({ Employee: emp, Date: day, StartHour: `${hour}:00`,  Type: 'Shift'  });
        rows.push({ Employee: emp, Date: day, StartHour: `${breakHour}:00`, Type: 'Lunch' });
      })
    );

    const ws = XLSX.utils.json_to_sheet(rows);
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, 'Schedule');
    XLSX.writeFile(wb, 'staff-calendar.xlsx');
  };

  /* (d) write shifts back to live agents -------------------- */
  const buildAllocationPayload = () => {
    const rows = [];
    Object.values(personSchedule).forEach(arr =>
      arr.forEach(r => rows.push({
        day: r.day, hour: r.hour, breakHour: r.breakHour
      }))
    );
    return rows;
  };

  const allocateToAgents = async () => {
    if (!Object.keys(personSchedule).length) return;
    const ok = window.confirm(
      'Allocate these shifts to live agents?\n' +
      '(Existing shifts in the same window will be cleared first.)'
    );
    if (!ok) return;

    try {
      await api.post('/shifts/allocate', {
        role: team,
        schedule: buildAllocationPayload(),
        clearExisting: true
      });
      alert('Shifts allocated!');
    } catch (err) {
      console.error(err);
      alert('Allocation failed – see console.');
    }
  };

  /* ──────────────────────────────────────────────────────────
     7.  Render
  ────────────────────────────────────────────────────────── */
  return (
    <LocalizationProvider dateAdapter={AdapterDayjs}>
      <Box sx={{ p: 3 }}>
        <Typography variant="h4" gutterBottom>
          Staffing Forecast &amp; Scheduling
        </Typography>

        {/* ──────── toolbar ──────── */}
        <Box sx={{ display: 'flex', gap: 2, flexWrap: 'wrap', mb: 4 }}>
          {/* team picker */}
          <FormControl sx={{ minWidth: 140 }}>
            <InputLabel>Team</InputLabel>
            <Select value={team} label="Team"
                    onChange={e => setTeam(e.target.value)}>
              {roles.map(r => (
                <MenuItem key={r} value={r}>{r}</MenuItem>
              ))}
            </Select>
          </FormControl>

          {/* forecast start date */}
          <DatePicker
            label="Forecast Start"
            value={startDate}
            onChange={d => d && setStartDate(d)}
            renderInput={p => <TextField {...p} size="small" />}
          />

          {/* rotation length */}
          <FormControl sx={{ minWidth: 120 }}>
            <InputLabel>Rotation (weeks)</InputLabel>
            <Select value={weeks} label="Rotation"
                    onChange={e => setWeeks(+e.target.value)}>
              {[1, 2, 3, 4, 5].map(w => (
                <MenuItem key={w} value={w}>{w}</MenuItem>
              ))}
            </Select>
          </FormControl>

          {/* numeric parameters */}
          <TextField label="Call AHT (sec)"   type="number" size="small"
                     value={callAht}   onChange={e => setCallAht(+e.target.value)} />
          <TextField label="Ticket AHT (sec)" type="number" size="small"
                     value={ticketAht} onChange={e => setTicketAht(+e.target.value)} />
          <TextField label="Service Level %"  type="number" size="small"
                     value={sl * 100}  onChange={e => setSL(+e.target.value / 100)} />
          <TextField label="Threshold (sec)"  type="number" size="small"
                     value={threshold} onChange={e => setThreshold(+e.target.value)} />
          <TextField label="Shrinkage %"      type="number" size="small"
                     value={shrinkage * 100}
                     onChange={e => setShrinkage(+e.target.value / 100)} />

          {/* main actions */}
          <Button variant="contained" onClick={calcForecast}>
            Calculate Forecast
          </Button>
          <Button variant="contained" sx={{ ml: 1 }}
                  disabled={!forecast.length}
                  onClick={assignToStaff}>
            Assign to Staff
          </Button>
          <Button variant="contained" color="secondary" sx={{ ml: 1 }}
                  disabled={!Object.keys(personSchedule).length}
                  onClick={allocateToAgents}>
            Allocate to Agents
          </Button>

          {/* fixed-cap switch */}
          <FormControlLabel sx={{ ml: 1 }}
            control={
              <Switch checked={useFixedStaff}
                      onChange={e => setUseFixedStaff(e.target.checked)} />
            }
            label="Use Fixed Staff?"
          />
          {useFixedStaff && (
            <TextField label="Staff Cap" type="number" size="small"
                       sx={{ width: 100 }}
                       value={fixedStaff}
                       onChange={e => setFixedStaff(+e.target.value)} />
          )}
        </Box>
        {/* ───────── end toolbar ───────── */}

        {/* ───────── visualisations ───────── */}
        {forecast.length > 0 && (
          <>
            <Typography variant="h6" gutterBottom>
              Required Agents (per hour)
            </Typography>
            <RequiredHeatmap
              data={forecast}
              valueKey="requiredAgents"   // new API field name
            />
          </>
        )}

        {Object.keys(personSchedule).length > 0 && (
          <>
            <Typography variant="h6" sx={{ mt: 4 }} gutterBottom>
              Coverage vs Requirement
            </Typography>
            <CoverageGrid
              reqMap={reqMap}
              scheduled={scheduled}
              deficit={deficit}
              maxReq={maxReq}
              maxSch={maxSch}
              maxDef={maxDef}
            />

            <Typography variant="h6" sx={{ mt: 4 }} gutterBottom>
              Shift Blocks (solution)
            </Typography>
            <ShiftBlockTable
              blocks={blocks}
              bestStartHours={bestStartHours}
            />

            <Box sx={{ mt: 2 }}>
              <Button variant="outlined" onClick={exportExcel}>
                Export Schedule to Excel
              </Button>
            </Box>

            <Typography variant="h6" sx={{ mt: 4 }} gutterBottom>
              Per-Person Calendar View
            </Typography>
            <CalendarView scheduleByEmp={personSchedule} />
          </>
        )}
        {/* ───────── end visualisations ───────── */}
      </Box>
    </LocalizationProvider>
  );
}

/* ────────────────────────────────────────────────────────────
   8.  ✦   CalendarView (inline component)
─────────────────────────────────────────────────────────── */
function CalendarView({ scheduleByEmp }) {
  const allDates = [...new Set(
    Object.values(scheduleByEmp).flatMap(a => a.map(e => e.day))
  )].sort();

  return (
    <Box sx={{ overflowX: 'auto', border: '1px solid #ddd' }}>
      <Table size="small">
        <TableHead>
          <TableRow>
            <TableCell>Employee</TableCell>
            {allDates.map(d => (
              <TableCell key={d}
                         sx={{ minWidth: 80, textAlign: 'center' }}>
                {dayjs(d).format('MM/DD')}
              </TableCell>
            ))}
          </TableRow>
        </TableHead>
        <TableBody>
          {Object.entries(scheduleByEmp).map(([emp, arr]) => {
            const mapDay = {};
            arr.forEach(({ day, hour }) => { mapDay[day] = hour; });
            const color = '#' + ((emp * 1234567) % 0xffffff)
              .toString(16).padStart(6, '0');

            return (
              <TableRow key={emp}>
                <TableCell>Emp&nbsp;{emp}</TableCell>
                {allDates.map(d => (
                  <TableCell key={d} sx={{
                    backgroundColor: mapDay[d] != null ? `${color}33` : undefined,
                    textAlign: 'center',
                    fontSize: 12
                  }}>
                    {mapDay[d] != null ? `${mapDay[d]}:00` : ''}
                  </TableCell>
                ))}
              </TableRow>
            );
          })}
        </TableBody>
      </Table>
    </Box>
  );
}
