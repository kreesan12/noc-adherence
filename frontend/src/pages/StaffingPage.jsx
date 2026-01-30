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

import api from '../api';
import * as XLSX from 'xlsx';

/* ──────────────────────────────────────────────────────────── */
/*  1.  CONSTANTS */
const HORIZON_MONTHS = 6;        // forecast window
const SHIFT_LENGTH   = 9;        // hours per shift
const MAX_ITERS      = 50;       // binary-search depth

/* ──────────────────────────────────────────────────────────── */
export default function StaffingPage() {
  /* 2. STATE ------------------------------------------------- */
  const [roles,  setRoles]  = useState([]);
  const [team,   setTeam]   = useState('');
  const [agents, setAgents] = useState([]);           // full agent list

  const [startDate,  setStartDate]  = useState(dayjs().startOf('day'));
  const [callAht,    setCallAht]    = useState(300);
  const [ticketAht,  setTicketAht]  = useState(240);
  const [sl,         setSL]         = useState(0.8);
  const [threshold,  setThreshold]  = useState(20);
  const [shrinkage,  setShrinkage]  = useState(0.3);
  const [weeks,      setWeeks]      = useState(3);

  const [forecast,        setForecast]        = useState([]);
  const [blocks,          setBlocks]          = useState([]);
  const [bestStartHours,  setBestStart]       = useState([]);
  const [personSchedule,  setPersonSchedule]  = useState({}); // keyed by #1, #2…
  const [useFixedStaff,   setUseFixedStaff]   = useState(false);
  const [fixedStaff,      setFixedStaff]      = useState(0);
  const [excludeAuto,     setExcludeAuto]     = useState(true);

  /* 3. LOAD AGENTS & ROLES (once) ---------------------------- */
  useEffect(() => {
    api.get('/agents')
      .then(res => {
        setAgents(res.data);
        const uniq = [...new Set(res.data.map(a => a.role))];
        setRoles(uniq);
        if (uniq.length) setTeam(uniq[0]);
      })
      .catch(console.error);
  }, []);

  /* 4. HELPERS ---------------------------------------------- */
  /**
   * FIX: This should represent ONE workweek (5 consecutive days),
   * not "N weeks x 5 days", otherwise blocks get multiplied by rotation weeks.
   */
  function getWorkDays5(start) {
    const dates = [];
    const base = dayjs(start);
    for (let d = 0; d < 5; d++) {
      dates.push(base.add(d, 'day').format('YYYY-MM-DD'));
    }
    return dates;
  }

  /** buildSchedule with global-balancing lunch placement */
  function buildSchedule(solution, reqMap) {
    const schedByEmp = {};
    const totalEmp   = solution.reduce((s, b) => s + b.count, 0);
    const queue      = Array.from({ length: totalEmp }, (_, i) => i + 1);
    queue.forEach(id => (schedByEmp[id] = []));

    /* running coverage counters */
    const coverMap = {};  // on duty excl. lunch
    const lunchMap = {};  // already at lunch

    const horizonEnd = dayjs(startDate).add(HORIZON_MONTHS, 'month');
    const cycles     = Math.ceil(
      (horizonEnd.diff(startDate, 'day') + 1) / (weeks * 7)
    );

    const sorted = [...solution].sort(
      (a, b) => a.patternIndex - b.patternIndex || a.startHour - b.startHour
    );

    for (let ci = 0; ci < cycles; ci++) {
      let offset = 0;

      sorted.forEach(block => {
        /* employees assigned to this block-instance */
        const group = queue.slice(offset, offset + block.count);

        group.forEach(empId => {
          // FIX: Only schedule 5 days for this block instance.
          // The rotation repetition is handled by cycles + (ci * weeks * 7).
          getWorkDays5(block.startDate).forEach(dtStr => {
            const d = dayjs(dtStr).add(ci * weeks * 7, 'day');
            if (d.isAfter(horizonEnd, 'day')) return;
            const day = d.format('YYYY-MM-DD');

            /* ── choose lunch hour inside the shift ── */
            const candidates = [];
            for (let off = 2; off <= 5; off++) {
              const h = block.startHour + off;
              if (h >= block.startHour + SHIFT_LENGTH) break;

              const k          = `${day}|${h}`;
              const onDuty     = coverMap[k] ?? 0;
              const lunches    = lunchMap[k] ?? 0;
              const required   = reqMap[k]   ?? 0;
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
                  a.h       - b.h
                )[0].h
              : (
                  block.breakOffset != null
                    ? block.startHour + block.breakOffset
                    : block.startHour + Math.floor(block.length / 2)
                );

            /* record shift for employee */
            schedByEmp[empId].push({ day, hour: block.startHour, breakHour });

            /* update counters */
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

      /* rotate for next cycle */
      queue.unshift(queue.pop());
    }

    return schedByEmp;
  }

  /** map numeric “employee #” to display name (real or dummy) */
  const nameFor = (empNum) => {
    const teamAgents = agents.filter(a => a.role === team);
    const idx        = empNum - 1;
    if (idx < teamAgents.length) {
      const a = teamAgents[idx];
      return a.name ?? a.fullName ?? a.email ?? `Agent ${a.id}`;
    }
    return `TBD ${idx - teamAgents.length + 1}`;
  };

  /* 5. DERIVED HEAT-MAP DATA -------------------------------- */
  const {
    scheduled, deficit, maxReq, maxSch, maxDef
  } = useMemo(() => {
    const reqMap = {};
    forecast.forEach(d =>
      d.staffing.forEach(({ hour, requiredAgents }) => {
        reqMap[`${d.date}|${hour}`] = requiredAgents;
      })
    );

    const schedMap = {};
    Object.values(personSchedule).forEach(arr =>
      arr.forEach(({ day, hour, breakHour }) => {
        for (let h = hour; h < hour + SHIFT_LENGTH; h++) {
          if (h === breakHour) continue;
          const k = `${day}|${h}`;
          schedMap[k] = (schedMap[k] ?? 0) + 1;
        }
      })
    );

    const defMap = {};
    new Set([...Object.keys(reqMap), ...Object.keys(schedMap)]).forEach(k => {
      defMap[k] = (schedMap[k] ?? 0) - (reqMap[k] ?? 0);
    });

    const allReq = Object.values(reqMap);
    const allSch = Object.values(schedMap);
    const allDef = Object.values(defMap).map(v => Math.abs(v));

    return {
      scheduled : schedMap,
      deficit   : defMap,
      maxReq    : allReq.length ? Math.max(...allReq) : 0,
      maxSch    : allSch.length ? Math.max(...allSch) : 0,
      maxDef    : allDef.length ? Math.max(...allDef) : 0
    };
  }, [personSchedule, forecast]);

  const hasShortfall = def => Object.values(def).some(v => v < 0);

  /* 6-A. BUILD 6-MONTH FORECAST ----------------------------- */
  const calcForecast = async () => {
    const start = startDate.format('YYYY-MM-DD');
    const end   = startDate.add(HORIZON_MONTHS, 'month')
                           .subtract(1, 'day')
                           .format('YYYY-MM-DD');

    const { data } = await api.post('/erlang/staff/bulk-range', {
      role             : team,
      start, end,
      callAhtSeconds   : callAht,
      ticketAhtSeconds : ticketAht,
      serviceLevel     : sl,
      thresholdSeconds : threshold,
      shrinkage,
      excludeAutomation: excludeAuto
    });

    setForecast(data);
    setBlocks([]);
    setBestStart([]);
    setPersonSchedule({});
  };

  /* 6-B. ASSIGN SHIFTS -------------------------------------- */
  const assignToStaff = async () => {
    if (!forecast.length) { alert('Run Forecast first'); return; }

    /* build req-map for lunch choices */
    const reqMap = {};
    forecast.forEach(d =>
      d.staffing.forEach(({ hour, requiredAgents }) => {
        reqMap[`${d.date}|${hour}`] = requiredAgents;
      })
    );

    /* helper: call backend solver → full schedule plan */
    const solve = async (cap) => {
      const body = {
        staffing    : forecast,
        weeks,
        shiftLength : SHIFT_LENGTH,
        topN        : 5
      };
      if (cap > 0) body.maxStaff = cap;

      const { data } = await api.post('/erlang/staff/schedule', body);
      const sched   = buildSchedule(data.solution, reqMap);

      /* coverage / deficit maps */
      const cov = {};
      Object.values(sched).forEach(arr =>
        arr.forEach(({ day, hour, breakHour }) => {
          for (let h = hour; h < hour + SHIFT_LENGTH; h++) {
            if (h === breakHour) continue;
            const k = `${day}|${h}`;
            cov[k]  = (cov[k] ?? 0) + 1;
          }
        })
      );
      const def = {};
      Object.keys(reqMap).forEach(k => { def[k] = (cov[k] ?? 0) - reqMap[k]; });

      return {
        solution  : data.solution,
        bestStart : data.bestStartHours,
        schedule  : sched,
        deficit   : def,
        headCnt   : data.solution.reduce((s, b) => s + b.count, 0)
      };
    };

    /* ---- FIXED-CAP PATH ----------------------------------- */
    if (useFixedStaff && fixedStaff > 0) {
      const plan = await solve(fixedStaff);
      setBlocks(plan.solution);
      setBestStart(plan.bestStart);
      setPersonSchedule(plan.schedule);   // numeric keys
      return;
    }

    /* ---- ADAPTIVE SEARCH ---------------------------------- */
    let lo = 0, hi = 1, plan = await solve(hi);
    while (hasShortfall(plan.deficit)) {
      hi *= 2;
      if (hi > 10000) break;              // guard
      plan = await solve(hi);
    }
    let best = plan;
    for (let i = 0; i < MAX_ITERS && hi - lo > 1; i++) {
      const mid = Math.floor((lo + hi) / 2);
      const cur = await solve(mid);
      if (hasShortfall(cur.deficit)) lo = mid;
      else { hi = mid; best = cur; }
    }

    setBlocks(best.solution);
    setBestStart(best.bestStart);
    setPersonSchedule(best.schedule);
    setFixedStaff(best.headCnt);          // handy if user flips switch
  };

  /* 6-C. EXPORT SCHEDULE TO EXCEL --------------------------- */
  const exportExcel = () => {
    const rows = [];
    Object.entries(personSchedule).forEach(([emp, arr]) =>
      arr.forEach(({ day, hour, breakHour }) => {
        rows.push({ Employee: nameFor(+emp), Date: day, StartHour: `${hour}:00`,      Type: 'Shift'  });
        rows.push({ Employee: nameFor(+emp), Date: day, StartHour: `${breakHour}:00`, Type: 'Lunch' });
      })
    );

    const ws = XLSX.utils.json_to_sheet(rows);
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, 'Schedule');
    XLSX.writeFile(wb, 'staff-calendar.xlsx');
  };

  /* 6-D. PUSH SHIFTS TO BACKEND ----------------------------- */
  const buildAllocationPayload = () => {
    const liveAgents = agents.filter(a => a.role === team);   // ignore “TBD”
    const rows = [];

    Object.entries(personSchedule).forEach(([empNum, shifts]) => {
      const idx = +empNum - 1;                // 1-based → 0-based
      if (idx >= liveAgents.length) return;   // skip dummy slots

      const agentId = liveAgents[idx].id;

      shifts.forEach(({ day, hour, breakHour }) => {
        const startAt      = dayjs.utc(`${day}T${hour.toString().padStart(2, '0')}:00:00`);
        const endAt        = startAt.add(SHIFT_LENGTH, 'hour');
        const breakStart   = dayjs.utc(`${day}T${breakHour.toString().padStart(2, '0')}:00:00`);
        const breakEnd     = breakStart.add(1, 'hour');

        rows.push({
          agentId,
          startAt:    startAt.toISOString(),
          endAt:      endAt.toISOString(),
          breakStart: breakStart.toISOString(),
          breakEnd:   breakEnd.toISOString()
        });
      });
    });

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

  /* 7. RENDER ------------------------------------------------ */
  return (
    <LocalizationProvider dateAdapter={AdapterDayjs}>
      <Box sx={{ p: 3 }}>
        <Typography variant="h4" gutterBottom>
          Staffing Forecast &amp; Scheduling
        </Typography>

        {/* ───── toolbar ───── */}
        <Box sx={{ display: 'flex', gap: 2, flexWrap: 'wrap', mb: 4 }}>
          {/* Team picker */}
          <FormControl sx={{ minWidth: 140 }}>
            <InputLabel>Team</InputLabel>
            <Select value={team} label="Team"
                    onChange={e => setTeam(e.target.value)}>
              {roles.map(r => (
                <MenuItem key={r} value={r}>{r}</MenuItem>
              ))}
            </Select>
          </FormControl>

          {/* Forecast start */}
          <DatePicker
            label="Forecast Start"
            value={startDate}
            onChange={d => d && setStartDate(d.startOf('day'))}
            slotProps={{ textField: { size: 'small' } }}
          />

          {/* Rotation (weeks) */}
          <FormControl sx={{ minWidth: 120 }}>
            <InputLabel>Rotation (weeks)</InputLabel>
            <Select value={weeks} label="Rotation"
                    onChange={e => setWeeks(+e.target.value)}>
              {[1,2,3,4,5].map(w => (
                <MenuItem key={w} value={w}>{w}</MenuItem>
              ))}
            </Select>
          </FormControl>

          {/* Numeric params */}
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
          <FormControlLabel
            control={
              <Switch checked={excludeAuto}
                      onChange={e => setExcludeAuto(e.target.checked)} />
            }
            label="Ignore automation?"
          />

          {/* Actions */}
          <Button variant="contained" onClick={calcForecast}>
            Calculate 6-Month Forecast
          </Button>

          {/* Fixed-staff toggle */}
          <FormControlLabel sx={{ ml: 2 }}
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

          <Button variant="contained" sx={{ ml: 2 }}
                  disabled={!forecast.length}
                  onClick={assignToStaff}>
            Draft schedule & assign agents
          </Button>
          <Button variant="contained" color="secondary" sx={{ ml: 2 }}
                  disabled={!Object.keys(personSchedule).length}
                  onClick={allocateToAgents}>
            Allocate to Agents
          </Button>
        </Box>
        {/* ─── end toolbar ─── */}

        {/* 1) REQUIRED AGENTS HEATMAP */}
        {forecast.length > 0 && (
          <Box sx={{ mb: 4, overflowX: 'auto' }}>
            <Typography variant="h6">Required Agents Heatmap</Typography>
            <Table size="small">
              <TableHead>
                <TableRow>
                  <TableCell>Hour</TableCell>
                  {forecast.map(d => (
                    <TableCell key={d.date}>{d.date}</TableCell>
                  ))}
                </TableRow>
              </TableHead>
              <TableBody>
                {Array.from({ length: 24 }, (_, h) => (
                  <TableRow key={h}>
                    <TableCell>{h}:00</TableCell>
                    {forecast.map(d => {
                      const req    = d.staffing.find(s => s.hour === h)?.requiredAgents || 0;
                      const alpha  = maxReq ? (req / maxReq) * 0.8 + 0.2 : 0.2;
                      return (
                        <Tooltip key={d.date} title={`Req: ${req}`}>
                          <TableCell
                            sx={{ backgroundColor: `rgba(33,150,243,${alpha})` }}>
                            {req}
                          </TableCell>
                        </Tooltip>
                      );
                    })}
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </Box>
        )}

        {/* 2) SCHEDULED COVERAGE HEATMAP */}
        {forecast.length > 0 && (
          <Box sx={{ mb: 4, overflowX: 'auto' }}>
            <Typography variant="h6">Scheduled Coverage Heatmap</Typography>
            <Table size="small">
              <TableHead>
                <TableRow>
                  <TableCell>Hour</TableCell>
                  {forecast.map(d => (
                    <TableCell key={d.date}>{d.date}</TableCell>
                  ))}
                </TableRow>
              </TableHead>
              <TableBody>
                {Array.from({ length: 24 }, (_, h) => (
                  <TableRow key={h}>
                    <TableCell>{h}:00</TableCell>
                    {forecast.map(d => {
                      const cov    = scheduled[`${d.date}|${h}`] || 0;
                      const alpha  = maxSch ? (cov / maxSch) * 0.8 + 0.2 : 0.2;
                      return (
                        <Tooltip key={d.date} title={`Cov: ${cov}`}>
                          <TableCell
                            sx={{ backgroundColor: `rgba(76,175,80,${alpha})` }}>
                            {cov}
                          </TableCell>
                        </Tooltip>
                      );
                    })}
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </Box>
        )}

        {/* 3) UNDER / OVER STAFFING HEATMAP */}
        {forecast.length > 0 && (
          <Box sx={{ mb: 4, overflowX: 'auto' }}>
            <Typography variant="h6">Under-/Over-Staffing Heatmap</Typography>
            <Table size="small">
              <TableHead>
                <TableRow>
                  <TableCell>Hour</TableCell>
                  {forecast.map(d => (
                    <TableCell key={d.date}>{d.date}</TableCell>
                  ))}
                </TableRow>
              </TableHead>
              <TableBody>
                {Array.from({ length: 24 }, (_, h) => (
                  <TableRow key={h}>
                    <TableCell>{h}:00</TableCell>
                    {forecast.map(d => {
                      const val   = deficit[`${d.date}|${h}`] || 0;
                      const ratio = maxDef ? (Math.abs(val) / maxDef) * 0.8 + 0.2 : 0.2;
                      const col   = val < 0
                        ? `rgba(244,67,54,${ratio})`
                        : `rgba(76,175,80,${ratio})`;
                      return (
                        <Tooltip key={d.date} title={`Deficit: ${val}`}>
                          <TableCell sx={{ backgroundColor: col }}>
                            {val}
                          </TableCell>
                        </Tooltip>
                      );
                    })}
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </Box>
        )}

        {/* 4) SHIFT BLOCK TABLE */}
        {blocks.length > 0 && (
          <Box sx={{ mb: 4, overflowX: 'auto' }}>
            <Typography variant="h6">Assigned Shift-Block Types</Typography>
            <Table size="small">
              <TableHead>
                <TableRow>
                  <TableCell>#</TableCell>
                  <TableCell>Start Date</TableCell>
                  <TableCell>Start Hour</TableCell>
                  <TableCell>Length (h)</TableCell>
                  <TableCell>Count</TableCell>
                </TableRow>
              </TableHead>
              <TableBody>
                {blocks.map((b, i) => (
                  <TableRow key={i}>
                    <TableCell>{i + 1}</TableCell>
                    <TableCell>{b.startDate}</TableCell>
                    <Tooltip title={`Starts at ${b.startHour}:00`}>
                      <TableCell>{b.startHour}:00</TableCell>
                    </Tooltip>
                    <TableCell>{b.length}</TableCell>
                    <TableCell>{b.count}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </Box>
        )}

        {/* 5) 6-MONTH ROTATING CALENDAR */}
        {Object.keys(personSchedule).length > 0 && (
          <Box sx={{ mt: 4 }}>
            <Typography variant="h6" gutterBottom>
              6-Month Staff Calendar (rotating every {weeks} weeks)
            </Typography>
            <Button variant="outlined" onClick={exportExcel} sx={{ mb: 2 }}>
              Export to Excel
            </Button>
            <CalendarView
              scheduleByEmp={personSchedule}
              nameFor={nameFor}
            />
            <Box sx={{ mt: 2, p: 2, bgcolor: '#f9f9f9', borderRadius: 1 }}>
              <Typography variant="subtitle1">
                {useFixedStaff
                  ? `Staff cap set to ${fixedStaff}.`
                  : `Full-coverage schedule uses ${Object.keys(personSchedule).length} agents
                  (${excludeAuto ? 'automation excluded' : 'automation included'}).`}
              </Typography>
            </Box>
          </Box>
        )}
      </Box>
    </LocalizationProvider>
  );
}

/* ──────────────────────────────────────────────────────────── */
/*  CalendarView (inline) */
function CalendarView({ scheduleByEmp, nameFor }) {
  const allDates = [...new Set(
    Object.values(scheduleByEmp).flatMap(arr => arr.map(e => e.day))
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
            const color = '#' + ((+emp * 1234567) % 0xffffff)
              .toString(16).padStart(6, '0');

            return (
              <TableRow key={emp}>
                <TableCell>{nameFor(+emp)}</TableCell>
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
