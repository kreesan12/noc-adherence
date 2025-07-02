import { createTheme } from '@mui/material/styles'
export default createTheme({
  palette:{ mode:'dark', primary:{main:'#00e676'}, secondary:{main:'#2979ff'}},
  components:{ MuiDataGrid:{ styleOverrides:{ cell:{fontSize:14} } } }
})
