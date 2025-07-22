import React from 'react';
import { DataGrid } from '@mui/x-data-grid';

export default function GridSafe (props) {
  return (
    <ErrorBoundary>
      <DataGrid {...props}/>
    </ErrorBoundary>
  );
}

/* — simple boundary that prints the crashing rows to console — */
class ErrorBoundary extends React.Component {
  constructor(props){ super(props); this.state = {hasError:false}; }
  static getDerivedStateFromError(){ return {hasError:true}; }
  componentDidCatch(err,info){
    /* log the rows that blew up */
    console.error('❌ DataGrid crashed - dumping rows →', this.props?.children?.props?.rows);
    console.error(err,info.componentStack);
  }
  render(){
    if (this.state.hasError) return <p style={{color:'red'}}>Grid crashed – see console</p>;
    return this.props.children;
  }
}
