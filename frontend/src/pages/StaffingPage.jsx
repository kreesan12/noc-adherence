// frontend/src/pages/StaffingPage.jsx
import { useEffect, useMemo, useRef, useState } from 'react';
import {
  Box, TextField, Button, Typography,
  MenuItem, Select, InputLabel, FormControl, Switch,
  Table, TableHead, TableBody, TableRow, TableCell,
  Tooltip, FormControlLabel, LinearProgress, Paper, Divider, Chip
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

  // Solver UX knobs (optional but useful)
  const [useExact, setUseExact] = useState(false);
  const [latestStartHour, setLatestStartHour] = useState(15); // midnight..3pm default
  const [timeLimitMin, setTimeLimitMin] = useState(0);        // 0 = no limit
  const [greedyRestarts, setGreedyRestarts] = useState(15);
  const [splitSize, setSplitSize] = useState(999);

  // Solver progress UI state
  const [solverRunning, setSolverRunning] = useState(false);
  const [solverPhase, setSolverPhase] = useState('');
  const [solverCap, setSolverCap] = useState(null);
  const [solverHeadCnt, setSolverHeadCnt] = useState(null);
  const [solverFeasible, setSolverFeasible] = useState(null);
  const [solverElapsedMs, setSolverElapsedMs] = useState(0);
  const [solverLastMs, setSolverLastMs] = useState(null);
  const [solverBestFeasible, setSolverBestFeasible] = useState(null);
  const [solverLog, setSolverLog] = useState([]);

  const abortRef = useRef(null);
  const solverStartRef = useRef(null);

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

  // Timer tick while solver running
  useEffect(() => {
    if (!solverRunning) return;
    const t = setInterval(() => {
      if (!solverStartRef.current) return;
      setSolverElapsedMs(Date.now() - solverStartRef.current);
    }, 250);
    return () => clearInterval(t);
  }, [solverRunning]);

  const fmtMs = (ms) => {
    if (ms == null) return '';
    const total = Math.floor(ms / 1000);
    const m = Math.floor(total / 60);
    const s = total % 60;
    return `${m}:${s.toString().padStart(2, '0')}`;
  };

  const pushLog = (msg) => {
    const t = dayjs().format('HH:mm:ss');
    setSolverLog(prev => {
      const next = [...prev, `[${t}] ${msg}`];
      return next.length > 300 ? next.slice(next.length - 300) : next;
    });
  };

  /* HELPERS */

  // Rotation-aware work dates: weeks * 5 workdays, filtered to forecast dateSet
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

  // Build schedule from solver solution (must match solver assumptions)
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
          // IMPORTANT: startDate is already the anchor
          const workDates = getWorkDates(block.startDate, weeks, forecastDateSet);

          workDates.forEach(dtStr => {
            const d = dayjs(dtStr).add(ci * weeks * 7, 'day');
            if (d.isAfter(horizonEnd, 'day')) return;

            const day = d.format('YYYY-MM-DD');

            // choose lunch hour (2..5 hours into shift)
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
              const k = `${day}|${h}`;
              coverMap[k] = (coverMap[k] ?? 0) + 1;
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
  };

  const cancelSolver = () => {
    if (abortRef.current) {
      abortRef.current.abort();
      pushLog('Cancel requested by user');
    }
  };

  /* ASSIGN SHIFTS */
  const assignToStaff = async () => {
    if (!forecast.length) { alert('Run Forecast first'); return; }

    // reset progress UI
    setSolverRunning(true);
    setSolverPhase('Starting');
    setSolverCap(null);
    setSolverHeadCnt(null);
    setSolverFeasible(null);
    setSolverElapsedMs(0);
    setSolverLastMs(null);
    setSolverBestFeasible(null);
    setSolverLog([]);
    solverStartRef.current = Date.now();
    pushLog('Solver started');

    const controller = new AbortController();
    abortRef.current = controller;

    try {
      const reqMap = {};
      forecast.forEach(d =>
        d.staffing.forEach(({ hour, requiredAgents }) => {
          reqMap[`${d.date}|${hour}`] = requiredAgents;
        })
      );

      const forecastDateSet = new Set(forecast.map(d => d.date));

      const startHoursArr = Array.from(
        { length: Math.max(0, Math.min(15, +latestStartHour) + 1) },
        (_, h) => h
      );

      const solve = async (cap, phaseLabel) => {
        setSolverPhase(phaseLabel);
        setSolverCap(cap);
        pushLog(`Testing cap ${cap} (${phaseLabel})`);

        const body = {
          staffing: forecast,
          weeks,
          shiftLength: SHIFT_LENGTH,
          topN: 5,
          startHours: startHoursArr,
          splitSize,

          exact: useExact,
          timeLimitMs: Math.max(0, Number(timeLimitMin) || 0) * 60 * 1000,
          greedyRestarts: Math.max(1, Number(greedyRestarts) || 1),
          exactLogEvery: 50000
        };

        if (cap > 0) body.maxStaff = cap;

        const t0 = performance.now();
        const { data } = await api.post('/erlang/staff/schedule', body, { signal: controller.signal });
        const t1 = performance.now();

        const headCnt = data.solution.reduce((s, b) => s + b.count, 0);
        setSolverHeadCnt(headCnt);
        setSolverLastMs(Math.round(t1 - t0));

        pushLog(`Returned headcount ${headCnt} in ${Math.round(t1 - t0)} ms`);

        const sched = buildSchedule(data.solution, reqMap, forecastDateSet);

        // coverage / deficit maps
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
        Object.keys(reqMap).forEach(k => {
          def[k] = (cov[k] ?? 0) - reqMap[k];
        });

        const feasible = !hasShortfall(def);
        setSolverFeasible(feasible);
        pushLog(feasible ? `Feasible at cap ${cap}` : `Not feasible at cap ${cap}`);

        if (feasible) {
          setSolverBestFeasible(prev => {
            if (prev == null) return headCnt;
            return Math.min(prev, headCnt);
          });
        }

        return {
          solution: data.solution,
          bestStart: data.bestStartHours,
          schedule: sched,
          deficit: def,
          headCnt,
          meta: data.meta
        };
      };

      // Fixed cap path
      if (useFixedStaff && fixedStaff > 0) {
        pushLog(`Fixed staff mode enabled, cap = ${fixedStaff}`);
        const plan = await solve(fixedStaff, 'Fixed cap');
        setBlocks(plan.solution);
        setBestStart(plan.bestStart);
        setPersonSchedule(plan.schedule);
        return;
      }

      // Adaptive search
      let lo = 0, hi = 1;
      let plan = await solve(hi, 'Expanding cap');
      while (hasShortfall(plan.deficit)) {
        hi *= 2;
        if (hi > 10000) break;
        plan = await solve(hi, 'Expanding cap');
      }

      let best = plan;
      if (!hasShortfall(best.deficit)) {
        pushLog(`Feasible upper bound found at cap ${hi}, starting binary search`);
      } else {
        pushLog(`Could not find feasible cap under 10000, using best found so far`);
      }

      for (let i = 0; i < MAX_ITERS && hi - lo > 1; i++) {
        const mid = Math.floor((lo + hi) / 2);
        const cur = await solve(mid, `Binary search (${i + 1}/${MAX_ITERS})`);

        if (hasShortfall(cur.deficit)) {
          lo = mid;
          pushLog(`Shortfall at ${mid}, moving lo to ${lo}`);
        } else {
          hi = mid;
          best = cur;
          pushLog(`Feasible at ${mid}, moving hi to ${hi}`);
        }
      }

      setBlocks(best.solution);
      setBestStart(best.bestStart);
      setPersonSchedule(best.schedule);
      setFixedStaff(best.headCnt);

      pushLog(`Done. Final headcount ${best.headCnt}`);
    } catch (err) {
      if (err?.name === 'CanceledError' || err?.name === 'AbortError') {
        pushLog('Solver cancelled');
      } else {
        console.error(err);
        pushLog(`Solver error: ${err?.message || String(err)}`);
        alert('Scheduling failed, see console.');
      }
    } finally {
      setSolverRunning(false);
      abortRef.current = null;
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

        <Box sx={{ display: 'flex', gap: 2, flexWrap: 'wrap', mb: 3 }}>
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
            Calculate 6-Month Forecast
          </Button>

          <FormControlLabel sx={{ ml: 1 }}
            control={<Switch checked={useFixedStaff} onChange={e => setUseFixedStaff(e.target.checked)} />}
            label="Use Fixed Staff?"
          />
          {useFixedStaff && (
            <TextField label="Staff Cap" type="number" size="small"
              sx={{ width: 110 }} value={fixedStaff}
              onChange={e => setFixedStaff(+e.target.value)} />
          )}

          <Button
            variant="contained"
            sx={{ ml: 1 }}
            disabled={!forecast.length || solverRunning}
            onClick={assignToStaff}
          >
            Draft schedule & assign agents
          </Button>

          <Button
            variant="outlined"
            color="error"
            disabled={!solverRunning}
            onClick={cancelSolver}
          >
            Cancel
          </Button>

          <Button
            variant="contained"
            color="secondary"
            sx={{ ml: 1 }}
            disabled={!Object.keys(personSchedule).length}
            onClick={allocateToAgents}
          >
            Allocate to Agents
          </Button>
        </Box>

        {/* Solver settings + live dashboard */}
        <Paper variant="outlined" sx={{ p: 2, mb: 3 }}>
          <Typography variant="h6" gutterBottom>Solver Controls</Typography>

          <Box sx={{ display: 'flex', flexWrap: 'wrap', gap: 2, alignItems: 'center' }}>
            <FormControlLabel
              control={<Switch checked={useExact} onChange={e => setUseExact(e.target.checked)} />}
              label="Use exact optimiser (slow)"
            />
            <TextField
              label="Latest start hour (0..15)"
              type="number"
              size="small"
              sx={{ width: 200 }}
              value={latestStartHour}
              onChange={e => setLatestStartHour(+e.target.value)}
            />
            <TextField
              label="Time limit (minutes, 0 = none)"
              type="number"
              size="small"
              sx={{ width: 240 }}
              value={timeLimitMin}
              onChange={e => setTimeLimitMin(+e.target.value)}
            />
            <TextField
              label="Greedy restarts"
              type="number"
              size="small"
              sx={{ width: 180 }}
              value={greedyRestarts}
              onChange={e => setGreedyRestarts(+e.target.value)}
            />
            <TextField
              label="Split size"
              type="number"
              size="small"
              sx={{ width: 140 }}
              value={splitSize}
              onChange={e => setSplitSize(+e.target.value)}
            />
          </Box>

          <Divider sx={{ my: 2 }} />

          <Box sx={{ display: 'flex', flexWrap: 'wrap', gap: 1.5, alignItems: 'center' }}>
            <Chip label={solverRunning ? 'Running' : 'Idle'} color={solverRunning ? 'warning' : 'default'} />
            <Chip label={`Elapsed ${fmtMs(solverElapsedMs)}`} />
            <Chip label={`Phase: ${solverPhase || '-'}`} />
            <Chip label={`Cap: ${solverCap ?? '-'}`} />
            <Chip label={`Headcount: ${solverHeadCnt ?? '-'}`} />
            <Chip label={`Last call: ${solverLastMs ?? '-'} ms`} />
            <Chip label={`Best feasible: ${solverBestFeasible ?? '-'}`} color="success" />
            <Chip
              label={solverFeasible == null ? 'Feasible: -' : (solverFeasible ? 'Feasible: yes' : 'Feasible: no')}
              color={solverFeasible == null ? 'default' : (solverFeasible ? 'success' : 'error')}
            />
          </Box>

          {solverRunning && (
            <Box sx={{ mt: 2 }}>
              <LinearProgress />
            </Box>
          )}

          <Box sx={{ mt: 2, maxHeight: 180, overflow: 'auto', bgcolor: '#fafafa', border: '1px solid #eee', p: 1 }}>
            <Typography variant="subtitle2" sx={{ mb: 1 }}>Solver log</Typography>
            <Box component="pre" sx={{ m: 0, fontSize: 12, whiteSpace: 'pre-wrap' }}>
              {solverLog.join('\n')}
            </Box>
          </Box>
        </Paper>

        {/* REQUIRED HEATMAP */}
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
                      const req = d.staffing.find(s => s.hour === h)?.requiredAgents || 0;
                      const alpha = maxReq ? (req / maxReq) * 0.8 + 0.2 : 0.2;
                      return (
                        <Tooltip key={d.date} title={`Req: ${req}`}>
                          <TableCell sx={{ backgroundColor: `rgba(33,150,243,${alpha})` }}>
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

        {/* SCHEDULED HEATMAP */}
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
                      const cov = scheduled[`${d.date}|${h}`] || 0;
                      const alpha = maxSch ? (cov / maxSch) * 0.8 + 0.2 : 0.2;
                      return (
                        <Tooltip key={d.date} title={`Cov: ${cov}`}>
                          <TableCell sx={{ backgroundColor: `rgba(76,175,80,${alpha})` }}>
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

        {/* DEFICIT HEATMAP */}
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
                      const val = deficit[`${d.date}|${h}`] || 0;
                      const ratio = maxDef ? (Math.abs(val) / maxDef) * 0.8 + 0.2 : 0.2;
                      const col = val < 0
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

        {/* BLOCKS TABLE */}
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

        {/* CALENDAR */}
        {Object.keys(personSchedule).length > 0 && (
          <Box sx={{ mt: 4 }}>
            <Typography variant="h6" gutterBottom>
              6-Month Staff Calendar (rotating every {weeks} weeks)
            </Typography>

            <Button variant="outlined" onClick={exportExcel} sx={{ mb: 2 }}>
              Export to Excel
            </Button>

            <CalendarView scheduleByEmp={personSchedule} nameFor={nameFor} />

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
