import React, { useEffect, useRef, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { BookOpenCheck, Clock3, Expand, LogOut, Play, RefreshCw, Shrink, Square, Trophy, Users } from 'lucide-react';
import { ypt } from './yptApi';
import './styles.css';

const pad = n => String(n).padStart(2, '0');
const fmt = ms => {
  const s = Math.floor((ms || 0) / 1000);
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  return `${pad(h)}:${pad(m)}:${pad(s % 60)}`;
};
const today = () => {
  const d = new Date();
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
};
const timeLabel = ts => {
  if (!ts) return 'Time unavailable';
  return new Date(ts).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
};
const num = (...vals) => {
  for (const v of vals) {
    const n = Number(v);
    if (Number.isFinite(n)) return n;
  }
  return 0;
};
const parseTs = value => {
  if (value === null || value === undefined || value === '') return null;
  if (typeof value === 'number') {
    if (value > 1e12) return value;
    if (value > 1e9) return value * 1000;
    return value;
  }
  const n = Number(value);
  if (Number.isFinite(n) && n > 0) return parseTs(n);
  const parsed = Date.parse(value);
  return Number.isFinite(parsed) ? parsed : null;
};

function pickSubjects(data) {
  const arrays = [data?.ss, data?.sbs, data?.subjects, data?.user?.subjects].filter(Array.isArray);
  const raw = arrays[0] || [];
  return raw
    .map((x, i) => ({
      id: x.id ?? x.si ?? x.sbid ?? i,
      title: x.t ?? x.title ?? x.n ?? x.name ?? `Subject ${i + 1}`,
      archived: Boolean(x.a ?? x.archived),
    }))
    .filter(x => !x.archived);
}
function pickName(data) {
  return data?.n ?? data?.name ?? data?.u?.n ?? data?.user?.name ?? data?.nickname ?? 'YPT User';
}
function flattenGroups(data) {
  const out = [];
  for (const k of ['gs', 'ms', 'cs', 'ps']) if (Array.isArray(data?.[k])) out.push(...data[k]);
  return out;
}
function pickTodayMs(data) {
  return num(data?.dl?.sm, data?.sm, data?.dayLog?.sm, data?.todayStudyMs, data?.todayMs);
}
function parseDaySessions(data) {
  const candidateArrays = [
    data?.ls,
    data?.sessions,
    data?.logs,
    data?.items,
    data?.dl?.ls,
  ].filter(Array.isArray);
  const raw = candidateArrays.find(arr =>
    arr.some(x => x && typeof x === 'object' && (
      'st' in x || 'start' in x || 'startedAt' in x || 'et' in x || 'end' in x || 'endedAt' in x || 'du' in x || 'durationMs' in x || 'sm' in x || 'studyMs' in x
    ))
  ) || [];

  return raw.map((x, i) => {
    const start = parseTs(x.st ?? x.start ?? x.startedAt ?? x.s ?? x.from);
    const end = parseTs(x.et ?? x.end ?? x.endedAt ?? x.e ?? x.to);
    const durationMs = num(x.du, x.durationMs, x.duration, x.d, x.sm, x.studyMs, start && end ? end - start : 0);
    return {
      id: x.id ?? x.sid ?? i,
      label: `Session ${i + 1}`,
      range: start ? `${timeLabel(start)}${end ? ` - ${timeLabel(end)}` : ''}` : 'Time unavailable',
      durationMs,
    };
  }).filter(x => x.durationMs > 0);
}
function parseGroupLeaders(data) {
  const raw = Array.isArray(data)
    ? data
    : [data?.ms, data?.members, data?.users, data?.list].find(Array.isArray) || [];
  return raw
    .map((x, i) => ({
      id: x.ud ?? x.id ?? i,
      name: x.n ?? x.name ?? x.nickname ?? `Member ${i + 1}`,
      studyMs: num(x?.dl?.sm, x.sd, x.sm, x.studyMs),
      status: x.isStudy ? 'Studying now' : (x.st ? 'Active' : 'Today'),
    }))
    .sort((a, b) => b.studyMs - a.studyMs)
    .slice(0, 8);
}
function groupIdOf(group) {
  return group?.id ?? group?.groupID ?? group?.gid ?? group?.gd ?? null;
}
function groupNameOf(group) {
  return group?.t ?? group?.title ?? group?.n ?? group?.name ?? 'My Group';
}

function loadGoogleScript() {
  return new Promise((resolve, reject) => {
    if (window.google?.accounts?.oauth2) return resolve();
    const existing = document.querySelector('script[data-google-gis]');
    if (existing) {
      existing.addEventListener('load', resolve, { once: true });
      existing.addEventListener('error', reject, { once: true });
      return;
    }
    const s = document.createElement('script');
    s.src = 'https://accounts.google.com/gsi/client';
    s.async = true;
    s.defer = true;
    s.dataset.googleGis = '1';
    s.onload = resolve;
    s.onerror = () => reject(new Error('Could not load Google Sign-In.'));
    document.head.appendChild(s);
  });
}

function Login({ onDone }) {
  const [clientId, setClientId] = useState('');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');

  useEffect(() => {
    ypt.config().then(c => setClientId(c.googleClientId || '')).catch(e => setErr(e.message));
  }, []);

  async function signIn() {
    if (!clientId) {
      setErr('Google OAuth is not configured on this deployment yet.');
      return;
    }
    setBusy(true);
    setErr('');
    try {
      await loadGoogleScript();
      const credential = await new Promise((resolve, reject) => {
        const tokenClient = window.google.accounts.oauth2.initTokenClient({
          client_id: clientId,
          scope: 'openid email profile',
          callback: async r => {
            if (r.error) return reject(new Error(r.error_description || r.error));
            try {
              const meRes = await fetch('https://openidconnect.googleapis.com/v1/userinfo', {
                headers: { Authorization: `Bearer ${r.access_token}` },
              });
              if (!meRes.ok) throw new Error('Could not read Google profile.');
              const me = await meRes.json();
              resolve({ accessToken: r.access_token, providerId: `g${me.sub}`, email: me.email || '' });
            } catch (e) {
              reject(e);
            }
          },
        });
        tokenClient.requestAccessToken({ prompt: 'select_account' });
      });
      const data = await ypt.googleSignIn(credential);
      onDone(data);
    } catch (e) {
      setErr(e.message || String(e));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="loginShell">
      <div className="loginCard">
        <div className="brandMark">YPT</div>
        <h1>Yeolpumta Web</h1>
        <p className="muted">Sign in with the same Google account connected to your YPT account.</p>
        <button className="googleBtn" disabled={busy} onClick={signIn}>
          <span className="gLogo">G</span>
          {busy ? 'Connecting…' : 'Continue with Google'}
        </button>
        {err && <div className="error">{err}</div>}
        <p className="tiny">Google authentication happens with Google. Your Google password is never sent to this site.</p>
      </div>
    </div>
  );
}

function App() {
  const timerRef = useRef(null);
  const pipWindowRef = useRef(null);
  const [authed, setAuthed] = useState(null);
  const [user, setUser] = useState(null);
  const [subjects, setSubjects] = useState([]);
  const [groups, setGroups] = useState([]);
  const [todayMs, setTodayMs] = useState(0);
  const [daySessions, setDaySessions] = useState([]);
  const [groupLeaders, setGroupLeaders] = useState([]);
  const [leadGroupName, setLeadGroupName] = useState('');
  const [active, setActive] = useState(null);
  const [elapsed, setElapsed] = useState(0);
  const [loading, setLoading] = useState(false);
  const [err, setErr] = useState('');
  const [lastSync, setLastSync] = useState(null);
  const [fullScreen, setFullScreen] = useState(false);
  const [pipOpen, setPipOpen] = useState(false);
  const adjustmentKey = `ypt-web-adjustment:${today()}`;
  const [adjustmentMs, setAdjustmentMs] = useState(() => Number(localStorage.getItem(`ypt-web-adjustment:${today()}`)) || 0);

  async function loadDaySnapshot() {
    const day = await ypt.dayLog(today());
    setTodayMs(pickTodayMs(day));
    setDaySessions(parseDaySessions(day));
    return day;
  }

  async function loadGroupLeaderboard(nextGroups) {
    const list = nextGroups || groups;
    if (!list.length) {
      setGroupLeaders([]);
      setLeadGroupName('');
      return;
    }
    const primary = list[0];
    const gid = groupIdOf(primary);
    if (!gid) {
      setGroupLeaders([]);
      setLeadGroupName(groupNameOf(primary));
      return;
    }
    const data = await ypt.groupMembers(gid, 0);
    setGroupLeaders(parseGroupLeaders(data));
    setLeadGroupName(groupNameOf(primary));
  }

  async function hydrate(seed) {
    setLoading(true);
    setErr('');
    try {
      const info = seed?.s ? seed : await ypt.reloadInfo();
      const parsedSubjects = pickSubjects(info);
      const myGroups = flattenGroups(await ypt.myGroups()).filter(Boolean);
      setUser(info);
      setSubjects(parsedSubjects);
      setGroups(myGroups);
      setTodayMs(pickTodayMs(info));
      try { await loadDaySnapshot(); } catch {}
      try { await loadGroupLeaderboard(myGroups); } catch {}
      setAuthed(true);
      setLastSync(new Date());
    } catch (e) {
      setErr(e.message || String(e));
      if (/401|Not signed in/i.test(String(e.message))) setAuthed(false);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    (async () => {
      try {
        const ok = await ypt.isAuthenticated();
        setAuthed(ok);
        if (ok) await hydrate();
      } catch {
        setAuthed(false);
      }
    })();
  }, []);

  useEffect(() => {
    if (!active) return;
    const id = setInterval(() => setElapsed(Date.now() - active.startedAt), 1000);
    return () => clearInterval(id);
  }, [active]);

  useEffect(() => {
    if (!authed || active) return;
    const id = setInterval(async () => {
      try {
        await loadDaySnapshot();
        await loadGroupLeaderboard();
        setLastSync(new Date());
      } catch {}
    }, 15000);
    return () => clearInterval(id);
  }, [authed, active, groups]);

  useEffect(() => {
    const onChange = () => setFullScreen(Boolean(document.fullscreenElement));
    document.addEventListener('fullscreenchange', onChange);
    return () => document.removeEventListener('fullscreenchange', onChange);
  }, []);

  useEffect(() => {
    const pip = pipWindowRef.current;
    if (!pip || pip.closed) return;
    const total = Math.max(0, todayMs + (active ? elapsed : 0) + adjustmentMs);
    const timeEl = pip.document.getElementById('pip-time');
    const sessionEl = pip.document.getElementById('pip-session');
    if (timeEl) timeEl.textContent = fmt(total);
    if (sessionEl) sessionEl.textContent = `Current session ${fmt(active ? elapsed : 0)}`;
  }, [todayMs, elapsed, active, adjustmentMs]);

  function saveAdjustment(next) {
    const safe = Number.isFinite(next) ? Math.round(next) : 0;
    setAdjustmentMs(safe);
    if (safe === 0) localStorage.removeItem(adjustmentKey);
    else localStorage.setItem(adjustmentKey, String(safe));
  }

  function changeAdjustment(deltaMinutes) {
    saveAdjustment(adjustmentMs + deltaMinutes * 60 * 1000);
  }

  function customAdjustment() {
    const raw = window.prompt('Minutes to add or subtract for today. Examples: 15 or -10');
    if (raw === null) return;
    const minutes = Number(raw.trim());
    if (!Number.isFinite(minutes) || minutes === 0) {
      setErr('Enter a valid non-zero number of minutes, such as 15 or -10.');
      return;
    }
    setErr('');
    changeAdjustment(minutes);
  }

  async function togglePictureInPicture() {
    try {
      if (pipWindowRef.current && !pipWindowRef.current.closed) {
        pipWindowRef.current.close();
        pipWindowRef.current = null;
        setPipOpen(false);
        return;
      }
      if (!('documentPictureInPicture' in window)) {
        setErr('Picture-in-Picture timer needs a Chromium desktop browser that supports Document Picture-in-Picture. Try current Chrome or Edge.');
        return;
      }
      const pip = await window.documentPictureInPicture.requestWindow({ width: 390, height: 225 });
      pipWindowRef.current = pip;
      setPipOpen(true);
      pip.document.title = 'YPT Timer';
      const style = pip.document.createElement('style');
      style.textContent = `
        *{box-sizing:border-box}html,body{margin:0;width:100%;height:100%;background:#0d0f10;color:#f5f7f8;font-family:Inter,system-ui,-apple-system,Segoe UI,sans-serif}
        body{display:grid;place-items:center;padding:16px}.pipCard{text-align:center;width:100%}.pipLabel{font-size:12px;letter-spacing:1.5px;text-transform:uppercase;color:#8b9396}
        .pipTime{font-size:clamp(44px,15vw,74px);font-weight:800;letter-spacing:-3px;font-variant-numeric:tabular-nums;margin:8px 0 12px}.pipSession{font-size:13px;color:#aeb8b3}
        .pipDot{display:inline-block;width:8px;height:8px;border-radius:50%;background:#bff36b;margin-right:7px}`;
      pip.document.head.appendChild(style);
      pip.document.body.innerHTML = '<div class="pipCard"><div class="pipLabel"><span class="pipDot"></span>Full day study time</div><div class="pipTime" id="pip-time">00:00:00</div><div class="pipSession" id="pip-session">Current session 00:00:00</div></div>';
      pip.addEventListener('pagehide', () => {
        pipWindowRef.current = null;
        setPipOpen(false);
      }, { once: true });
      setErr('');
    } catch (e) {
      setErr(e.message || 'Could not open Picture-in-Picture timer.');
    }
  }

  async function startDefault() {
    setErr('');
    const fallbackSubject = subjects[0];
    if (!fallbackSubject) {
      setErr('Your YPT account has no available subject to start with. Add at least one subject in YPT first.');
      return;
    }
    try {
      const res = await ypt.studyStart(fallbackSubject.title);
      const startedAt = num(res?.dl?.startedAt, res?.startedAt, Date.now());
      setActive({ startedAt, subjectTitle: fallbackSubject.title });
      setElapsed(Date.now() - startedAt);
    } catch (e) {
      setErr(e.message || String(e));
    }
  }

  async function stopStudy() {
    if (!active) return;
    try {
      await ypt.studyStop(active.startedAt);
      setActive(null);
      setElapsed(0);
      await hydrate();
    } catch (e) {
      setErr(e.message || String(e));
    }
  }

  async function toggleFullScreen() {
    const el = timerRef.current;
    if (!el) return;
    try {
      if (document.fullscreenElement) await document.exitFullscreen();
      else await el.requestFullscreen();
    } catch (e) {
      setErr(e.message || 'Could not change fullscreen mode.');
    }
  }

  if (authed === null) return <div className="center">Checking session…</div>;
  if (!authed) return <Login onDone={hydrate} />;
  if (loading && !user) return <div className="center">Loading your YPT account…</div>;

  const name = pickName(user);
  const displayTodayMs = Math.max(0, todayMs + (active ? elapsed : 0) + adjustmentMs);
  const currentSessionMs = active ? elapsed : 0;
  const currentSessionCount = daySessions.length;
  const lastSyncText = lastSync ? lastSync.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' }) : '—';

  return (
    <div className="pageWrap">
      <div className="homePage">
        <header className="topbar">
          <div>
            <div className="eyebrow">YEOLPUMTA WEB</div>
            <h1>{name}</h1>
            <p className="muted topNote">Full-day study view with quick start, session summary, and group ranking.</p>
          </div>
          <div className="topActions">
            <button className="actionBtn" onClick={() => hydrate()}><RefreshCw size={16} /> Sync</button>
            <button className="actionBtn" onClick={toggleFullScreen}>{fullScreen ? <Shrink size={16} /> : <Expand size={16} />}{fullScreen ? 'Exit fullscreen' : 'Fullscreen timer'}</button>
            <button className="actionBtn" onClick={togglePictureInPicture}><Clock3 size={16} /> {pipOpen ? 'Close PiP' : 'PiP timer'}</button>
            <button className="actionBtn" onClick={async () => { await ypt.signOut(); location.reload(); }}><LogOut size={16} /> Sign out</button>
          </div>
        </header>

        {err && <div className="error banner">{err}</div>}

        <section className="homeGrid">
          <div ref={timerRef} className="focusCard">
            <div className="chipRow">
              <span className="statusPill"><span className="dot" />Connected to YPT</span>
              {leadGroupName ? <span className="softPill"><Users size={14} /> {leadGroupName}</span> : null}
            </div>

            <div className="metricLabel">Full day study time</div>
            <div className="bigTime">{fmt(displayTodayMs)}</div>
            <div className="focusSub">{active ? 'Running live on the web timer' : 'Synced from your YPT account'}</div>

            <div className="correctionBar">
              <span className="correctionLabel">Manual correction {adjustmentMs ? `(${adjustmentMs > 0 ? '+' : ''}${Math.round(adjustmentMs / 60000)} min)` : ''}</span>
              <div className="correctionButtons">
                <button onClick={() => changeAdjustment(-5)}>−5 min</button>
                <button onClick={() => changeAdjustment(5)}>+5 min</button>
                <button onClick={customAdjustment}>Custom</button>
                {adjustmentMs !== 0 ? <button onClick={() => saveAdjustment(0)}>Reset</button> : null}
              </div>
            </div>

            <div className="statRow">
              <div className="miniStat">
                <span>This session duration</span>
                <strong>{fmt(currentSessionMs)}</strong>
              </div>
              <div className="miniStat">
                <span>Full day sessions</span>
                <strong>{currentSessionCount}</strong>
              </div>
            </div>

            <div className="actionRow">
              {!active ? (
                <button className="primaryButton" onClick={startDefault} disabled={loading || !subjects.length}>
                  <Play size={18} fill="currentColor" /> Start
                </button>
              ) : (
                <button className="dangerButton" onClick={stopStudy}>
                  <Square size={18} fill="currentColor" /> Stop
                </button>
              )}
              <button className="secondaryButton" onClick={toggleFullScreen}>{fullScreen ? <Shrink size={18} /> : <Expand size={18} />}{fullScreen ? 'Exit fullscreen' : 'Make full screen'}</button>
              <button className="secondaryButton" onClick={togglePictureInPicture}><Clock3 size={18} />{pipOpen ? 'Close PiP' : 'Picture in Picture'}</button>
            </div>
            <p className="tiny note">The start button uses your first available YPT subject in the background. Manual corrections change this web view only and do not rewrite YPT's server-side records.</p>
          </div>

          <div className="sideCard">
            <div className="sideStat">
              <div className="sideLabel"><Clock3 size={16} /> Current session</div>
              <div className="sideValue">{fmt(currentSessionMs)}</div>
            </div>
            <div className="sideStat">
              <div className="sideLabel"><BookOpenCheck size={16} /> Session entries today</div>
              <div className="sideValue">{currentSessionCount}</div>
            </div>
            <div className="sideStat">
              <div className="sideLabel"><RefreshCw size={16} /> Last sync</div>
              <div className="sideValue small">{lastSyncText}</div>
            </div>
            <div className="sideHint">Phone-side changes auto-refresh about every 15 seconds when no web session is running.</div>
          </div>
        </section>

        <section className="panelGrid">
          <div className="panel">
            <div className="panelHead">
              <div>
                <h3>Full day sessions and durations</h3>
                <p className="muted">Every session row below is pulled from YPT when session-level data is available.</p>
              </div>
            </div>
            <div className="listStack">
              {daySessions.length ? daySessions.map(item => (
                <div className="listItem" key={item.id}>
                  <div className="itemMeta">
                    <strong>{item.label}</strong>
                    <span>{item.range}</span>
                  </div>
                  <div className="durationText">{fmt(item.durationMs)}</div>
                </div>
              )) : <div className="empty">YPT did not return a session-by-session breakdown for today yet.</div>}
              {adjustmentMs !== 0 ? (
                <div className="listItem correctionRow">
                  <div className="itemMeta"><strong>Manual correction</strong><span>Web-only adjustment for today</span></div>
                  <div className="durationText">{adjustmentMs > 0 ? '+' : '−'}{fmt(Math.abs(adjustmentMs))}</div>
                </div>
              ) : null}
            </div>
          </div>

          <div className="panel">
            <div className="panelHead">
              <div>
                <h3>Group top study time readers</h3>
                <p className="muted">Showing the top study-time members from your first joined YPT group.</p>
              </div>
            </div>
            <div className="listStack">
              {groupLeaders.length ? groupLeaders.map((member, idx) => (
                <div className="rankRow" key={member.id}>
                  <div className="rankLeft">
                    <div className="rankBadge">{idx + 1}</div>
                    <div className="itemMeta">
                      <strong>{member.name}</strong>
                      <span>{member.status}</span>
                    </div>
                  </div>
                  <div className="durationText rankTime"><Trophy size={15} /> {fmt(member.studyMs)}</div>
                </div>
              )) : <div className="empty">No group leaderboard data returned yet. Join a YPT group or press Sync.</div>}
            </div>
          </div>
        </section>
      </div>
    </div>
  );
}

createRoot(document.getElementById('root')).render(<App />);
