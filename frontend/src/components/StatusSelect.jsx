import { MenuItem, Select } from '@mui/material'
export default function StatusSelect({ value, onChange }) {
  return (
    <Select size="small" value={value} onChange={e => onChange(e.target.value)}>
      {['present','late','no_show','pending'].map(s =>
        <MenuItem key={s} value={s}>{s.replace('_',' ')}</MenuItem>)}
    </Select>
  )
}
