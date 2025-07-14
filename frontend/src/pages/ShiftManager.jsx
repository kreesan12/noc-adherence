// frontend/src/pages/ShiftManager.jsx
import { useEffect, useState, useMemo } from 'react';
import {
  Box, Button, TextField, MenuItem, Typography, Snackbar,
  Dialog, DialogTitle, DialogContent, DialogActions
} from '@mui/material';
import { DataGrid } from '@mui/x-data-grid';
import dayjs from 'dayjs';

import api from '../api';                  // default axios wrapper
import { updateShift, swapShifts } from '../api/shifts';   // <– unchanged

export default function ShiftManager() {
  /* ── state ──────────────────────────────────────────────── */
  const [rows,        setRows]        = useState([]);
  const [teams,       setTeams]       = useState([]);
  const [agents,      setAgents]      = useState([]);
  const [filters,     setFilters]     = useState({
    team : '',
    agent: '',
    from : dayjs(),
    to   : dayjs().add(7, 'day')
  });
  const [editItem,    setEditItem]    = useState(null);
  const [swapSource,  setSwapSource]  = useState(null);
  const [snack,       setSnack]       = useState('');

  /* ── 1) load agents once → derive team list ─────────────── */
  useEffect(() => {
    (async () => {
      const { data } = await api.get('/agents');
      setAgents(data);
      setTeams([...new Set(data.map(a => a.role))]);
    })();
  }, []);

  /* ── 2) load shift rows whenever filters change ─────────── */
  useEffect(() => {
    (async () => {
      const { team, agent, from, to } = filters;
      const { data } = await api.get('/shifts', {
        params: {
          role     : team    || undefined,         // backend expects `role`
          agentId  : agent   || undefined,
          startDate: from.format('YYYY-MM-DD'),
          endDate  : to.format('YYYY-MM-DD')
        }
      });

      /* backend already sends flat keys { agentName, team, … } */
      setRows(data);
    })();
  }, [filters]);

  /* ── 3) grid columns (memoised) ─────────────────────────── */
  const columns = useMemo(() => [
    { field: 'id',        headerName: 'ID',     width: 70 },
    {
      field: 'agentName',
      headerName: 'Agent',
      width: 180,
      valueGetter: p => p.row.agentName || '—'
    },
    { field: 'team',      headerName: 'Team',   width: 120 },
    {
      field      : 'startAt',
      headerName : 'Start',
      width      : 180,
      valueGetter: p => dayjs(p.value).format('YYYY-MM-DD HH:mm')
    },
    {
      field      : 'endAt',
      headerName : 'End',
      width      : 180,
      valueGetter: p => dayjs(p.value).format('YYYY-MM-DD HH:mm')
    },
    {
      field     : 'actions',
      headerName: '',
      width     : 120,
      sortable  : false,
      renderCell: params => (
        <>
          <Button size="small" onClick={() => setEditItem(params.row)}>✏️</Button>
          <Button
            size="small"
            onClick={() =>
              swapSource
                ? handleSwap(params.row)
                : setSwapSource(params.row)
            }
            color={swapSource && swapSource.id === params.row.id ? 'secondary' : 'primary'}
          >↔︎</Button>
        </>
      )
    }
  // include swapSource in deps so the ↔︎ button colour updates
  ], [swapSource]);

  /* ── 4) helpers — edit / swap / snack ───────────────────── */
  async function handleEditSave(changes) {
    try {
      await updateShift(editItem.id, changes);
      setSnack('Shift updated');
      setEditItem(null);
      setFilters({ ...filters });          // re-trigger fetch
    } catch {
      setSnack('Error updating shift');
    }
  }

  async function handleSwap(targetRow) {
    try {
      await swapShifts(swapSource.id, targetRow.id);
      setSnack('Shift swap complete');
      setSwapSource(null);
      setFilters({ ...filters });
    } catch {
      setSnack('Swap failed');
    }
  }

  /* ── 5) render ──────────────────────────────────────────── */
  return (
    <Box p={2}>
      <Typography variant="h5" gutterBottom>Shift manager</Typography>

      {/* ── Filters ───────────────────────────────────────── */}
      <Box display="flex" gap={2} mb={2} flexWrap="wrap">
        {/* team filter */}
        <TextField
          select
          label="Team"
          size="small"
          value={filters.team}
          onChange={e => setFilters({ ...filters, team: e.target.value })}
          sx={{ minWidth: 160 }}
        >
          <MenuItem value="">All</MenuItem>
          {teams.map(t => <MenuItem key={t} value={t}>{t}</MenuItem>)}
        </TextField>

        {/* agent filter */}
        <TextField
          select
          label="Agent"
          size="small"
          value={filters.agent}
          onChange={e => setFilters({ ...filters, agent: e.target.value })}
          sx={{ minWidth: 160 }}
        >
          <MenuItem value="">All</MenuItem>
          {agents.map(a =>
            <MenuItem key={a.id} value={a.id}>{a.name}</MenuItem>
          )}
        </TextField>

        {/* date range */}
        <TextField
          type="date"
          size="small"
          label="From"
          InputLabelProps={{ shrink: true }}
          value={filters.from.format('YYYY-MM-DD')}
          onChange={e => setFilters({ ...filters, from: dayjs(e.target.value) })}
        />
        <TextField
          type="date"
          size="small"
          label="To"
          InputLabelProps={{ shrink: true }}
          value={filters.to.format('YYYY-MM-DD')}
          onChange={e => setFilters({ ...filters, to: dayjs(e.target.value) })}
        />
      </Box>

      {/* ── Table ─────────────────────────────────────────── */}
      <div style={{ height: 560, width: '100%' }}>
        <DataGrid rows={rows} columns={columns} pageSize={25} />
      </div>

      {/* ── Edit dialog ───────────────────────────────────── */}
      {editItem &&
        <EditShiftDialog
          shift={editItem}
          onCancel={() => setEditItem(null)}
          onSave={handleEditSave}
        />}

      {/* ── Snack ─────────────────────────────────────────── */}
      <Snackbar
        open={!!snack}
        autoHideDuration={4000}
        message={snack}
        onClose={() => setSnack('')}
      />
    </Box>
  );
}

/* ── small inline dialog component ───────────────────────── */
function EditShiftDialog({ shift, onCancel, onSave }) {
  const [start, setStart] = useState(
    dayjs(shift.startAt).format('YYYY-MM-DDTHH:mm')
  );
  const [end,   setEnd]   = useState(
    dayjs(shift.endAt).format('YYYY-MM-DDTHH:mm')
  );

  return (
    <Dialog open onClose={onCancel}>
      <DialogTitle>Edit shift</DialogTitle>
      <DialogContent
        sx={{ display:'flex', flexDirection:'column', gap:2, mt:1 }}
      >
        <TextField
          label="Start"
          type="datetime-local"
          value={start}
          onChange={e => setStart(e.target.value)}
        />
        <TextField
          label="End"
          type="datetime-local"
          value={end}
          onChange={e => setEnd(e.target.value)}
        />
      </DialogContent>
      <DialogActions>
        <Button onClick={onCancel}>Cancel</Button>
        <Button onClick={() => onSave({ startAt: start, endAt: end })}>
          Save
        </Button>
      </DialogActions>
    </Dialog>
  );
}
