import { createClient } from 'https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2.49.4/+esm';
import { SUPABASE_URL, SUPABASE_KEY } from './config.js';
import { readBankFile, plan } from './importer.js';

const sb = createClient(SUPABASE_URL, SUPABASE_KEY);
const $ = id => document.getElementById(id);

// ───────── 규칙 ─────────
const FOOD = ['장보기','외식','배달','카페·간식'];
const CATS = ['장보기','외식','배달','카페·간식','쇼핑','운동','문화·여가','기타','주거','통신','공과금','구독','교통','저축·투자'];
const FIXED_OPTS = ['주거','통신','공과금','구독','교통','저축·투자'];
const SPLIT = { solo:'혼자', together:'같이', half:'반반', treat:'상대 몫 대신' };
// 2026-11-09부터 송금 없이 각자 40만 원: 고르는 건 혼자/같이만 (반반·대신은 예전 기록용)
const SPLIT_PICK = ['solo', 'together'];
const SOLO_PAGE = 15;
const FOOD_START = '2026-11-17';   // 식비를 제대로 계산하기 시작하는 주기(10/17 주기는 맛보기). 이보다 앞 주기와는 비교하지 않음
// 고정비 목록 밖에서 들어온 결제라도 이 분류면 고정비로 셈 (구독·통신·주거·공과금)
const FIXED_LIKE = ['구독','통신','주거','공과금'];

// ───────── 상태 ─────────
let me = null;            // 내 user id
let members = {};         // id → {name, food_limit}
let partner = null;       // 상대 id
let extras = [];          // 내 월급 밖 수입(시험 감독 등)
let income = [];          // 내 월급 [{cycle_start, amt, paid_on, memo}]
let entries = [];         // 이번 주기 + 지난 주기 (RLS로 보이는 것만)
let fixed = [];           // 내 고정비
let fixedPaid = [];       // 주기마다 실제로 나간 고정비
let partnerHidden = 0;    // 상대가 혼자 먹은 식비(합계만 받음)
let cycOffset = 0;        // 0 = 이번 주기
let soloShown = SOLO_PAGE;
let dupIds = new Set();
let fixedClash = new Map();   // 기록 id → 겹치는 고정비 이름

// ───────── 날짜·주기 (17일 ~ 다음 달 16일) ─────────
const pad = n => String(n).padStart(2, '0');
const ymd = d => `${d.getFullYear()}-${pad(d.getMonth()+1)}-${pad(d.getDate())}`;
const todayStr = () => ymd(new Date());
function cycleAt(offset){
  const t = new Date(); let y = t.getFullYear(), m = t.getMonth();
  if (t.getDate() < 17) m -= 1;
  m += offset;
  const s = new Date(y, m, 17), e = new Date(y, m + 1, 16);
  return { start: ymd(s), end: ymd(e), s, e };
}
// 날짜가 속한 주기의 시작일
function cycleStartOf(s){ const d = new Date(s); let y = d.getFullYear(), m = d.getMonth(); if (d.getDate() < 17) m -= 1; return ymd(new Date(y, m, 17)); }
// 월급날: 17일, 토요일이면 16일, 일요일이면 15일
function payday(start){ const d = new Date(start); const w = d.getDay(); if (w === 6) d.setDate(16); if (w === 0) d.setDate(15); return ymd(d); }
const salaryOf = start => income.find(x => x.cycle_start === start) || null;
const dayDiff = (a, b) => Math.round((new Date(b) - new Date(a)) / 864e5);
const md = s => { const [, m, d] = s.split('-'); return { m: +m, d: +d }; };
const addDays = (s, n) => { const d = new Date(s); d.setDate(d.getDate() + n); return ymd(d); };

