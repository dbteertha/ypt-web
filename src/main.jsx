import React, { useEffect, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { BarChart3, BookOpen, Clock3, LogOut, Play, RefreshCw, Square, Users } from 'lucide-react';
import { ypt } from './yptApi';
import './styles.css';

const pad = n => String(n).padStart(2, '0');
const fmt = ms => { const s=Math.floor((ms||0)/1000), h=Math.floor(s/3600), m=Math.floor((s%3600)/60); return `${pad(h)}:${pad(m)}:${pad(s%60)}`; };
const today = () => { const d=new Date(); const y=d.getFullYear(), m=pad(d.getMonth()+1), day=pad(d.getDate()); return `${y}-${m}-${day}`; };

function pickSubjects(data){
  const arrays = [data?.ss, data?.sbs, data?.subjects, data?.user?.subjects].filter(Array.isArray);
  const raw = arrays[0] || [];
  return raw.map((x,i)=>({ id:x.id ?? x.si ?? x.sbid ?? i, title:x.t ?? x.title ?? x.n ?? x.name ?? `Subject ${i+1}`, archived:Boolean(x.a ?? x.archived) }));
}
function pickName(data){ return data?.n ?? data?.name ?? data?.u?.n ?? data?.user?.name ?? data?.nickname ?? 'YPT User'; }
function flattenGroups(data){ const out=[]; for(const k of ['gs','ms','cs','ps']) if(Array.isArray(data?.[k])) out.push(...data[k]); return out; }
function pickTodayMs(data){
  const values=[data?.dl?.sm,data?.sm,data?.dayLog?.sm,data?.todayStudyMs,data?.todayMs];
  for(const v of values){ const n=Number(v); if(Number.isFinite(n)&&n>=0) return n; }
  return 0;
}

function loadGoogleScript(){
  return new Promise((resolve,reject)=>{
    if(window.google?.accounts?.oauth2) return resolve();
    const existing=document.querySelector('script[data-google-gis]');
    if(existing){ existing.addEventListener('load',resolve,{once:true}); existing.addEventListener('error',reject,{once:true}); return; }
    const s=document.createElement('script'); s.src='https://accounts.google.com/gsi/client'; s.async=true; s.defer=true; s.dataset.googleGis='1'; s.onload=resolve; s.onerror=()=>reject(new Error('Could not load Google Sign-In.')); document.head.appendChild(s);
  });
}

function Login({onDone}){
  const [clientId,setClientId]=useState(''); const [busy,setBusy]=useState(false); const [err,setErr]=useState('');
  useEffect(()=>{ ypt.config().then(c=>setClientId(c.googleClientId||'')).catch(e=>setErr(e.message)); },[]);
  async function signIn(){
    if(!clientId){ setErr('Google OAuth is not configured on this deployment yet. Add GOOGLE_CLIENT_ID in Render.'); return; }
    setBusy(true); setErr('');
    try{
      await loadGoogleScript();
      const credential = await new Promise((resolve,reject)=>{
        const tokenClient = window.google.accounts.oauth2.initTokenClient({
          client_id: clientId,
          scope: 'openid email profile',
          callback: async r => {
            if(r.error) return reject(new Error(r.error_description||r.error));
            try{
              const meRes=await fetch('https://openidconnect.googleapis.com/v1/userinfo',{headers:{Authorization:`Bearer ${r.access_token}`}});
              if(!meRes.ok) throw new Error('Could not read Google profile.');
              const me=await meRes.json();
              resolve({accessToken:r.access_token,providerId:`g${me.sub}`,email:me.email||''});
            }catch(e){reject(e)}
          }
        });
        tokenClient.requestAccessToken({prompt:'select_account'});
      });
      const d=await ypt.googleSignIn(credential); onDone(d);
    }catch(e){ setErr(e.message||String(e)); }finally{ setBusy(false); }
  }
  return <div className="loginShell"><div className="loginCard"><div className="brandMark">YPT</div><h1>Yeolpumta Web</h1><p className="muted">Sign in with the same Google account connected to your YPT account.</p><button className="googleBtn" disabled={busy} onClick={signIn}><span className="gLogo">G</span>{busy?'Connecting…':'Continue with Google'}</button>{err&&<div className="error">{err}</div>}<p className="tiny">Google authentication happens with Google. Your Google password is never sent to this site.</p></div></div>
}

function App(){
  const [authed,setAuthed]=useState(null); const [user,setUser]=useState(null); const [subjects,setSubjects]=useState([]); const [groups,setGroups]=useState([]); const [todayMs,setTodayMs]=useState(0); const [active,setActive]=useState(null); const [elapsed,setElapsed]=useState(0); const [loading,setLoading]=useState(false); const [tab,setTab]=useState('home'); const [err,setErr]=useState('');
  async function hydrate(seed){
    setLoading(true); setErr('');
    try{
      const info=seed?.s?seed:await ypt.reloadInfo();
      setUser(info); setSubjects(pickSubjects(info).filter(s=>!s.archived));
      let total=pickTodayMs(info);
      try{ const day=await ypt.dayLog(today()); const dayTotal=pickTodayMs(day); if(dayTotal||total===0) total=dayTotal; }catch{}
      setTodayMs(total);
      try{setGroups(flattenGroups(await ypt.myGroups()))}catch{}
      setAuthed(true);
    }catch(e){ setErr(e.message); if(/401|Not signed in/i.test(String(e.message))) setAuthed(false); }
    finally{setLoading(false)}
  }
  useEffect(()=>{ (async()=>{ try{ const ok=await ypt.isAuthenticated(); setAuthed(ok); if(ok) await hydrate(); }catch{setAuthed(false)} })(); },[]);
  useEffect(()=>{ if(!active)return; const id=setInterval(()=>setElapsed(Date.now()-active.startedAt),1000); return()=>clearInterval(id); },[active]);
  useEffect(()=>{
    if(!authed || active) return;
    const sync=async()=>{ try{ const day=await ypt.dayLog(today()); setTodayMs(pickTodayMs(day)); }catch{} };
    const id=setInterval(sync,10000);
    return()=>clearInterval(id);
  },[authed,active]);
  async function start(subject){ setErr(''); try{ const r=await ypt.studyStart(subject.title); const startedAt=r?.dl?.startedAt ?? r?.startedAt ?? Date.now(); setActive({subject,startedAt:Number(startedAt)}); setElapsed(Date.now()-Number(startedAt)); }catch(e){setErr(e.message)} }
  async function stop(){ if(!active)return; try{ await ypt.studyStop(active.startedAt); setActive(null); setElapsed(0); await hydrate(); }catch(e){setErr(e.message)} }
  if(authed===null) return <div className="center">Checking session…</div>;
  if(!authed) return <Login onDone={hydrate}/>;
  if(loading&&!user) return <div className="center">Loading your YPT account…</div>;
  const name=pickName(user);
  const nav=[['home',Clock3,'Study'],['subjects',BookOpen,'Subjects'],['groups',Users,'Groups'],['stats',BarChart3,'Stats']];
  return <div className="app"><aside><div className="logo">YPT</div>{nav.map(([id,Icon,label])=><button key={id} onClick={()=>setTab(id)} className={tab===id?'nav active':'nav'}><Icon size={19}/><span>{label}</span></button>)}<div className="spacer"/><button className="nav" onClick={()=>hydrate()}><RefreshCw size={19}/><span>Sync</span></button><button className="nav" onClick={async()=>{await ypt.signOut();location.reload()}}><LogOut size={19}/><span>Sign out</span></button></aside><main><header><div><div className="eyebrow">YEOLPUMTA WEB</div><h2>{name}</h2></div><div className="status"><span className="dot"/> Connected to YPT</div></header>{err&&<div className="error banner">{err}</div>}
  {tab==='home'&&<section><div className="hero"><div className="muted">Today's YPT study time</div><div className="timer">{fmt(todayMs + (active?elapsed:0))}</div><div className="muted">{active?`Studying ${active.subject.title}`:'Synced from your YPT account · auto-refreshes every 10s'}</div>{active?<button className="stop" onClick={stop}><Square size={20} fill="currentColor"/> Stop</button>:null}</div><h3>Subjects</h3><div className="grid">{subjects.length?subjects.map(s=><button className="subjectCard" key={s.id} disabled={Boolean(active)} onClick={()=>start(s)}><div className="subjectIcon"><Play size={18} fill="currentColor"/></div><div><strong>{s.title}</strong><span>Start studying</span></div></button>):<div className="empty">No subjects detected. Tap Sync; if this remains empty, YPT's response shape may have changed.</div>}</div></section>}
  {tab==='subjects'&&<section><h3>Your subjects</h3><div className="list">{subjects.map(s=><div className="row" key={s.id}><BookOpen size={18}/><strong>{s.title}</strong><button onClick={()=>start(s)} disabled={Boolean(active)}>Start</button></div>)}</div></section>}
  {tab==='groups'&&<section><h3>Your groups</h3><div className="list">{groups.length?groups.map((g,i)=><div className="row" key={g.id??i}><Users size={18}/><strong>{g.t??g.title??g.n??`Group ${i+1}`}</strong></div>):<div className="empty">No joined groups returned.</div>}</div></section>}
  {tab==='stats'&&<section><h3>Statistics</h3><div className="statGrid"><div className="stat"><span>Today</span><b>{fmt(todayMs)}</b></div><div className="stat"><span>Subjects</span><b>{subjects.length}</b></div><div className="stat"><span>Groups</span><b>{groups.length}</b></div><div className="stat"><span>Date</span><b>{today()}</b></div></div><p className="muted block">Today's total is loaded from your YPT day log. Phone-side changes auto-refresh about every 10 seconds.</p></section>}
  </main></div>
}
createRoot(document.getElementById('root')).render(<App/>);
