import { useEffect, useMemo, useRef, useState } from 'react';
import {
  Box, TextField, Button, Typography,
  MenuItem, Select, InputLabel, FormControl, Switch,
  Table, TableHead, TableBody, TableRow, TableCell,
  Tooltip, FormControlLabel, Divider
} from '@mui/material';
import { LocalizationProvider, DatePicker } from '@mui/x-date-pickers';
import { AdapterDayjs } from '@mui/x-date-pickers/AdapterDayjs';

import dayjs from 'dayjs';
import utc from 'dayjs/plugin/utc';
import isSameOrBefore from 'dayjs/plugin/isSameOrBefore';

dayjs.extend(utc);
dayjs.extend(isSameOrBefore);

import api from '../api';
import * as XLSX from 'xlsx';

/* CONSTANTS */
const HORIZON_MONTHS = 6;
const SHIFT_LENGTH   = 9;
const MAX_ITERS      = 50;

function fmtElapsed(ms) {
  const s = Math.floor(ms / 1000);
  const m = Math.floor(s / 60);
  const r = s % 60;
  return `${m}:${String(r).padStart(2, '0')}`;
}

export default function StaffingPage() {
  /* STATE */
  const [roles,  setRoles]  = useState([]);
  const [team,   setTeam]   = useState('');
  const [agents, setAgents] = useState([]);

  const [startDate, setStartDate] = useState(dayjs().startOf('day'));
  const [callAht, setCallAht] = useState(300);
  const [ticketAht, setTicketAht] = useState(240);
  const [sl, setSL] = useState(0.8);
  const [threshold, setThreshold] = useState(20);
  const [shrinkage, setShrinkage] = useState(0.3);
  const [weeks, setWeeks] = useState(3);

  const [forecast, setForecast] = useState([]);
  const [blocks, setBlocks] = useState([]);
  const [bestStartHours, setBestStart] = useState([]);
  const [personSchedule, setPersonSchedule] = useState({});
  const [useFixedStaff, setUseFixedStaff] = useState(false);
  const [fixedStaff, setFixedStaff] = useState(0);
  const [excludeAuto, setExcludeAuto] = useState(true);

  /* Solver controls */
  const [useExactTrim, setUseExactTrim] = useState(false);
  const [latestStartHour, setLatestStartHour] = useState(15);     // 0..15 default
  const [timeLimitMin, setTimeLimitMin] = useState(30);           // per-cap exact attempt
  const [greedyRestarts, setGreedyRestarts] = useState(999);
  const [splitSize, setSplitSize] = useState(999);

  /* Live solver status */
  const [solverRunning, setSolverRunning] = useState(false);
  const [solverPhase, setSolverPhase] = useState('Idle');
  const [solverCap, setSolverCap] = useState(null);
  const [solverHeadcount, setSolverHeadcount] = useState(null);
  const [solverBestFeasible, setSolverBestFeasible] = useState(null);
  const [solverLastMs, setSolverLastMs] = useState(null);
  const [solverLog, setSolverLog] = useState([]);

  const startTsRef = useRef(0);
  const timerRef = useRef(null);
  const [elapsedMs, setElapsedMs] = useState(0);

  function logLine(msg) {
    const ts = dayjs().format('HH:mm:ss');
    setSolverLog(prev => [...prev, `[${ts}] ${msg}`].slice(-300));
  }

  function startTimer() {
    startTsRef.current = Date.now();
    setElapsedMs(0);
    if (timerRef.current) clearInterval(timerRef.current);
    timerRef.current = setInterval(() => {
      setElapsedMs(Date.now() - startTsRef.current);
    }, 250);
  }

  function stopTimer() {
    if (timerRef.current) clearInterval(timerRef.current);
    timerRef.current = null;
  }

  /* LOAD AGENTS & ROLES */
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

  /* HELPERS */

  function getWorkDates(startDateStr, weeksCount, dateSet) {
    const out = [];
    for (let w = 0; w < weeksCount; w++) {
      const base = dayjs(startDateStr).add(w * 7, 'day');
      for (let d = 0; d < 5; d++) {
        const dd = base.add(d, 'day').format('YYYY-MM-DD');
        if (!dateSet || dateSet.has(dd)) out.push(dd);
      }
    }
    return out;
  }

  function buildSchedule(solution, reqMap, forecastDateSet) {
    const schedByEmp = {};
    const totalEmp = solution.reduce((s, b) => s + b.count, 0);
    const queue = Array.from({ length: totalEmp }, (_, i) => i + 1);
    queue.forEach(id => (schedByEmp[id] = []));

    const coverMap = {};
    const lunchMap = {};

    const horizonEnd = dayjs(startDate).add(HORIZON_MONTHS, 'month');
    const cycles = Math.ceil((horizonEnd.diff(startDate, 'day') + 1) / (weeks * 7));

    const sorted = [...solution].sort(
      (a, b) => (a.patternIndex ?? 0) - (b.patternIndex ?? 0) || a.startHour - b.startHour
    );

    for (let ci = 0; ci < cycles; ci++) {
      let offset = 0;

      sorted.forEach(block => {
        const group = queue.slice(offset, offset + block.count);

        group.forEach(empId => {
          const workDates = getWorkDates(block.startDate, weeks, forecastDateSet);

          workDates.forEach(dtStr => {
            const d = dayjs(dtStr).add(ci * weeks * 7, 'day');
            if (d.isAfter(horizonEnd, 'day')) return;

            const day = d.format('YYYY-MM-DD');

            const candidates = [];
            for (let off = 2; off <= 5; off++) {
              const h = block.startHour + off;
              if (h >= block.startHour + SHIFT_LENGTH) break;

              const k = `${day}|${h}`;
              const onDuty = coverMap[k] ?? 0;
              const lunches = lunchMap[k] ?? 0;
              const required = reqMap[k] ?? 0;

              const projected = onDuty - lunches - 1;
              const surplus = projected - required;

              if (surplus >= 0) candidates.push({ h, surplus, lunches });
            }

            const breakHour = candidates.length
              ? candidates.sort((a, b) =>
                  a.surplus - b.surplus ||
                  a.lunches - b.lunches ||
                  a.h - b.h
                )[0].h
              : (block.breakOffset != null
                  ? block.startHour + block.breakOffset
                  : block.startHour + Math.floor(block.length / 2)
                );

            schedByEmp[empId].push({ day, hour: block.startHour, breakHour });

            for (let h = block.startHour; h < block.startHour + SHIFT_LENGTH; h++) {
              const k2 = `${day}|${h}`;
              coverMap[k2] = (coverMap[k2] ?? 0) + 1;
            }
            const lk = `${day}|${breakHour}`;
            lunchMap[lk] = (lunchMap[lk] ?? 0) + 1;
          });
        });

        offset += block.count;
      });

      queue.unshift(queue.pop());
    }

    return schedByEmp;
  }

  const nameFor = (empNum) => {
    const teamAgents = agents.filter(a => a.role === team);
    const idx = empNum - 1;
    if (idx < teamAgents.length) {
      const a = teamAgents[idx];
      return a.name ?? a.fullName ?? a.email ?? `Agent ${a.id}`;
    }
    return `TBD ${idx - teamAgents.length + 1}`;
  };

  /* DERIVED HEATMAP DATA */
  const { scheduled, deficit, maxReq, maxSch, maxDef } = useMemo(() => {
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
      scheduled: schedMap,
      deficit: defMap,
      maxReq: allReq.length ? Math.max(...allReq) : 0,
      maxSch: allSch.length ? Math.max(...allSch) : 0,
      maxDef: allDef.length ? Math.max(...allDef) : 0
    };
  }, [personSchedule, forecast]);

  const hasShortfall = def => Object.values(def).some(v => v < 0);

  /* FORECAST */
  const calcForecast = async () => {
    const start = startDate.format('YYYY-MM-DD');
    const end = startDate.add(HORIZON_MONTHS, 'month')
      .subtract(1, 'day')
      .format('YYYY-MM-DD');

    const { data } = await api.post('/erlang/staff/bulk-range', {
      role: team,
      start, end,
      callAhtSeconds: callAht,
      ticketAhtSeconds: ticketAht,
      serviceLevel: sl,
      thresholdSeconds: threshold,
      shrinkage,
      excludeAutomation: excludeAuto
    });

    setForecast(data);
    setBlocks([]);
    setBestStart([]);
    setPersonSchedule({});
    setSolverLog([]);
    setSolverBestFeasible(null);
    setSolverPhase('Idle');
    setSolverCap(null);
    setSolverHeadcount(null);
    setSolverLastMs(null);
  };

  /* ASSIGN SHIFTS */
  const assignToStaff = async () => {
    if (!forecast.length) { alert('Run Forecast first'); return; }

    setSolverRunning(true);
    setSolverLog([]);
    setSolverBestFeasible(null);
    setSolverPhase('Starting');
    setSolverCap(null);
    setSolverHeadcount(null);
    setSolverLastMs(null);
    startTimer();
    logLine('Solver started');

    try {
      const reqMap = {};
      forecast.forEach(d =>
        d.staffing.forEach(({ hour, requiredAgents }) => {
          reqMap[`${d.date}|${hour}`] = requiredAgents;
        })
      );

      const forecastDateSet = new Set(forecast.map(d => d.date));

      const startHours = Array.from(
        { length: Math.max(0, Math.min(15, latestStartHour)) + 1 },
        (_, i) => i
      );

      const solve = async (cap, mode) => {
        // mode: 'greedy' or 'exact'
        const body = {
          staffing: forecast,
          weeks,
          shiftLength: SHIFT_LENGTH,
          topN: 5,
          splitSize,
          startHours
        };

        if (cap > 0) body.maxStaff = cap;

        // CRITICAL FIX: exact is ONLY used in trim phase
        if (mode === 'exact') {
          body.exact = true;
          body.timeLimitMs = Math.max(0, Math.floor(timeLimitMin * 60 * 1000));
          body.greedyRestarts = Math.max(1, greedyRestarts);
        } else {
          body.exact = false;
          body.timeLimitMs = 0;
          body.greedyRestarts = 0;
        }

        setSolverCap(cap);
        const t0 = Date.now();
        const { data } = await api.post('/erlang/staff/schedule', body);
        const dt = Date.now() - t0;

        const headCnt = data.solution.reduce((s, b) => s + b.count, 0);
        setSolverHeadcount(headCnt);
        setSolverLastMs(dt);

        const sched = buildSchedule(data.solution, reqMap, forecastDateSet);

        const cov = {};
        Object.values(sched).forEach(arr =>
          arr.forEach(({ day, hour, breakHour }) => {
            for (let h = hour; h < hour + SHIFT_LENGTH; h++) {
              if (h === breakHour) continue;
              const k = `${day}|${h}`;
              cov[k] = (cov[k] ?? 0) + 1;
            }
          })
        );

        const def = {};
        Object.keys(reqMap).forEach(k => { def[k] = (cov[k] ?? 0) - reqMap[k]; });

        const feasible = !hasShortfall(def);

        return {
          solution: data.solution,
          bestStart: data.bestStartHours,
          schedule: sched,
          deficit: def,
          headCnt,
          feasible,
          meta: data.meta,
          ms: dt
        };
      };

      /* Fixed cap path */
      if (useFixedStaff && fixedStaff > 0) {
        setSolverPhase('Fixed cap (greedy)');
        logLine(`Testing fixed cap ${fixedStaff} (greedy)`);
        const plan = await solve(fixedStaff, 'greedy');
        logLine(`Returned headcount ${plan.headCnt} in ${plan.ms} ms`);
        logLine(plan.feasible ? 'Feasible' : 'Not feasible');

        setBlocks(plan.solution);
        setBestStart(plan.bestStart);
        setPersonSchedule(plan.schedule);
        setSolverBestFeasible(plan.feasible ? plan.headCnt : null);
        return;
      }

      /* Phase 1: Fast greedy expand to get an upper bound */
      setSolverPhase('Expanding cap (greedy)');
      let lo = 0;
      let hi = 1;

      logLine(`Testing cap ${hi} (greedy expand)`);
      let plan = await solve(hi, 'greedy');
      logLine(`Returned headcount ${plan.headCnt} in ${plan.ms} ms`);
      if (!plan.feasible) logLine(`Not feasible at cap ${hi}`);

      while (!plan.feasible) {
        lo = hi;
        hi *= 2;
        if (hi > 10000) {
          logLine('Guard hit: cap exceeded 10000');
          break;
        }
        logLine(`Testing cap ${hi} (greedy expand)`);
        plan = await solve(hi, 'greedy');
        logLine(`Returned headcount ${plan.headCnt} in ${plan.ms} ms`);
        logLine(plan.feasible ? `Feasible at cap ${hi}` : `Not feasible at cap ${hi}`);
      }

      let best = plan;
      if (best.feasible) {
        setSolverBestFeasible(best.headCnt);
        logLine(`Feasible upper bound found at cap ${hi}, starting binary search (greedy only)`);
      } else {
        logLine('No feasible upper bound found in greedy expand');
      }

      /* Phase 1b: Binary search (still greedy only) */
      setSolverPhase('Binary search (greedy)');
      for (let i = 0; i < MAX_ITERS && best.feasible && hi - lo > 1; i++) {
        const mid = Math.floor((lo + hi) / 2);
        logLine(`Testing cap ${mid} (greedy binary ${i + 1}/${MAX_ITERS})`);
        const cur = await solve(mid, 'greedy');
        logLine(`Returned headcount ${cur.headCnt} in ${cur.ms} ms`);

        if (!cur.feasible) {
          lo = mid;
          logLine(`Shortfall at ${mid}, moving lo to ${lo}`);
        } else {
          hi = mid;
          best = cur;
          setSolverBestFeasible(best.headCnt);
          logLine(`Feasible at ${mid}, moving hi to ${hi}`);
        }
      }

      /* Phase 2: Exact trim (ONLY now) */
      if (useExactTrim && best.feasible) {
        setSolverPhase('Exact trim (slow)');
        logLine(`Starting exact trim from ${best.headCnt - 1} downwards`);
        logLine(`Exact budget per cap: ${timeLimitMin} min, restarts: ${greedyRestarts}`);

        let cap = best.headCnt - 1;
        while (cap >= 1) {
          logLine(`Testing cap ${cap} (exact trim)`);
          const cur = await solve(cap, 'exact');
          logLine(`Returned headcount ${cur.headCnt} in ${cur.ms} ms`);
          if (cur.meta) {
            logLine(`Meta: restarts=${cur.meta.restarts ?? '?'} timeMs=${cur.meta.timeMs ?? '?'} shortfall=${cur.meta.shortfall ?? '?'} over=${cur.meta.over ?? '?'}`);
          }
          if (cur.feasible) {
            best = cur;
            setSolverBestFeasible(best.headCnt);
            logLine(`Feasible at cap ${cap}. Continuing trim`);
            cap = best.headCnt - 1; // keep trimming from the new best
            continue;
          } else {
            logLine(`Infeasible at cap ${cap}. Stopping trim`);
            break;
          }
        }
      }

      logLine(`Done. Final headcount ${best.headCnt}`);

      setBlocks(best.solution);
      setBestStart(best.bestStart);
      setPersonSchedule(best.schedule);
      setFixedStaff(best.headCnt);
    } catch (err) {
      console.error(err);
      logLine(`ERROR: ${err?.message || String(err)}`);
      alert('Scheduling failed, see console.');
    } finally {
      setSolverRunning(false);
      setSolverPhase('Idle');
      stopTimer();
    }
  };

  /* EXPORT */
  const exportExcel = () => {
    const rows = [];
    Object.entries(personSchedule).forEach(([emp, arr]) =>
      arr.forEach(({ day, hour, breakHour }) => {
        rows.push({ Employee: nameFor(+emp), Date: day, StartHour: `${hour}:00`, Type: 'Shift' });
        rows.push({ Employee: nameFor(+emp), Date: day, StartHour: `${breakHour}:00`, Type: 'Lunch' });
      })
    );

    const ws = XLSX.utils.json_to_sheet(rows);
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, 'Schedule');
    XLSX.writeFile(wb, 'staff-calendar.xlsx');
  };

  /* PUSH SHIFTS */
  const buildAllocationPayload = () => {
    const liveAgents = agents.filter(a => a.role === team);
    const rows = [];

    Object.entries(personSchedule).forEach(([empNum, shifts]) => {
      const idx = +empNum - 1;
      if (idx >= liveAgents.length) return;

      const agentId = liveAgents[idx].id;

      shifts.forEach(({ day, hour, breakHour }) => {
        const startAt = dayjs.utc(`${day}T${hour.toString().padStart(2, '0')}:00:00`);
        const endAt = startAt.add(SHIFT_LENGTH, 'hour');
        const breakStart = dayjs.utc(`${day}T${breakHour.toString().padStart(2, '0')}:00:00`);
        const breakEnd = breakStart.add(1, 'hour');

        rows.push({
          agentId,
          startAt: startAt.toISOString(),
          endAt: endAt.toISOString(),
          breakStart: breakStart.toISOString(),
          breakEnd: breakEnd.toISOString()
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
      alert('Allocation failed, see console.');
    }
  };

  /* RENDER */
  return (
    <LocalizationProvider dateAdapter={AdapterDayjs}>
      <Box sx={{ p: 3 }}>
        <Typography variant="h4" gutterBottom>
          Staffing Forecast &amp; Scheduling
        </Typography>

        {/* Solver panel */}
        <Box sx={{ mb: 2, p: 2, border: '1px solid #ddd', borderRadius: 1 }}>
          <Typography variant="h6" gutterBottom>Solver Controls</Typography>

          <Box sx={{ display: 'flex', gap: 2, flexWrap: 'wrap', alignItems: 'center' }}>
            <FormControlLabel
              control={<Switch checked={useExactTrim} onChange={e => setUseExactTrim(e.target.checked)} />}
              label="Use exact optimiser (slow)"
            />

            <TextField
              label="Latest start hour (0..15)"
              type="number"
              size="small"
              value={latestStartHour}
              onChange={e => setLatestStartHour(Math.max(0, Math.min(15, +e.target.value)))}
              sx={{ width: 170 }}
            />

            <TextField
              label="Time limit (minutes, 0 = none)"
              type="number"
              size="small"
              value={timeLimitMin}
              onChange={e => setTimeLimitMin(Math.max(0, +e.target.value))}
              sx={{ width: 220 }}
            />

            <TextField
              label="Greedy restarts"
              type="number"
              size="small"
              value={greedyRestarts}
              onChange={e => setGreedyRestarts(Math.max(1, +e.target.value))}
              sx={{ width: 150 }}
            />

            <TextField
              label="Split size"
              type="number"
              size="small"
              value={splitSize}
              onChange={e => setSplitSize(Math.max(1, +e.target.value))}
              sx={{ width: 120 }}
            />
          </Box>

          <Divider sx={{ my: 2 }} />

          <Box sx={{ display: 'flex', gap: 3, flexWrap: 'wrap' }}>
            <Typography variant="body2"><b>Status:</b> {solverRunning ? 'Running' : 'Idle'}</Typography>
            <Typography variant="body2"><b>Elapsed:</b> {fmtElapsed(elapsedMs)}</Typography>
            <Typography variant="body2"><b>Phase:</b> {solverPhase}</Typography>
            <Typography variant="body2"><b>Cap:</b> {solverCap ?? '-'}</Typography>
            <Typography variant="body2"><b>Headcount:</b> {solverHeadcount ?? '-'}</Typography>
            <Typography variant="body2"><b>Best feasible:</b> {solverBestFeasible ?? '-'}</Typography>
            <Typography variant="body2"><b>Last call:</b> {solverLastMs != null ? `${solverLastMs} ms` : '-'}</Typography>
          </Box>

          <Box sx={{ mt: 2, maxHeight: 160, overflow: 'auto', bgcolor: '#fafafa', p: 1, borderRadius: 1, border: '1px solid #eee' }}>
            <Typography variant="subtitle2" gutterBottom>Solver log</Typography>
            <Box component="pre" sx={{ m: 0, fontSize: 12, whiteSpace: 'pre-wrap' }}>
              {solverLog.join('\n')}
            </Box>
          </Box>
        </Box>

        {/* Main toolbar */}
        <Box sx={{ display: 'flex', gap: 2, flexWrap: 'wrap', mb: 4 }}>
          <FormControl sx={{ minWidth: 140 }}>
            <InputLabel>Team</InputLabel>
            <Select value={team} label="Team" onChange={e => setTeam(e.target.value)}>
              {roles.map(r => (
                <MenuItem key={r} value={r}>{r}</MenuItem>
              ))}
            </Select>
          </FormControl>

          <DatePicker
            label="Forecast Start"
            value={startDate}
            onChange={d => d && setStartDate(d.startOf('day'))}
            slotProps={{ textField: { size: 'small' } }}
          />

          <FormControl sx={{ minWidth: 120 }}>
            <InputLabel>Rotation (weeks)</InputLabel>
            <Select value={weeks} label="Rotation" onChange={e => setWeeks(+e.target.value)}>
              {[1,2,3,4,5].map(w => (
                <MenuItem key={w} value={w}>{w}</MenuItem>
              ))}
            </Select>
          </FormControl>

          <TextField label="Call AHT (sec)" type="number" size="small"
            value={callAht} onChange={e => setCallAht(+e.target.value)} />
          <TextField label="Ticket AHT (sec)" type="number" size="small"
            value={ticketAht} onChange={e => setTicketAht(+e.target.value)} />
          <TextField label="Service Level %" type="number" size="small"
            value={sl * 100} onChange={e => setSL(+e.target.value / 100)} />
          <TextField label="Threshold (sec)" type="number" size="small"
            value={threshold} onChange={e => setThreshold(+e.target.value)} />
          <TextField label="Shrinkage %" type="number" size="small"
            value={shrinkage * 100} onChange={e => setShrinkage(+e.target.value / 100)} />

          <FormControlLabel
            control={<Switch checked={excludeAuto} onChange={e => setExcludeAuto(e.target.checked)} />}
            label="Ignore automation?"
          />

          <Button variant="contained" onClick={calcForecast}>
            Calculate 6 Month Forecast
          </Button>

          <FormControlLabel sx={{ ml: 2 }}
            control={<Switch checked={useFixedStaff} onChange={e => setUseFixedStaff(e.target.checked)} />}
            label="Use Fixed Staff?"
          />
          {useFixedStaff && (
            <TextField label="Staff Cap" type="number" size="small"
              sx={{ width: 100 }} value={fixedStaff}
              onChange={e => setFixedStaff(+e.target.value)} />
          )}

          <Button variant="contained" sx={{ ml: 2 }}
            disabled={!forecast.length || solverRunning}
            onClick={assignToStaff}>
            Draft schedule & assign agents
          </Button>

          <Button variant="contained" color="secondary" sx={{ ml: 2 }}
            disabled={!Object.keys(personSchedule).length}
            onClick={allocateToAgents}>
            Allocate to Agents
          </Button>
        </Box>

        {/* HEATMAPS and tables unchanged from your version */}
        {/* ... keep your existing heatmap and calendar rendering here ... */}

        {Object.keys(personSchedule).length > 0 && (
          <Box sx={{ mt: 4 }}>
            <Typography variant="h6" gutterBottom>
              6 Month Staff Calendar (rotating every {weeks} weeks)
            </Typography>

            <Button variant="outlined" onClick={exportExcel} sx={{ mb: 2 }}>
              Export to Excel
            </Button>

            <CalendarView scheduleByEmp={personSchedule} nameFor={nameFor} />

            <Box sx={{ mt: 2, p: 2, bgcolor: '#f9f9f9', borderRadius: 1 }}>
              <Typography variant="subtitle1">
                {useFixedStaff
                  ? `Staff cap set to ${fixedStaff}.`
                  : `Full coverage schedule uses ${Object.keys(personSchedule).length} agents
                  (${excludeAuto ? 'automation excluded' : 'automation included'}).`}
              </Typography>
            </Box>
          </Box>
        )}
      </Box>
    </LocalizationProvider>
  );
}

/* CalendarView */
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
              <TableCell key={d} sx={{ minWidth: 80, textAlign: 'center' }}>
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
                  <TableCell
                    key={d}
                    sx={{
                      backgroundColor: mapDay[d] != null ? `${color}33` : undefined,
                      textAlign: 'center',
                      fontSize: 12
                    }}
                  >
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