// ───────── 계산 ─────────
const won = n => Math.round(n).toLocaleString('ko-KR') + '원';
const man = n => { const v = n / 10000; return (Math.abs(v) >= 100 ? Math.round(v) : Number.isInteger(v) ? v : v.toFixed(1)) + '만 원'; };
const isFood = e => FOOD.includes(e.cat);
const isJoint = e => e.split !== 'solo';
function share(e, who){
  if (e.canceled) return 0;
  if (e.split === 'solo' || e.split === 'together') return e.payer === who ? e.amt : 0;
  if (e.split === 'half')  return e.amt / 2;
  if (e.split === 'treat') return e.payer === who ? 0 : e.amt;
  return 0;
}
const nm = id => members[id]?.name || '상대';
const josa = (w, a, b) => { const c = w.charCodeAt(w.length - 1); return (c >= 0xAC00 && c <= 0xD7A3 && (c - 0xAC00) % 28) ? a : b; };
const esc = t => String(t ?? '').replace(/[&<>"]/g, c => ({ '&':'&amp;', '<':'&lt;', '>':'&gt;', '"':'&quot;' }[c]));
const dateBox = s => { const { m, d } = md(s); return `<div class="date"><s>${m}월</s><b>${d}</b></div>`; };
const paidOf = (f, start) => fixedPaid.find(p => p.fixed_id === f.id && p.cycle_start === start) || null;
const fixedAmt = (f, start) => paidOf(f, start)?.amt ?? f.amt;
const fixedRows = (start) => fixed.map(f => ({ id: f.id, d: start, place: f.name, amt: fixedAmt(f, start), cat: f.cat, payer: me, split: 'solo', fixed: true, save: f.cat === '저축·투자' }));

const ICON_CUP = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M5 9h11v5a5 5 0 0 1-5 5h-1a5 5 0 0 1-5-5z"/><path d="M16 11h1.5a2.5 2.5 0 0 1 0 5H16"/><path d="M9 3c0 1.5 1 1.5 1 3M12 3c0 1.5 1 1.5 1 3"/></svg>';
const ICON_ARROW = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="M5 12h14"/><path d="m13 6 6 6-6 6"/></svg>';

function toast(msg){
  const t = $('toast'); t.textContent = msg; t.classList.add('on');
  clearTimeout(toast.t); toast.t = setTimeout(() => t.classList.remove('on'), 2600);
}

// ───────── 불러오기 ─────────
async function loadAll(){
  const cyc = cycleAt(cycOffset), prev = cycleAt(cycOffset - 1);
  const [ent, fx, inc, ft, ex, fp] = await Promise.all([
    sb.from('gb_entries').select('*').gte('d', prev.start).lte('d', cyc.end).order('d').order('created_at'),
    sb.from('gb_fixed').select('*').order('sort').order('created_at'),
    sb.from('gb_income').select('*').order('cycle_start'),
    sb.rpc('gb_food_totals', { p_start: cyc.start, p_end: cyc.end }),
    sb.from('gb_extra').select('*').gte('d', addDays(cyc.end, -366)).order('d', { ascending: false }),
    sb.from('gb_fixed_paid').select('*').gte('cycle_start', prev.start).lte('cycle_start', cyc.start),
  ]);
  for (const r of [ent, fx, inc, ft, ex, fp]) if (r.error) { toast('불러오지 못했어요. 새로고침해 주세요'); console.error(r.error); return; }
  entries = ent.data; fixed = fx.data; income = inc.data; extras = ex.data; fixedPaid = fp.data;
  // 상대의 혼자 먹은 식비 = 전체 합계 − 내가 볼 수 있는 같이 먹은 기록의 상대 몫
  if (partner){
    const tot = ft.data.find(x => x.user_id === partner)?.food || 0;
    const visible = entries.filter(e => e.d >= cyc.start && e.d <= cyc.end && isFood(e)).reduce((s, e) => s + share(e, partner), 0);
    partnerHidden = Math.max(0, tot - visible);
  }
  render();
}
let reloadT;
const reloadSoon = () => { clearTimeout(reloadT); reloadT = setTimeout(() => { if (!cur) loadAll(); }, 500); };

// ───────── 그리기 ─────────
function render(){
  const W = me, O = partner;
  const cyc = cycleAt(cycOffset), prev = cycleAt(cycOffset - 1);
  const today = todayStr();
  const inCyc = e => e.d >= cyc.start && e.d <= cyc.end;
  const rows = [...entries.filter(inCyc), ...fixedRows(cyc.start)];
  // 중복 의심: 같은 사람·같은 날·같은 금액이 2건 이상 (취소 제외)
  dupIds = new Set();
  const seen = {};
  for (const e of entries){ if (e.canceled || !e.amt) continue; const k = e.payer + '|' + e.d + '|' + e.amt; (seen[k] = seen[k] || []).push(e.id); }
  for (const ids of Object.values(seen)) if (ids.length > 1) ids.forEach(id => dupIds.add(id));
  // 고정비 '엑셀 이름'과 겹치는 내 기록 → 고정비와 두 번 셀 수 있음
  fixedClash = new Map();
  const nz = t => String(t || '').replace(/\s/g, '').toLowerCase();
  const keys = fixed.flatMap(f => String(f.keys || '').split(',').map(nz).filter(k => k.length >= 2).map(k => [k, f.name]));
  for (const e of entries){ if (e.canceled || e.payer !== me) continue; const p = nz(e.place); const hit = keys.find(([k]) => p.includes(k)); if (hit){ fixedClash.set(e.id, hit[1]); dupIds.add(e.id); } }
  const { m: sm, d: sd } = md(cyc.start), { m: em, d: ed } = md(cyc.end);
  const left = dayDiff(today, cyc.end);
  $('cyclePill').textContent = `${sm}월 주기` + (cycOffset === 0 ? ` · ${left}일 남음` : cycOffset < 0 ? ' · 지난 주기' : ' · 다음 주기');
  $('cycleSub').textContent = `${sm}월 ${sd}일 – ${em}월 ${ed}일`;
  $('zoneMine').textContent = `${nm(W)} 것`;
  showTab();
  $('meName').textContent = nm(W);

  // ── 같이: 식비판
  const lim = { [W]: members[W].food_limit, ...(O ? { [O]: members[O].food_limit } : {}) };
  const food = rows.filter(e => !e.fixed && isFood(e));
  const f = { [W]: food.reduce((s, e) => s + share(e, W), 0) };
  if (O) f[O] = food.reduce((s, e) => s + share(e, O), 0) + partnerHidden;
  const cap = Object.values(lim).reduce((a, b) => a + b, 0);
  const tot = Object.values(f).reduce((a, b) => a + b, 0);
  $('foodCap').textContent = O ? `둘이 합쳐 ${man(cap)}` : man(cap);
  $('foodTotal').innerHTML = `${won(tot)} <span style="font-size:18px;color:var(--faint);font-weight:600">/ ${won(cap)}</span>`;
  $('foodBar').style.width = Math.min(100, tot / cap * 100) + '%';
  $('foodBar').style.background = tot > cap ? 'var(--red)' : 'var(--yellow)';
  $('pair').innerHTML = (O ? [W, O] : [W]).map(w => {
    const used = f[w], rest = lim[w] - used, pct = Math.min(100, used / lim[w] * 100);
    const col = rest < 0 ? 'var(--red)' : rest < lim[w] * .1 ? 'var(--yellow)' : 'var(--green)';
    const txt = rest < 0 ? `<span class="over">${won(-rest)} 초과</span>` : rest < 1000 ? '<span class="warn">다 씀</span>' : `<span class="ok">${won(rest)} 남음</span>`;
    return `<div class="who"><div class="n">${esc(nm(w))}</div><div class="v">${won(used)} <span>/ ${man(lim[w])}</span></div><div class="bar"><i style="width:${pct}%;background:${col}"></i></div><div class="left">${txt}</div></div>`;
  }).join('');
  let msg = '';
  if (O){
    const rm = lim[W] - f[W], ro = lim[O] - f[O];
    if (rm <= 0 && ro <= 0) msg = '둘 다 이번 주기 식비를 다 썼어요';
    else if (rm <= 0) msg = `다음 식비는 ${nm(O)} 카드로 · ${won(ro)} 남음`;
    else if (ro <= 0) msg = `다음 식비는 ${nm(W)} 카드로 · ${won(rm)} 남음`;
    else msg = rm < ro ? `다음 식비는 ${nm(O)} 카드로 · 남은 돈 차이 ${won(ro - rm)}` : rm > ro ? `다음 식비는 ${nm(W)} 카드로 · 남은 돈 차이 ${won(rm - ro)}` : '남은 돈이 같아요';
  } else msg = '상대 계정이 연결되면 둘이 같이 보여요';
  $('next').innerHTML = `<div class="next">${ICON_ARROW}${esc(msg)}</div>`;

  // ── 같이: 정산 (주기 상관없이 아직인 것 전부)
  const due = entries.filter(e => e.split === 'half' && !e.settled && !e.canceled);
  $('dueCount').textContent = `${due.length}건`;
  $('dueCard').hidden = !due.length; $('foodCard').classList.toggle('c12', !due.length); $('foodCard').classList.toggle('c7', !!due.length);   // 송금 없이 각자 40만 원 → 예전 반반이 남았을 때만
  $('due').innerHTML = due.length ? due.map(e => `
    <div class="it fx" data-row="${e.id}">${dateBox(e.d)}
      <div class="p">${esc(e.place) || '제목 없음'}<small>${esc(nm(e.payer === W ? O : W))} → ${esc(nm(e.payer))} · 전체 ${won(e.amt)}</small></div>
      <div class="a">${won(e.amt / 2)}<br><button class="mini" data-settle="${e.id}">${e.payer === W ? '받음' : '보냄'}</button></div>
    </div>`).join('') : '<div class="empty">모두 정산했어요</div>';
  const net = due.reduce((s, e) => s + (e.payer === W ? 1 : -1) * e.amt / 2, 0);
  $('dueTotal').innerHTML = !due.length ? '<span>남은 정산</span><b>0원</b>'
    : net >= 0 ? `<span>${esc(nm(O))}${josa(nm(O), '이', '가')} 보낼 돈</span><b>${won(net)}</b>` : `<span>내가 보낼 돈</span><b>${won(-net)}</b>`;

  // ── 같이: 같이 먹은 기록
  const joint = rows.filter(isJoint).reverse();
  $('joint').innerHTML = joint.length ? joint.map(rowHtml).join('') : '<div class="none">기록 없음</div>';

  // ── 나만: 도넛
  const GROUPS = [
    ['저축·투자', 'var(--blue)', e => e.save],
    ['고정비', 'var(--gray)', e => (e.fixed && !e.save) || (!e.fixed && FIXED_LIKE.includes(e.cat))],
    ['식비·디저트', 'var(--yellow)', e => !e.fixed && isFood(e)],
    ['생활·취미', 'var(--green)', e => !e.fixed && !isFood(e) && !FIXED_LIKE.includes(e.cat)],
  ];
  const sums = GROUPS.map(g => rows.filter(g[2]).reduce((s, e) => s + share(e, W), 0));
  const myTot = sums.reduce((a, b) => a + b, 0);
  $('myTotal').textContent = man(myTot);
  const R = 84, C = 2 * Math.PI * R, GAP = 14; let off = 0, arcs = '';
  if (myTot > 0) sums.forEach((v, i) => {
    if (v <= 0) return; const len = v / myTot * C, vis = Math.max(0.1, len - GAP);
    arcs += `<circle cx="110" cy="110" r="${R}" fill="none" stroke="${GROUPS[i][1]}" stroke-width="16" stroke-linecap="round" stroke-dasharray="${vis} ${C - vis}" stroke-dashoffset="${-off - GAP / 2}" transform="rotate(-90 110 110)"/>`;
    off += len;
  });
  $('donut').innerHTML = arcs || `<circle cx="110" cy="110" r="${R}" fill="none" stroke="var(--track)" stroke-width="16"/>`;
  $('legend').innerHTML = GROUPS.map((g, i) => sums[i] ? `<div><i style="background:${g[1]}"></i><span>${g[0]}<em>${Math.round(sums[i] / myTot * 100)}%</em></span><b>${won(sums[i])}</b></div>` : '').join('');

  // ── 나만: 예산
  const fixedSum = fixed.filter(x => x.cat !== '저축·투자').reduce((s, x) => s + fixedAmt(x, cyc.start), 0);
  const saveSum = fixed.filter(x => x.cat === '저축·투자').reduce((s, x) => s + fixedAmt(x, cyc.start), 0);
  const sal = salaryOf(cyc.start), salary = sal?.amt ?? null;
  const extraIn = extras.filter(x => x.d >= cyc.start && x.d <= cyc.end).reduce((s, x) => s + x.amt, 0);
  const totalIn = (salary || 0) + extraIn;
  const pd = payday(cyc.start), { m: pm, d: pdd } = md(pd);
  $('salary').innerHTML = sal
    ? `<div class="salary" data-salary><span>월급${sal.paid_on ? ` · ${md(sal.paid_on).m}/${md(sal.paid_on).d}` : ''}</span><b>${won(sal.amt)}</b></div>${extraIn ? `<div class="salary sub2"><span>부수입</span><b>+${won(extraIn)}</b></div>` : ''}`
    : `<div class="salary ${today >= pd ? 'due-now' : ''}" data-salary><span>월급 넣기 · ${pm}월 ${pdd}일</span><b>+</b></div>`;
  const BUD = [['식비·디저트 (내 몫)', lim[W], GROUPS[2][2]]];
  if (totalIn){
    BUD.unshift([extraIn ? '들어온 돈에서 쓴 돈' : '월급에서 쓴 돈', totalIn, () => true]);
    BUD.push(['생활·취미', totalIn - fixedSum - saveSum - lim[W], GROUPS[3][2]]);
  }
  $('bud').innerHTML = BUD.map(([n, l, fn]) => {
    const used = rows.filter(fn).reduce((s, e) => s + share(e, W), 0), rest = l - used;
    const col = rest < 0 ? 'var(--red)' : l > 0 && rest / l < .15 ? 'var(--yellow)' : 'var(--green)';
    const t = rest < 0 ? `<span class="over">${won(-rest)} 초과</span>` : `<span style="color:var(--muted)">${won(rest)} 남음</span>`;
    return `<div class="row"><div class="t"><span>${n}</span>${t}</div><div class="bar"><i style="width:${l > 0 ? Math.min(100, used / l * 100) : 100}%;background:${col}"></i></div></div>`;
  }).join('');

  // ── 나만: 고정비
  const fx = [...fixed].sort((a, b) => (a.cat === '저축·투자') - (b.cat === '저축·투자') || a.sort - b.sort);
  $('fixed').innerHTML = fx.length ? fx.map(x => `
    <div class="it fx" data-fixed="${x.id}" style="grid-template-columns:1fr auto"><div class="p">${esc(x.name) || '제목 없음'}${x.memo ? '<span class="memo-dot"></span>' : ''}<small>${x.cat}${x.vary ? ' · 변동' : ''}${paidOf(x, cyc.start) ? ` · <span class="ok">${paidOf(x, cyc.start).paid_on ? md(paidOf(x, cyc.start).paid_on).m + '/' + md(paidOf(x, cyc.start).paid_on).d + ' ' : ''}나감</span>` : ' · 예상'}</small></div><div class="a">${won(fixedAmt(x, cyc.start))}</div></div>`).join('') : '<div class="none">고정비 없음</div>';
  $('fixedTotal').innerHTML = `<span>합계${saveSum ? ` · 저축 ${man(saveSum)} 별도` : ''}</span><b>${won(fixedSum)}</b>`;

  // ── 나만: 시험 감독 (월급과 따로)
  const exCyc = extras.filter(x => x.d >= cyc.start && x.d <= cyc.end);
  const exYear = extras.filter(x => x.d > addDays(cyc.end, -365) && x.d <= cyc.end);
  const sumOf = a => a.reduce((s, x) => s + x.amt, 0);
  $('extraTotal').innerHTML = `${won(sumOf(exCyc))} <span style="font-size:16px;color:var(--faint);font-weight:600">이번 주기</span>`;
  $('extraYear').textContent = `1년 ${man(sumOf(exYear))} · ${exYear.length}번`;
  $('extraKinds').innerHTML = ['시험 감독', '보강비', '기타 수입'].map(k => { const a = exYear.filter(x => x.kind === k); return a.length ? `<span class="kind"><b>${k}</b> ${won(sumOf(a))} · ${a.length}번</span>` : ''; }).join('');
  $('extra').innerHTML = extras.filter(x => x.d <= cyc.end).slice(0, 6).map(x => `
    <div class="it fx" data-extra="${x.id}">${dateBox(x.d)}<div class="p">${esc(x.place) || '제목 없음'}${x.memo ? '<span class="memo-dot"></span>' : ''}<small>${x.kind}</small></div><div class="a" style="color:var(--green)">+${won(x.amt)}</div></div>`).join('') || '<div class="none">기록 없음</div>';

  // ── 나만: 식비 달력 + 지난 주기 같은 기간 비교
  const byDay = {}; food.forEach(e => { const v = share(e, W); if (v) byDay[e.d] = (byDay[e.d] || 0) + v; });
  $('calTotal').textContent = won(f[W]);
  const upto = cycOffset === 0 ? Math.min(dayDiff(cyc.start, today), dayDiff(cyc.start, cyc.end)) : dayDiff(cyc.start, cyc.end);
  const prevUntil = addDays(prev.start, upto);
  const prevFood = entries.filter(e => e.d >= prev.start && e.d <= prevUntil && isFood(e)).reduce((s, e) => s + share(e, W), 0);
  const tag = $('calTag');
  if (prevFood > 0 && prev.start >= FOOD_START){
    const p = Math.round((f[W] - prevFood) / prevFood * 100);
    tag.textContent = p === 0 ? '지난 주기 같은 기간과 같음' : `지난 주기 같은 기간보다 ${Math.abs(p)}% ${p > 0 ? '많음' : '적음'}`;
    tag.hidden = false;
  } else tag.hidden = true;
  let cal = ['일','월','화','수','목','금','토'].map(h => `<div class="h">${h}</div>`).join('');
  for (let i = 0; i < cyc.s.getDay(); i++) cal += '<div></div>';
  for (let d = new Date(cyc.s); d <= cyc.e; d.setDate(d.getDate() + 1)){
    const k = ymd(d), v = byDay[k] || 0;
    const cls = ['d', v >= 40000 ? 'f2' : v > 0 ? 'f' : '', k === today ? 'today' : '', k > today ? 'fut' : ''].join(' ');
    cal += `<div class="${cls}" title="${k}${v ? ' ' + won(v) : ''}">${v ? ICON_CUP : d.getDate()}</div>`;
  }
  $('cal').innerHTML = cal;

  // ── 나만: 혼자 쓴 기록
  const solo = rows.filter(e => !e.fixed && e.payer === W && !isJoint(e)).reverse();
  $('soloCount').textContent = `${solo.length}건`;
  $('list').innerHTML = solo.length ? solo.slice(0, soloShown).map(rowHtml).join('') : '<div class="none">기록 없음</div>';
  $('soloMore').hidden = solo.length <= soloShown;
}

function rowHtml(e){
  const mine = share(e, me);
  const payerChip = isJoint(e) ? `<span class="chip ${e.payer === me ? '' : 'gf'}">${esc(nm(e.payer))} 결제</span>` : '';
  return `<div class="it ${e.canceled ? 'canceled' : ''}" data-row="${e.id}">${dateBox(e.d)}
    <div><div class="p">${esc(e.place) || '<span style="color:var(--faint)">제목 없음</span>'}${e.memo ? '<span class="memo-dot" title="메모 있음"></span>' : ''}</div>
      <div class="chips"><span class="chip ${e.cat === '미분류' ? 'warn' : ''}">${e.cat}</span>${payerChip}${isJoint(e) ? `<span class="chip ${e.split}">${SPLIT[e.split]}</span>` : ''}${e.split === 'half' && e.settled ? '<span class="chip">정산 끝</span>' : ''}${e.canceled ? '<span class="chip treat">취소됨</span>' : ''}${dupIds.has(e.id) ? '<span class="chip warn">중복?</span>' : ''}${e.amt < 0 ? '<span class="chip">환불</span>' : ''}</div></div>
    <div class="a">${won(e.amt)}${isJoint(e) && e.split !== 'together' ? `<small>내 몫 ${won(mine)}</small>` : ''}${!isJoint(e) && isFood(e) && !e.canceled && e.payer === me ? `<br><button class="mini" data-half="${e.id}">같이</button>` : ''}</div>
  </div>`;
}

// ───────── 저장 ─────────
const pending = new Map();   // id → {table, patch}
let flushT;
function queueSave(table, id, patch){
  const p = pending.get(id) || { table, patch: {} };
  Object.assign(p.patch, patch); pending.set(id, p);
  $('saving').textContent = '저장 중…';
  clearTimeout(flushT); flushT = setTimeout(flush, 450);
}
async function flush(){
  const jobs = [...pending.entries()]; pending.clear();
  let bad = false;
  for (const [id, { table, patch }] of jobs){
    const q = table === 'gb_income'
      ? (patch.amt ? sb.from('gb_income').upsert({ owner: me, ...patch }) : sb.from('gb_income').delete().eq('owner', me).eq('cycle_start', patch.cycle_start))
      : sb.from(table).update(patch).eq('id', id);
    const { error } = await q;
    if (error){ bad = true; console.error(error); }
  }
  $('saving').textContent = bad ? '저장 못 함' : '저장됨';
  if (bad){ toast('저장하지 못했어요. 다시 불러올게요'); loadAll(); }
}

function saveIncome(o){
  const i = income.findIndex(x => x.cycle_start === o.cycle_start);
  if (o.amt){ if (i < 0) income.push(o); else income[i] = o; } else if (i >= 0) income.splice(i, 1);
  queueSave('gb_income', 'inc:' + o.cycle_start, { cycle_start: o.cycle_start, amt: o.amt, paid_on: o.paid_on || payday(o.cycle_start), memo: o.memo || '' });
}

// ───────── 노션식 상세 창 ─────────
let cur = null;   // {kind:'row'|'fixed'|'salary'|'settings', obj, isNew}
const fmt = n => (n || n === 0) && n !== '' ? Number(n).toLocaleString('ko-KR') : '';
const opts = (key, list, val, label = x => x) => `<div class="opts" data-opt="${key}">${list.map(v => `<button data-v="${esc(v)}" class="${v === val ? 'on' : ''}">${esc(label(v))}</button>`).join('')}</div>`;
const prop = (k, inner) => `<div class="prop"><span class="k">${k}</span><div>${inner}</div></div>`;

function sheetHtml(){
  const { kind, obj: o } = cur;
  if (kind === 'settings') return `<input class="sh-title" value="${esc(nm(me))}" readonly>
    <div class="sh-sec">휴대폰 자동 기록 열쇠</div>
    <div class="hint">아이폰 단축어·갤럭시 MacroDroid에 넣는 열쇠예요. 새로 만들면 예전 열쇠는 더 이상 안 돼요.</div>
    ${o.key ? `<div class="keybox" id="keyText">${o.key}</div><button class="sh-btn dark" data-copy>복사</button>` : ''}
    <button class="sh-btn" data-issue>${o.key ? '다시 만들기' : '열쇠 만들기'}</button>
    <div class="sh-sec">계정</div>
    <button class="sh-btn" data-logout>로그아웃</button>`;
  if (kind === 'salary'){ const { m, d } = md(o.cycle_start); return `<input class="sh-title" value="${m}월 주기 월급" readonly>
    ${prop('금액', `<input class="num" data-f="salary" inputmode="numeric" value="${fmt(o.amt)}">`)}
    ${prop('받은 날', `<input type="date" data-f="paid_on" value="${o.paid_on || payday(o.cycle_start)}">`)}
    <div class="sh-hr"></div>
    <textarea class="memo" data-f="memo" placeholder="메모" maxlength="2000">${esc(o.memo)}</textarea>`; }
  if (kind === 'import') return importHtml();
  if (kind === 'extra') return `<input class="sh-title" data-f="place" placeholder="어디서" maxlength="80" value="${esc(o.place)}">
    ${prop('날짜', `<input type="date" data-f="d" value="${o.d}">`)}
    ${prop('금액', `<input class="num" data-f="amt" inputmode="numeric" value="${fmt(o.amt)}">`)}
    ${prop('종류', opts('kind', ['시험 감독', '보강비', '기타 수입'], o.kind))}
    <div class="sh-hr"></div>
    <textarea class="memo" data-f="memo" placeholder="메모" maxlength="2000">${esc(o.memo)}</textarea>`;
  if (kind === 'fixed') return `<input class="sh-title" data-f="name" placeholder="제목 없음" maxlength="40" value="${esc(o.name)}">
    ${prop('금액', `<input class="num" data-f="amt" inputmode="numeric" value="${fmt(o.amt)}">`)}
    ${prop('분류', opts('cat', FIXED_OPTS, o.cat))}
    ${prop('금액 변동', opts('vary', [false, true], o.vary, v => v ? '매달 바뀜' : '고정'))}
    ${prop('엑셀 이름', `<input class="txt" data-f="keys" maxlength="200" placeholder="예: 귀뚜라미, 아파트관리비" value="${esc(o.keys)}">`)}
    ${fixedPaid.filter(p => p.fixed_id === o.id).length ? prop('나간 돈', fixedPaid.filter(p => p.fixed_id === o.id).sort((a, b) => a.cycle_start < b.cycle_start ? 1 : -1).map(p => `<div class="paidline">${md(p.cycle_start).m}월 주기 · ${won(p.amt)}${p.paid_on ? ` (${md(p.paid_on).m}/${md(p.paid_on).d})` : ''}</div>`).join('')) : ''}
    <div class="sh-hr"></div>
    <textarea class="memo" data-f="memo" placeholder="메모" maxlength="2000">${esc(o.memo)}</textarea>`;
  const joint = o.split !== 'solo';
  const catList = o.cat === '미분류' ? ['미분류', ...CATS] : CATS;
  return `<input class="sh-title" data-f="place" placeholder="제목 없음" maxlength="80" value="${esc(o.place)}">
    ${prop('날짜', `<input type="date" data-f="d" value="${o.d}">`)}
    ${prop('금액', `<input class="num" data-f="amt" inputmode="numeric" value="${fmt(o.amt)}">`)}
    ${prop('분류', opts('cat', catList, o.cat))}
    ${prop('나눔', opts('split', SPLIT_PICK.includes(o.split) ? SPLIT_PICK : [...SPLIT_PICK, o.split], o.split, k => SPLIT[k]))}
    ${joint && partner ? prop('결제', opts('payer', [me, partner], o.payer, k => nm(k))) : ''}
    ${o.split === 'half' ? prop('정산', opts('settled', [false, true], o.settled, v => v ? '끝남' : '아직')) : ''}
    ${joint && o.split !== 'together' ? prop('내 몫', `<span style="font-weight:700;padding:0 8px">${won(share(o, me))}</span>`) : ''}
    ${prop('상태', opts('canceled', [false, true], !!o.canceled, v => v ? '취소됨' : '결제됨'))}
    ${fixedClash.has(o.id) ? `<p class="dupnote">고정비 '${esc(fixedClash.get(o.id))}'에 이미 들어가는 돈일 수 있어요. 고정비로 계산되고 있으면 이 기록은 [지우기] 하세요.</p>` : dupIds.has(o.id) ? `<p class="dupnote">같은 날 같은 금액 기록이 하나 더 있어요. 같은 결제면 하나를 [지우기] 하세요.${dupList(o)}</p>` : ''}
    <div class="sh-hr"></div>
    <textarea class="memo" data-f="memo" placeholder="메모" maxlength="4000">${esc(o.memo)}</textarea>`;
}
function dupList(o){
  const others = entries.filter(e => e.id !== o.id && !e.canceled && e.payer === o.payer && e.d === o.d && e.amt === o.amt);
  return others.map(e => `<br>· ${esc(e.place) || '제목 없음'} (${e.cat}${e.source !== 'app' ? ', ' + ({ iphone:'아이폰', android:'갤럭시', import:'엑셀', notion:'노션' }[e.source] || e.source) : ''})`).join('');
}
function openSheet(kind, obj, isNew = false){
  cur = { kind, obj, isNew };
  $('sheetBody').innerHTML = sheetHtml();
  $('saving').textContent = '';
  $('sheet').querySelector('[data-del]').style.visibility = (kind === 'row' || kind === 'fixed' || kind === 'extra') ? 'visible' : 'hidden';
  $('sheet').classList.toggle('wide', kind === 'import');
  $('sheet').classList.add('on'); $('scrim').classList.add('on'); $('sheet').setAttribute('aria-hidden', 'false');
  growMemo();
  if (isNew) setTimeout(() => $('sheetBody').querySelector('.sh-title')?.focus(), 60);
}
async function closeSheet(){
  if (!cur) return;
  const c = cur; cur = null;
  $('sheet').classList.remove('on'); $('scrim').classList.remove('on'); $('sheet').setAttribute('aria-hidden', 'true');
  clearTimeout(flushT); if (pending.size) await flush();
  if (c.isNew){   // 아무것도 안 적은 새 항목은 지움
    const o = c.obj;
    if (c.kind === 'row' && !o.place && !o.amt && !o.memo){ entries = entries.filter(r => r !== o); await sb.from('gb_entries').delete().eq('id', o.id); }
    if (c.kind === 'fixed' && !o.name && !o.amt && !o.memo){ fixed = fixed.filter(f => f !== o); await sb.from('gb_fixed').delete().eq('id', o.id); }
    if (c.kind === 'extra' && !o.place && !o.amt && !o.memo){ extras = extras.filter(f => f !== o); await sb.from('gb_extra').delete().eq('id', o.id); }
  }
  render();
}
function growMemo(){ const m = $('sheetBody').querySelector('.memo'); if (m){ m.style.height = 'auto'; m.style.height = Math.max(180, m.scrollHeight) + 'px'; } }
const tableOf = k => k === 'fixed' ? 'gb_fixed' : k === 'extra' ? 'gb_extra' : 'gb_entries';

$('sheetBody').addEventListener('input', ev => {
  const f = ev.target.dataset.f; if (!f || !cur) return;
  let v = ev.target.value;
  if (f === 'amt' || f === 'salary'){
    const neg = cur.kind === 'row' && v.trim().startsWith('-');
    let n = +v.replace(/[^0-9]/g, '') || 0; if (neg) n = -n;
    ev.target.value = (neg && !n) ? '-' : fmt(n);
    if (f === 'salary'){ cur.obj.amt = n; saveIncome(cur.obj); }
    else { cur.obj.amt = n; queueSave(tableOf(cur.kind), cur.obj.id, { amt: n }); }
  } else if (cur.kind === 'salary'){
    cur.obj[f] = v; saveIncome(cur.obj);
  } else if (cur.kind === 'import'){
    return;
  } else {
    if (f === 'd' && !v) return;
    cur.obj[f] = v; queueSave(tableOf(cur.kind), cur.obj.id, { [f]: v });
  }
  if (f === 'memo') growMemo();
  render();
});
$('sheetBody').addEventListener('change', ev => {
  const c = ev.target.closest('[data-ck]'); if (!c || !cur?.obj?.plan) return;
  cur.obj.plan[c.dataset.ck][+c.dataset.i].on = c.checked;
  const P = cur.obj.plan, n = P.missing.filter(m => m.on).length + P.fixedOut.filter(x => x.on).length + P.cancel.filter(x => x.on !== false).length + P.settle.length + P.salary.filter(x => x.on).length + P.extra.filter(x => x.on).length;
  const b = $('sheetBody').querySelector('[data-imp-apply]'); if (b) b.textContent = `선택한 것 반영 (${n}건)`;
});
$('sheetBody').addEventListener('click', async ev => {
  if (!cur) return;
  if (ev.target.closest('[data-imp-run]')){ importRun(); return; }
  const ap = ev.target.closest('[data-imp-apply]'); if (ap){ importApply(ap); return; }
  const po = ev.target.closest('[data-impopt] button');
  if (po){ cur.obj.period = po.dataset.v; po.parentElement.querySelectorAll('button').forEach(b => b.classList.toggle('on', b === po)); return; }
  if (ev.target.closest('[data-issue]')){
    const { data, error } = await sb.rpc('gb_issue_phone_key');
    if (error){ toast('열쇠를 만들지 못했어요'); return; }
    cur.obj.key = data; $('sheetBody').innerHTML = sheetHtml(); return;
  }
  if (ev.target.closest('[data-copy]')){ await navigator.clipboard.writeText(cur.obj.key); toast('복사했어요'); return; }
  const b = ev.target.closest('.opts button'); if (!b) return;
  const key = b.parentElement.dataset.opt; let v = b.dataset.v;
  if (v === 'true' || v === 'false') v = v === 'true';
  const o = cur.obj, patch = { [key]: v };
  o[key] = v;
  if (key === 'split' && v === 'half'){ o.settled = false; patch.settled = false; }
  if (key === 'split' && v === 'solo' && o.payer !== me){ o.payer = me; patch.payer = me; }
  queueSave(tableOf(cur.kind), o.id, patch);
  $('sheetBody').innerHTML = sheetHtml(); growMemo(); render();
});

// ───────── 엑셀 맞춰 보기 ─────────
const ERR = { NEED_PASSWORD:'비밀번호를 넣어 주세요', BAD_PASSWORD:'비밀번호가 맞지 않아요', NOT_ZIP:'뱅크샐러드에서 받은 zip 또는 xlsx 파일을 골라 주세요',
  NO_XLSX:'압축 안에 엑셀 파일이 없어요', NO_SHEET:"'가계부 내역' 시트를 찾지 못했어요", BAD_FORMAT:'뱅크샐러드 가계부 내역 양식이 아니에요' };
function importHtml(){
  const o = cur.obj;
  const head = '<input class="sh-title" value="엑셀 맞춰 보기" readonly>';
  if (o.step === 'file' || o.step === 'busy') return `${head}
    ${prop('파일', `<input type="file" id="impFile" accept=".zip,.xlsx" class="filein">`)}
    ${prop('비밀번호', `<input class="num" id="impPw" type="password" inputmode="numeric" autocomplete="off" style="font-size:17px">`)}
    ${prop('기간', `<div class="opts" data-impopt="period">${[['two','이번·지난 주기'],['year','파일 전체']].map(([k, v]) => `<button data-v="${k}" class="${(o.period || 'two') === k ? 'on' : ''}">${v}</button>`).join('')}</div>`)}
    <p class="err">${o.error ? esc(o.error) : ''}</p>
    <button class="sh-btn dark" data-imp-run ${o.step === 'busy' ? 'disabled' : ''}>${o.step === 'busy' ? '읽는 중…' : '맞춰 보기'}</button>`;
  if (o.step === 'done') return `${head}<p class="donemsg">${esc(o.summary)}</p><button class="sh-btn dark" data-close>닫기</button>`;
  const P = o.plan;
  const on = P.missing.filter(m => m.on).length + P.fixedOut.filter(x => x.on).length + P.cancel.filter(x => x.on !== false).length + P.settle.length + P.salary.filter(x => x.on).length + P.extra.filter(x => x.on).length;
  const box = (k, i, checked) => `<input type="checkbox" class="ck" data-ck="${k}" data-i="${i}" ${checked ? 'checked' : ''}>`;
  return `${head}
    <p class="sub" style="margin:-6px 0 6px">${esc(o.rangeText)} · 이미 있는 결제 ${P.matched.length}건${P.matched.filter(m => m.fill).length ? `(이름 채움 ${P.matched.filter(m => m.fill).length})` : ''} · 고정비로 알아본 ${P.fixedTaken}줄${P.dupBank.length ? ` · 간편결제와 겹친 ${P.dupBank.length}줄 뺌` : ''}${P.voided.length ? ` · 결제 후 취소된 ${P.voided.length / 2}건 뺌` : ''}</p>
    ${P.fixedOut.length ? `<div class="sh-sec">고정비로 나간 돈 ${P.fixedOut.length}건</div><div class="imp">${P.fixedOut.map((x, i) => `<label class="imp-row">${box('fixedOut', i, x.on)}${dateBox(x.paid_on)}<span class="p">${esc(x.f.name)} · ${md(x.cs).m}월 주기<small>${x.rows.map(r => esc(r.place)).filter((v, j, a) => a.indexOf(v) === j).join(', ')}${x.rows.length > 1 ? ` (${x.rows.length}번 합침)` : ''}${x.have != null ? ` · 지금 ${won(x.have)}` : ''}</small></span><b>${won(x.amt)}</b></label>`).join('')}</div>` : ''}
    ${P.cancel.length ? `<div class="sh-sec">취소·환불된 결제 ${P.cancel.length}건</div><div class="imp">${P.cancel.map((x, i) => `<label class="imp-row">${box('cancel', i, true)}${dateBox(x.e.d)}<span class="p">${esc(x.e.place) || '제목 없음'}<small>${x.b.d} 취소 → '취소됨'으로</small></span><b>${won(x.e.amt)}</b></label>`).join('')}</div>` : ''}
    <div class="sh-sec">앱에 없는 결제 ${P.missing.length}건</div>
    ${P.missing.length ? `<div class="imp">${P.missing.map((m, i) => `<label class="imp-row">${box('missing', i, m.on)}${dateBox(m.b.d)}
      <span class="p">${esc(m.b.place) || '내용 없음'}<small>${esc(m.cat)}${m.note ? ' · ' + esc(m.note) : ''}</small></span><b>${won(m.amt)}</b></label>`).join('')}</div>` : '<div class="none">없음</div>'}
    <div class="sh-sec">반반 정산 확인 ${P.settle.length}건</div>
    ${P.settle.length ? `<div class="imp">${P.settle.map(x => `<div class="imp-row nock">${dateBox(x.t.d)}<span class="p">${esc(x.e.place) || '제목 없음'}<small>${x.t.amt > 0 ? esc(nm(partner)) + ' → 나' : '나 → ' + esc(nm(partner))} 송금</small></span><b>${won(Math.abs(x.t.amt))}</b></div>`).join('')}</div>` : '<div class="none">없음</div>'}
    ${P.loose.length ? `<div class="sh-sec">짝 없는 ${esc(nm(partner))} 송금 ${P.loose.length}건</div><div class="imp">${P.loose.map(t => `<div class="imp-row nock">${dateBox(t.d)}<span class="p">${t.amt > 0 ? '받음' : '보냄'}<small>맞는 반반 기록이 없음</small></span><b>${won(Math.abs(t.amt))}</b></div>`).join('')}</div>` : ''}
    ${P.salary.length ? `<div class="sh-sec">월급</div><div class="imp">${P.salary.map((x, i) => `<label class="imp-row">${box('salary', i, x.on)}${dateBox(x.b.d)}<span class="p">${md(x.cs).m}월 주기 월급<small>${x.have != null ? '지금 ' + won(x.have) + ' → 바꿈' : '새로 넣음'}</small></span><b>${won(x.b.amt)}</b></label>`).join('')}</div>` : ''}
    ${P.extra.length ? `<div class="sh-sec">월급 말고 들어온 돈</div><div class="imp">${P.extra.map((x, i) => `<label class="imp-row">${box('extra', i, x.on)}${dateBox(x.b.d)}<span class="p">${esc(x.b.place) || '내용 없음'}<small>${x.kind}</small></span><b style="color:var(--green)">+${won(x.b.amt)}</b></label>`).join('')}</div>` : ''}
    ${P.orphan.length ? `<div class="sh-sec">엑셀에 없는 앱 기록 ${P.orphan.length}건 (현금이거나 잘못 들어간 것)</div><div class="imp">${P.orphan.map(e => `<div class="imp-row nock">${dateBox(e.d)}<span class="p">${esc(e.place) || '제목 없음'}<small>${e.cat}</small></span><b>${won(e.amt)}</b></div>`).join('')}</div>` : ''}
    <button class="sh-btn dark" data-imp-apply style="margin-top:22px">선택한 것 반영 (${on}건)</button>`;
}
async function importRun(){
  const o = cur.obj, file = $('impFile')?.files?.[0], pw = $('impPw')?.value || '';
  if (!file){ o.error = '파일을 골라 주세요'; $('sheetBody').innerHTML = sheetHtml(); return; }
  o.step = 'busy'; o.error = ''; $('sheetBody').innerHTML = sheetHtml();
  try {
    const bank = await readBankFile(file, pw);
    if (!bank.length) throw new Error('BAD_FORMAT');
    const last = bank.reduce((a, b) => b.d > a ? b.d : a, '0000');
    const first = bank.reduce((a, b) => b.d < a ? b.d : a, '9999');
    const from = o.period === 'year' ? first : cycleAt(-1).start, to = last;
    const { data: ent, error } = await sb.from('gb_entries').select('*').gte('d', addDays(from, -7)).lte('d', addDays(to, 7));
    if (error) throw error;
    const { data: exAll } = await sb.from('gb_extra').select('*');
    const { data: fpAll } = await sb.from('gb_fixed_paid').select('*');
    o.plan = plan({ bank, entries: ent, me, partner, partnerName: partner ? nm(partner) : '', fixed, fixedPaid: fpAll || [], income, extras: exAll || [], from, to, cycleStartOf: d => cycleStartOf(addDays(d, 5)), cycleOf: d => cycleStartOf(addDays(d, 3)) });   // 고정비: 주기 시작 3일 전부터는 다음 주기
    o.rangeText = `${from} ~ ${to}`;
    o.step = 'review';
  } catch (e){
    console.error(e); o.step = 'file'; o.error = ERR[e.message] || '파일을 읽지 못했어요';
  }
  $('sheetBody').innerHTML = sheetHtml();
}
async function importApply(btn){
  const P = cur.obj.plan; btn.disabled = true; btn.textContent = '반영하는 중…';
  const ins = P.missing.filter(m => m.on).map(m => ({ payer: me, d: m.b.d, place: m.b.place.slice(0, 80), amt: m.amt, cat: m.cat, split: 'solo', settled: true, source: 'import' }));
  const errs = [];
  for (let i = 0; i < ins.length; i += 200){ const { error } = await sb.from('gb_entries').insert(ins.slice(i, i + 200)); if (error) errs.push(error); }
  const fps = P.fixedOut.filter(x => x.on).map(x => ({ fixed_id: x.f.id, owner: me, cycle_start: x.cs, amt: x.amt, paid_on: x.paid_on }));
  if (fps.length){ const { error } = await sb.from('gb_fixed_paid').upsert(fps); if (error) errs.push(error); }
  for (const m of P.matched.filter(m => m.fill)){ const { error } = await sb.from('gb_entries').update({ place: m.fill }).eq('id', m.e.id); if (error) errs.push(error); }
  const cids = P.cancel.filter(x => x.on !== false).map(x => x.e.id);
  if (cids.length){ const { error } = await sb.from('gb_entries').update({ canceled: true }).in('id', cids); if (error) errs.push(error); }
  const ids = P.settle.map(x => x.e.id);
  if (ids.length){ const { error } = await sb.from('gb_entries').update({ settled: true }).in('id', ids); if (error) errs.push(error); }
  const sal = P.salary.filter(x => x.on).map(x => ({ owner: me, cycle_start: x.cs, amt: x.b.amt, paid_on: x.b.d }));
  if (sal.length){ const { error } = await sb.from('gb_income').upsert(sal); if (error) errs.push(error); }
  const exs = P.extra.filter(x => x.on).map(x => ({ owner: me, d: x.b.d, place: x.b.place.slice(0, 80), amt: x.b.amt, kind: x.kind, source: 'import' }));
  if (exs.length){ const { error } = await sb.from('gb_extra').insert(exs); if (error) errs.push(error); }
  if (errs.length){ console.error(errs); toast('일부를 반영하지 못했어요'); }
  cur.obj.step = 'done';
  cur.obj.summary = `결제 ${ins.length}건 넣음 · 고정비 ${fps.length}건 · 취소 ${cids.length}건 · 반반 ${ids.length}건 정산 끝 · 월급 ${sal.length}건 · 그 밖 수입 ${exs.length}건`;
  $('sheetBody').innerHTML = sheetHtml();
  loadAll();
}

// ───────── 탭: 같이 / 내 것 ─────────
let tab = localStorage.getItem('gb_tab') || 'shared';
function showTab(){
  document.querySelectorAll('#tabs [data-tab]').forEach(b => { const on = b.dataset.tab === tab; b.classList.toggle('on', on); b.setAttribute('aria-selected', on); });
  $('paneShared').hidden = tab !== 'shared'; $('paneMine').hidden = tab !== 'mine';
}

// ───────── 누르기 ─────────
document.addEventListener('click', async ev => {
  const t = ev.target;
  if (t.closest('[data-logout]')){ await sb.auth.signOut(); location.reload(); return; }
  if (t.closest('#sheet')){
    if (t.closest('[data-close]')) closeSheet();
    else if (t.closest('[data-del]') && cur){
      const c = cur, table = tableOf(c.kind);
      if (!confirm('지울까요?')) return;
      pending.delete(c.obj.id);
      const { error } = await sb.from(table).delete().eq('id', c.obj.id);
      if (error){ toast('지우지 못했어요'); return; }
      if (c.kind === 'row') entries = entries.filter(r => r !== c.obj); else if (c.kind === 'extra') extras = extras.filter(f => f !== c.obj); else fixed = fixed.filter(f => f !== c.obj);
      c.isNew = false; closeSheet();
    }
    return;
  }
  if (t.closest('#scrim')){ closeSheet(); return; }
  const tb = t.closest('[data-tab]');
  if (tb){ tab = tb.dataset.tab; localStorage.setItem('gb_tab', tab); showTab(); scrollTo({ top: 0 }); return; }
  const cy = t.closest('[data-cyc]');
  if (cy){ cycOffset += +cy.dataset.cyc; soloShown = SOLO_PAGE; loadAll(); return; }
  const hb = t.closest('[data-half]');
  if (hb){
    const o = entries.find(r => r.id === hb.dataset.half); if (!o) return;
    o.split = 'together'; render(); toast(`'${o.place || '기록'}' 같이 먹은 기록으로 옮겼어요`);
    const { error } = await sb.from('gb_entries').update({ split: 'together' }).eq('id', o.id);
    if (error){ o.split = 'solo'; render(); toast('저장하지 못했어요'); }
    return;
  }
  const st = t.closest('[data-settle]');
  if (st){
    const o = entries.find(r => r.id === st.dataset.settle); if (!o) return;
    o.settled = true; render();
    const { error } = await sb.from('gb_entries').update({ settled: true }).eq('id', o.id);
    if (error){ o.settled = false; render(); toast('저장하지 못했어요'); }
    return;
  }
  if (t.closest('#soloMore')){ soloShown += SOLO_PAGE; render(); return; }
  const nw = t.closest('[data-new]');
  if (nw){
    const k = nw.dataset.new === 'auto' ? (tab === 'shared' ? 'together' : 'solo') : nw.dataset.new;
    if (k === 'extra'){
      const cyc = cycleAt(cycOffset), today = todayStr();
      const { data, error } = await sb.from('gb_extra').insert({ owner: me, d: today >= cyc.start && today <= cyc.end ? today : cyc.start }).select().single();
      if (error){ toast('추가하지 못했어요'); return; }
      extras.unshift(data); openSheet('extra', data, true); render(); return;
    }
    if (k === 'fixed'){
      const { data, error } = await sb.from('gb_fixed').insert({ owner: me, sort: fixed.length + 1 }).select().single();
      if (error){ toast('추가하지 못했어요'); return; }
      fixed.push(data); openSheet('fixed', data, true);
    } else {
      const cyc = cycleAt(cycOffset), today = todayStr();
      const d = today >= cyc.start && today <= cyc.end ? today : cyc.start;
      const split = k;
      const { data, error } = await sb.from('gb_entries').insert({ payer: me, d, cat: '외식', split }).select().single();
      if (error){ toast('추가하지 못했어요'); return; }
      entries.push(data); openSheet('row', data, true);
    }
    render(); return;
  }
  if (t.closest('[data-settings]')){ openSheet('settings', { key: null }); return; }
  if (t.closest('[data-salary]')){
    const cs = cycleAt(cycOffset).start;
    openSheet('salary', salaryOf(cs) ? { ...salaryOf(cs) } : { cycle_start: cs, amt: 0, paid_on: payday(cs), memo: '' }); return;
  }
  if (t.closest('[data-import]')){ openSheet('import', { step: 'file' }); return; }
  const exr = t.closest('[data-extra]');
  if (exr){ const o = extras.find(f => f.id === exr.dataset.extra); if (o) openSheet('extra', o); return; }
  const fx = t.closest('[data-fixed]');
  if (fx){ const o = fixed.find(f => f.id === fx.dataset.fixed); if (o) openSheet('fixed', o); return; }
  const it = t.closest('[data-row]');
  if (it){ const o = entries.find(r => r.id === it.dataset.row); if (o) openSheet('row', o); }
});
document.addEventListener('keydown', ev => { if (ev.key === 'Escape' && cur) closeSheet(); });
document.addEventListener('visibilitychange', () => { if (!document.hidden && me) reloadSoon(); });

// ───────── 로그인 ─────────
$('loginForm').addEventListener('submit', async ev => {
  ev.preventDefault();
  $('loginErr').textContent = '';
  // 아이디(이름) → 앱 안에서만 쓰는 로그인 주소, 비밀번호(숫자) → 'gagyebu:' + 숫자 (Supabase 최소 길이 맞춤)
  const id = $('email').value.trim();
  const email = id.includes('@') ? id : 'id-' + [...new TextEncoder().encode(id)].map(b => b.toString(16).padStart(2, '0')).join('') + '@gagyebu.app';
  const password = id.includes('@') ? $('pw').value : 'gagyebu:' + $('pw').value.trim();
  const { error } = await sb.auth.signInWithPassword({ email, password });
  if (error){ $('loginErr').textContent = '아이디 또는 비밀번호가 맞지 않아요'; return; }
  start();
});

async function start(){
  const { data: { session } } = await sb.auth.getSession();
  if (!session){ $('gate').hidden = false; $('app').hidden = true; return; }
  me = session.user.id;
  const { data: mem, error } = await sb.from('gb_members').select('user_id,name,food_limit');
  if (error || !mem?.some(m => m.user_id === me)){ $('gate').hidden = true; $('notMember').hidden = false; return; }
  members = Object.fromEntries(mem.map(m => [m.user_id, m]));
  partner = mem.find(m => m.user_id !== me)?.user_id || null;
  $('gate').hidden = true; $('notMember').hidden = true; $('app').hidden = false;
  await loadAll();
  sb.channel('gb').on('postgres_changes', { event: '*', schema: 'public', table: 'gb_entries' }, reloadSoon).subscribe();
  setInterval(() => { if (!document.hidden) reloadSoon(); }, 60000);
}
start();
