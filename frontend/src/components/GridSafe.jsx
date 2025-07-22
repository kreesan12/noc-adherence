import React from 'react';
import { DataGrid } from '@mui/x-data-grid';

export default function GridSafe(props) {
  return (
    <GridErrorBoundary>
      <DataGrid {...props} />
    </GridErrorBoundary>
  );
}

/* ── stops any grid crash from killing the whole app ───────── */
class GridErrorBoundary extends React.Component {
  constructor(p){ super(p); this.state = {hasError:false}; }
  static getDerivedStateFromError(){ return {hasError:true}; }
  componentDidCatch(err,info){
    console.error('DataGrid crashed', err, info.componentStack);
  }
  render(){
    if (this.state.hasError) return <p style={{color:'red'}}>grid error</p>;
    return this.props.children;
  }
}
