import React,{useEffect,useState}from'react';
import{Alert,Button,Stack,Typography}from'@mui/material';
import{Link}from'react-router-dom';
import{getActiveCall}from'../services/callCenter.service';
export default function ActiveCallBanner(){
 const[call,setCall]=useState(null),[now,setNow]=useState(Date.now());
 useEffect(()=>{getActiveCall().then(r=>setCall(r.data.data)).catch(()=>{});const timer=setInterval(()=>setNow(Date.now()),1000);return()=>clearInterval(timer);},[]);
 if(!call)return null;const elapsed=Math.max(0,Math.floor((now-new Date(call.startedAt).getTime())/1000)),time=`${String(Math.floor(elapsed/60)).padStart(2,'0')}:${String(elapsed%60).padStart(2,'0')}`;
 return <Alert severity="warning" sx={{mb:2}} action={<Button component={Link} to={`/call-center?leadId=${call.leadId}`} color="inherit">Return to call</Button>}><Stack direction="row" spacing={1}><Typography fontWeight={900}>Active agent-reported call</Typography><Typography>{time}</Typography></Stack></Alert>;
}
