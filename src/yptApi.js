const DEVICE_MODEL = 'SM-S921N';
async function request(path, { method = 'GET', body } = {}) {
  const res = await fetch(path, { method, headers: { 'Content-Type': 'application/json' }, credentials: 'same-origin', body: body === undefined ? undefined : JSON.stringify(body) });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data?.error || data?.c || `HTTP ${res.status}`);
  return data;
}
export class YptApi {
  config(){ return request('/api/config'); }
  async isAuthenticated(){ return (await request('/api/auth/status')).authenticated; }
  googleSignIn(payload){ return request('/api/auth/google-ypt',{method:'POST',body:payload}); }
  signOut(){ return request('/api/auth/logout',{method:'POST',body:{}}); }
  reloadInfo(){ return request('/api/ypt/reload-info',{method:'POST',body:{pv:0,cd:{su:null,sbu:null,cu:null,eu:null,du:null,tu:null}}}); }
  myGroups(){ return request('/api/ypt/my-groups'); }
  studyStart(subject,taskId=null){ return request('/api/ypt/study-start',{method:'POST',body:{subject,deviceModel:DEVICE_MODEL,taskId}}); }
  studyStop(startedAt){ return request('/api/ypt/study-stop',{method:'POST',body:{startedAt,deviceModel:DEVICE_MODEL}}); }
  dayLog(date){ return request(`/api/ypt/day-log?date=${encodeURIComponent(date)}`); }
  groupMembers(groupId,countryId=0){ return request(`/api/ypt/group-members?groupId=${encodeURIComponent(groupId)}&countryId=${encodeURIComponent(countryId)}`); }
  categoryRanks({categoryId=0,countryId=0,type='day',page=1,date}){ return request(`/api/ypt/category-ranks?categoryId=${categoryId}&countryId=${countryId}&type=${type}&page=${page}&date=${encodeURIComponent(date)}`); }
  myCategoryRank(categoryId=0,countryId=0){ return request(`/api/ypt/my-category-rank?categoryId=${categoryId}&countryId=${countryId}`); }
}
export const ypt=new YptApi();
