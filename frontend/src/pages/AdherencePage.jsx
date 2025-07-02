import { useEffect, useState } from 'react'
import { DataGrid } from '@mui/x-data-grid'
import { Box, Chip } from '@mui/material'
import api from '../api'
import StatusSelect from '../components/StatusSelect'
import dayjs from 'dayjs'

const blue = { background:'#2979ff', color:'#fff' }
const green = { background:'#00e676', color:'#000' }
const red = { background:'#ff1744', color:'#fff' }

export default function AdherencePage() {
  const [rows, setRows] = useState([])
  const date = dayjs().format('YYYY-MM-DD')

  useEffect(() => {
    api.get(`/schedule?date=${date}`).then(r => {
      setRows(r.data.map(s => ({
        id: s.id,
        agent: s.agent.fullName,
        phone: s.agent.phone,
        status: s.attendance?.status ?? 'pending',
        duty: s.attendance?.duty?.name ?? '',
        start: dayjs(s.startAt).format('HH:mm'),
        end  : dayjs(s.endAt).format('HH:mm'),
      })))
    })
  }, [date])

  const columns = [
    { field:'agent', headerName:'Agent', flex:1 },
    { field:'phone', headerName:'Phone', width:120 },
    { field:'status', headerName:'Status', width:110,
      renderCell:(p)=>(
        <Chip label={p.value.replace('_',' ')}
              sx={p.value==='present'?green : p.value==='late'?red : blue}/>
      ),
      renderEditCell:(p)=><StatusSelect {...p}/>
    },
    { field:'duty', headerName:'Duty', flex:1, editable:true },
    { field:'start', headerName:'Start', width:70 },
    { field:'end', headerName:'End', width:70 }
  ]

  return (
    <Box sx={{ height:600 }}>
      <DataGrid
        columns={columns}
        rows={rows}
        disableSelectionOnClick
        editMode="row"
        processRowUpdate={async (newRow) => {
          await api.patch(`/attendance/${newRow.id}`, {
            status:newRow.status,
            dutyName:newRow.duty
          })
          return newRow
        }}
      />
    </Box>
  )
}
