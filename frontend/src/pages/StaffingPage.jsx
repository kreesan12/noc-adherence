import { useEffect, useMemo, useRef, useState } from 'react';
import {
  Box, TextField, Button, Typography,
  MenuItem, Select, InputLabel, FormControl, Switch,
  Table, TableHead, TableBody, TableRow, TableCell,
  Tooltip, FormControlLabel, Paper, Divider, LinearProgress
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

const SHIFT_TYPES = {
  grave: { startHour: 0, breakOffset: 4 },
  day:   { startHour: 8, breakOffset: 4 },
  late:  { startHour: 15, breakOffset: 4 }
};

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
  const [countLunchAsCoverage, setCountLunchAsCoverage] = useState(false);

  // Waterfall rotation controls
  const [graveRotateAfterCycles, setGraveRotateAfterCycles] = useState(2);
  const [lateRotateAfterCycles, setLateRotateAfterCycles] = useState(2);

  // Solver UI
  const [solverRunning, setSolverRunning] = useState(false);
  const [solverPhase, setSolverPhase] = useState('Idle');
  const [solverCap, setSolverCap] = useState(null);
  const [solverHeadcount, setSolverHeadcount] = useState(null);
  const [solverBestFeasible, setSolverBestFeasible] = useState(null);
  const [solverFeasible, setSolverFeasible] = useState(null);
  const [solverElapsedSec, setSolverElapsedSec] = useState(0);
  const [solverLastCallMs, setSolverLastCallMs] = useState(null);
  const [solverLog, setSolverLog] = useState([]);

  const solverStartRef = useRef(null);
  const timerRef = useRef(null);
  const cancelRef = useRef(false);

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
  function logLine(msg) {
    const ts = dayjs().format('HH:mm:ss');
    setSolverLog(prev => [`[${ts}] ${msg}`, ...prev].slice(0, 400));
  }

  function startSolverTimer() {
    solverStartRef.current = Date.now();
    setSolverElapsedSec(0);
    if (timerRef.current) clearInterval(timerRef.current);
    timerRef.current = setInterval(() => {
      if (!solverStartRef.current) return;
      setSolverElapsedSec(Math.floor((Date.now() - solverStartRef.current) / 1000));
    }, 500);
  }

  function stopSolverTimer() {
    if (timerRef.current) clearInterval(timerRef.current);
    timerRef.current = null;
  }

  function hasShortfall(def) {
    return Object.values(def).some(v => v < 0);
  }

  function buildWeekdayDateMapFromForecastDates(forecastDates) {
    const map = {};
    const firstWeek = forecastDates.slice(0, 7);
    firstWeek.forEach(d => {
      const wd = dayjs(d).day();
      if (map[wd] == null) map[wd] = d;
    });
    return map;
  }

  function getWorkDates(startDateStr, weeksCount) {
    const out = [];
    for (let w = 0; w < weeksCount; w++) {
      const base = dayjs(startDateStr).add(w * 7, 'day');
      for (let d = 0; d < 5; d++) {
        out.push(base.add(d, 'day').format('YYYY-MM-DD'));
      }
    }
    return out;
  }

  function shiftTypeForTrackAtCycle(track, ci) {
    if (track.pool === 'day') return 'day';

    const required = track.required ?? 1;
    const rotateAfter = track.rotateAfterCycles ?? 2;
    const groupSize = Math.max(1, required);
    const groupCount = rotateAfter + 1;

    const groupIndex0 = Math.floor((track.slotIndex ?? 0) / groupSize);
    const groupIndex = (groupIndex0 + ci) % groupCount;

    if (groupIndex === 0) return track.pool;
    return 'day';
  }

  function phaseForTrackAtCycle(track, ci) {
    const p0 = track.phase0 ?? 0;
    return (p0 + ci) % 7;
  }

  function buildScheduleFromTracks(tracks, reqMap, forecastDateSet) {
    const schedByEmp = {};
    const totalEmp = tracks.length;
    const empIds = Array.from({ length: totalEmp }, (_, i) => i + 1);
    empIds.forEach(id => (schedByEmp[id] = []));

    const coverMap = {};
    const lunchMap = {};

    const allForecastDates = Array.from(forecastDateSet).sort();
    const horizonStart = allForecastDates[0];
    const horizonEnd = allForecastDates[allForecastDates.length - 1];

    const weekdayMap = buildWeekdayDateMapFromForecastDates(allForecastDates);
    const start = dayjs(horizonStart);
    const end = dayjs(horizonEnd);

    const cycleDays = weeks * 7;
    const totalDays = end.diff(start, 'day') + 1;
    const cycles = Math.max(1, Math.ceil(totalDays / cycleDays));

    for (let ci = 0; ci < cycles; ci++) {
      for (let ti = 0; ti < tracks.length; ti++) {
        const track = tracks[ti];
        const empId = ti + 1;

        const phase = phaseForTrackAtCycle(track, ci);
        const baseStartDate = weekdayMap[phase];
        if (!baseStartDate) continue;

        const shiftType = shiftTypeForTrackAtCycle(track, ci);
        const st = SHIFT_TYPES[shiftType] ?? SHIFT_TYPES.day;

        const workDates = getWorkDates(baseStartDate, weeks);

        workDates.forEach(dtStr => {
          const d = dayjs(dtStr).add(ci * cycleDays, 'day');
          if (d.isBefore(start, 'day')) return;
          if (d.isAfter(end, 'day')) return;

          const day = d.format('YYYY-MM-DD');
          if (!forecastDateSet.has(day)) return;

          // Pick lunch hour that hurts the least (same logic you had)
          const candidates = [];
          for (let off = 2; off <= 5; off++) {
            const h = st.startHour + off;
            if (h >= st.startHour + SHIFT_LENGTH) break;
            if (h >= 24) break;

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
            : (st.startHour + (st.breakOffset ?? 4));

          schedByEmp[empId].push({ day, hour: st.startHour, breakHour });

          // Apply coverage maps
          for (let h = st.startHour; h < st.startHour + SHIFT_LENGTH; h++) {
            if (h >= 24) break;
            const k = `${day}|${h}`;
            coverMap[k] = (coverMap[k] ?? 0) + 1;
          }
          const lk = `${day}|${breakHour}`;
          lunchMap[lk] = (lunchMap[lk] ?? 0) + 1;
        });
      }
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
          if (h >= 24) break;
          if (!countLunchAsCoverage && h === breakHour) continue;
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
  }, [personSchedule, forecast, countLunchAsCoverage]);

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

  /* ASSIGN SHIFTS (single backend call, Option D waterfall) */
  const assignToStaff = async () => {
    if (!forecast.length) { alert('Run Forecast first'); return; }

    cancelRef.current = false;
    setSolverRunning(true);
    setSolverPhase('Starting');
    setSolverCap(null);
    setSolverHeadcount(null);
    setSolverBestFeasible(null);
    setSolverFeasible(null);
    setSolverLastCallMs(null);
    setSolverLog([]);
    startSolverTimer();
    logLine('Solver started');

    const reqMap = {};
    forecast.forEach(d =>
      d.staffing.forEach(({ hour, requiredAgents }) => {
        reqMap[`${d.date}|${hour}`] = requiredAgents;
      })
    );
    const forecastDateSet = new Set(forecast.map(d => d.date));

    try {
      if (useFixedStaff && fixedStaff > 0) {
        logLine(`Fixed staff is enabled (${fixedStaff}). Note: waterfall mode ignores cap for now.`);
      }

      setSolverPhase('Solving (waterfall backend)');
      logLine(`Calling backend waterfall solver (weeks ${weeks}, grave rotate ${graveRotateAfterCycles}, late rotate ${lateRotateAfterCycles})`);

      const body = {
        staffing: forecast,
        mode: 'waterfall',
        weeks,
        shiftLength: SHIFT_LENGTH,
        graveRotateAfterCycles: Number(graveRotateAfterCycles),
        lateRotateAfterCycles: Number(lateRotateAfterCycles)
      };

      const t0 = performance.now();
      const { data } = await api.post('/erlang/staff/schedule', body);
      const dt = Math.round(performance.now() - t0);

      setSolverLastCallMs(dt);

      const meta = data?.meta || {};
      const tracks = data?.tracks || [];
      const blocksOut = data?.solution || [];

      const headCnt = tracks.length || (blocksOut.reduce((s, b) => s + (b.count || 0), 0));
      setSolverHeadcount(headCnt);
      setSolverBestFeasible(meta?.feasible ? headCnt : null);
      setSolverFeasible(Boolean(meta?.feasible));

      logLine(`Backend returned in ${dt} ms`);
      logLine(`Meta: feasible ${meta?.feasible ? 'yes' : 'no'}, headcount ${meta?.headcount ?? headCnt}, over ${meta?.over ?? '-'}, checks ${meta?.checks ?? '-'}`);

      // Build schedule from tracks
      const sched = buildScheduleFromTracks(tracks, reqMap, forecastDateSet);

      // compute feasibility from built schedule (lunch excluded)
      const cov = {};
      Object.values(sched).forEach(arr =>
        arr.forEach(({ day, hour, breakHour }) => {
          for (let h = hour; h < hour + SHIFT_LENGTH; h++) {
            if (h >= 24) break;
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
      if (feasible) logLine('Feasibility check passed on frontend');
      else logLine('Feasibility check failed on frontend');

      setBlocks(blocksOut);
      setBestStart(data.bestStartHours || []);
      setPersonSchedule(sched);
      setFixedStaff(headCnt);

      setSolverPhase('Done');
      logLine(`Done. Final headcount ${headCnt}`);

    } catch (err) {
      console.error(err);
      setSolverPhase('Error');
      logLine(`Error: ${err?.message || 'unknown'}`);
    } finally {
      setSolverRunning(false);
      stopSolverTimer();
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

  const formatElapsed = (sec) => {
    const m = Math.floor(sec / 60);
    const s = sec % 60;
    return `${m}:${String(s).padStart(2, '0')}`;
  };

  /* RENDER */
  return (
    <LocalizationProvider dateAdapter={AdapterDayjs}>
      <Box sx={{ p: 3 }}>
        <Typography variant="h4" gutterBottom>
          Staffing Forecast &amp; Scheduling
        </Typography>

        {/* Solver Controls */}
        <Paper variant="outlined" sx={{ p: 2, mb: 2 }}>
          <Typography variant="h6" gutterBottom>Solver Controls</Typography>

          <Box sx={{ display: 'flex', gap: 2, flexWrap: 'wrap', alignItems: 'center' }}>
            <TextField
              label="Grave rotate after cycles"
              type="number"
              size="small"
              sx={{ width: 220 }}
              value={graveRotateAfterCycles}
              onChange={e => setGraveRotateAfterCycles(+e.target.value)}
              disabled={solverRunning}
              inputProps={{ min: 0 }}
            />

            <TextField
              label="Late rotate after cycles"
              type="number"
              size="small"
              sx={{ width: 220 }}
              value={lateRotateAfterCycles}
              onChange={e => setLateRotateAfterCycles(+e.target.value)}
              disabled={solverRunning}
              inputProps={{ min: 0 }}
            />

            <Button
              variant="outlined"
              disabled={!solverRunning}
              onClick={() => { cancelRef.current = true; logLine('Cancel requested'); }}
            >
              Cancel
            </Button>
          </Box>

          <Divider sx={{ my: 2 }} />

          <Box sx={{ display: 'flex', gap: 3, flexWrap: 'wrap' }}>
            <Typography variant="body2">Status: <b>{solverPhase}</b></Typography>
            <Typography variant="body2">Elapsed: <b>{formatElapsed(solverElapsedSec)}</b></Typography>
            <Typography variant="body2">Cap: <b>{solverCap ?? '-'}</b></Typography>
            <Typography variant="body2">Headcount: <b>{solverHeadcount ?? '-'}</b></Typography>
            <Typography variant="body2">Best feasible: <b>{solverBestFeasible ?? '-'}</b></Typography>
            <Typography variant="body2">Feasible: <b>{solverFeasible == null ? '-' : (solverFeasible ? 'yes' : 'no')}</b></Typography>
            <Typography variant="body2">Last call: <b>{solverLastCallMs == null ? '-' : `${solverLastCallMs} ms`}</b></Typography>
          </Box>

          {solverRunning && <LinearProgress sx={{ mt: 2 }} />}

          <Box sx={{ mt: 2 }}>
            <Typography variant="subtitle2" gutterBottom>Solver log</Typography>
            <Box sx={{
              maxHeight: 220,
              overflowY: 'auto',
              bgcolor: '#0b1020',
              color: '#d7e0ff',
              p: 1.5,
              borderRadius: 1,
              fontFamily: 'ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, "Liberation Mono", "Courier New", monospace',
              fontSize: 12
            }}>
              {solverLog.length === 0 ? (
                <div style={{ opacity: 0.75 }}>No log yet</div>
              ) : solverLog.map((l, i) => (
                <div key={i}>{l}</div>
              ))}
            </Box>
          </Box>
        </Paper>

        {/* Main toolbar */}
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

          <Button
            variant="contained"
            sx={{ ml: 2 }}
            disabled={!forecast.length || solverRunning}
            onClick={assignToStaff}
          >
            Draft schedule &amp; assign agents
          </Button>

          <Button variant="contained" color="secondary" sx={{ ml: 2 }}
            disabled={!Object.keys(personSchedule).length || solverRunning}
            onClick={allocateToAgents}>
            Allocate to Agents
          </Button>
        </Box>

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

        <FormControlLabel
          control={
            <Switch
              checked={countLunchAsCoverage}
              onChange={e => setCountLunchAsCoverage(e.target.checked)}
            />
          }
          label="Heatmaps: include lunch hour as coverage"
        />

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
            <Typography variant="h6">Under or Over Staffing Heatmap</Typography>
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
            <Typography variant="h6">Assigned Shift Block Types (cycle 0 view)</Typography>
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
              6 Month Staff Calendar (waterfall lanes, rotates every {weeks} weeks)
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
