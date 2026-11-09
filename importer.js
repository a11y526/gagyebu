// 뱅크샐러드 '가계부 내역' 엑셀(비밀번호 zip 또는 xlsx)을 브라우저 안에서 읽어 앱 기록과 맞춰 본다.
// 파일은 서버로 보내지 않는다.
const ZIP_URL  = 'https://cdn.jsdelivr.net/npm/@zip.js/zip.js@2.24.0/+esm';
const XLSX_URL = 'https://cdn.jsdelivr.net/npm/xlsx@0.18.5/+esm';

const pad = n => String(n).padStart(2, '0');
const ymd = d => `${d.getFullYear()}-${pad(d.getMonth()+1)}-${pad(d.getDate())}`;
const serialToDate = s => { const d = new Date(Date.UTC(1899, 11, 30) + Math.floor(+s) * 864e5); return `${d.getUTCFullYear()}-${pad(d.getUTCMonth()+1)}-${pad(d.getUTCDate())}`; };
const dayGap = (a, b) => Math.abs(Math.round((new Date(a) - new Date(b)) / 864e5));

// 파일 → xlsx 바이트
async function xlsxBytes(file, password){
  const head = new Uint8Array(await file.slice(0, 4).arrayBuffer());
  const isZip = head[0] === 0x50 && head[1] === 0x4B;
  if (!isZip) throw new Error('NOT_ZIP');
  const zip = await import(ZIP_URL);
  const reader = new zip.ZipReader(new zip.BlobReader(file));
  const list = await reader.getEntries();
  const inner = list.find(e => /\.xlsx$/i.test(e.filename));
  if (!inner){
    // zip 자체가 xlsx인 경우(압축 안 한 엑셀)
    if (list.some(e => e.filename === '[Content_Types].xml')){ await reader.close(); return new Uint8Array(await file.arrayBuffer()); }
    await reader.close(); throw new Error('NO_XLSX');
  }
  try {
    const blob = await inner.getData(new zip.BlobWriter(), { password: password || undefined });
    await reader.close();
    return new Uint8Array(await blob.arrayBuffer());
  } catch (e){
    await reader.close();
    if (/password|encrypt/i.test(String(e?.message))) throw new Error(password ? 'BAD_PASSWORD' : 'NEED_PASSWORD');
    throw e;
  }
}

export async function readBankFile(file, password){
  const bytes = await xlsxBytes(file, password);
  const XLSX = await import(XLSX_URL);
  const wb = XLSX.read(bytes, { type: 'array' });
  const sh = wb.Sheets['가계부 내역'] || wb.Sheets[wb.SheetNames.find(n => n.includes('내역')) || wb.SheetNames[1]];
  if (!sh) throw new Error('NO_SHEET');
  const grid = XLSX.utils.sheet_to_json(sh, { header: 1, raw: true, defval: '' });
  const h = grid[0].map(x => String(x).trim());
  const col = name => h.indexOf(name);
  const C = { d: col('날짜'), t: col('시간'), type: col('타입'), big: col('대분류'), small: col('소분류'), place: col('내용'), amt: col('금액'), method: col('결제수단'), memo: col('메모') };
  if (C.d < 0 || C.amt < 0 || C.type < 0) throw new Error('BAD_FORMAT');
  return grid.slice(1).filter(r => r[C.d] !== '').map((r, i) => ({
    i,
    d: typeof r[C.d] === 'number' ? serialToDate(r[C.d]) : String(r[C.d]).slice(0, 10).replace(/\./g, '-'),
    type: String(r[C.type]), big: String(r[C.big] || ''), small: String(r[C.small] || ''),
    place: String(r[C.place] || '').trim(), amt: Math.round(+r[C.amt] || 0), method: String(r[C.method] || ''),
  }));
}

// 뱅크샐러드 분류 → 앱 분류
export function mapCat(big, small){
  if (big === '식비') return ['식재료','고기'].includes(small) ? '장보기' : small === '배달' ? '배달' : '외식';
  if (big === '카페/간식') return '카페·간식';
  if (big === '술/유흥') return '외식';
  if (big === '생활') return small === '마트' ? '장보기' : small === '편의점' ? '카페·간식' : ['생필품','가구/가전'].includes(small) ? '쇼핑' : '기타';
  if (big === '교통' || big === '자동차') return '교통';
  if (big === '문화/여가' || big === '여행/숙박') return '문화·여가';
  if (big === '패션/쇼핑') return '쇼핑';
  if (big === '온라인쇼핑') return ['서비스구독','앱스토어'].includes(small) ? '구독' : small === '결제/충전' ? '기타' : '쇼핑';
  if (big === '주거/통신') return small === '관리비' ? '주거' : small === '가스비' ? '공과금' : '통신';
  if (big === '보험') return '보험';
  if (big === '금융') return small === '보험' ? '보험' : small === '이자/대출' ? '이자' : small === '증권/투자' ? '저축·투자' : '기타';
  if (big === '미분류') return '미분류';
  return '기타';
}
// 처음부터 체크 안 하는 것: 고정비와 겹칠 수 있는 것, 충전·금융
// 처음부터 체크 안 하는 것: 페이 충전(실제 결제는 따로 잡힘), 증권·투자(지출 아님). 보험·이자·세금·수수료는 진짜 지출이라 체크
const doubtful = (b, cat) => b.small === '결제/충전' || (b.big === '금융' && b.small === '증권/투자');
const doubtNote = b => b.small === '결제/충전' ? '페이 충전 (실제 결제는 따로 잡힘)' : '투자 (지출 아님)';

// 맞춰 보기 계획
// entries: 내가 볼 수 있는 앱 기록, fixed: 내 고정비, income: 내 월급 기록 [{cycle_start, amt}]
export function plan({ bank, entries, me, partner, partnerName, fixed, fixedPaid: paidNow, income, extras, from, to, cycleStartOf, cycleOf }){
  const inRange = b => b.d >= from && b.d <= to;

  // 0) 엑셀 안 정리
  let pays = bank.filter(b => b.type === '지출' && b.amt !== 0 && inRange(b));
  //  - 간편결제와 카드·계좌가 같은 날 같은 금액으로 두 줄 → 간편결제 줄만 남김(가게 이름이 더 정확)
  const dupBank = [];
  const easy = b => /간편결제|페이|머니/.test(b.method);
  for (const b of pays.filter(easy)){
    const twin = pays.find(x => x !== b && !easy(x) && x.d === b.d && x.amt === b.amt && !dupBank.includes(x));
    if (twin) dupBank.push(twin);
  }
  pays = pays.filter(b => !dupBank.includes(b));
  //  - 고정비: '엑셀 이름'이 들어간 나간 돈(결제·이체 모두)
  //    금액이 고정비와 같으면(±1%) 그 고정비, 변동 고정비는 금액 상관없이,
  //    같은 금액이 없는 주기에는 작은 금액들(고정비의 절반 이하)을 합쳐서(예: 티빙 5,000원 × 3)
  const nz = t => String(t).replace(/\s/g, '').toLowerCase();
  const fxk = (fixed || []).map(f => ({ f, ks: String(f.keys || '').split(',').map(nz).filter(k => k.length >= 2) })).filter(x => x.ks.length);
  // 나간 돈 + (변동 고정비만) 같은 이름의 환불(+) — 예: 기차표 환불은 교통비에서 뺌
  const outs = bank.filter(b => (b.type === '지출' || b.type === '이체') && b.amt !== 0 && inRange(b) && !dupBank.includes(b)
    && (b.amt < 0 || (b.type === '지출' && fxk.some(x => x.f.vary && x.ks.some(k => nz(b.place).includes(k))))));
  const groups = new Map(), taken = new Set();
  const put = (x, b, exact) => {
    const cs = cycleOf(b.d), k = x.f.id + '|' + cs;
    const g = groups.get(k) || { f: x.f, cs, amt: 0, rows: [], exact: false };
    g.amt += -b.amt; g.rows.push(b); g.exact = g.exact || exact; groups.set(k, g); taken.add(b);
  };
  for (const b of outs){
    const amt = -b.amt, p = nz(b.place), c = fxk.filter(x => x.ks.some(k => p.includes(k)));
    if (!c.length) continue;
    if (amt < 0){ const v = c.find(x => x.f.vary); if (v) put(v, b, true); continue; }
    const exact = c.find(x => Math.abs(x.f.amt - amt) <= Math.max(10, x.f.amt * .01));
    if (exact) put(exact, b, true);
    else { const v = c.find(x => x.f.vary); if (v) put(v, b, true); }
  }
  for (const b of outs.filter(b => !taken.has(b))){
    const amt = -b.amt, p = nz(b.place);
    const c = fxk.filter(x => !x.f.vary && x.ks.some(k => p.includes(k)) && amt <= x.f.amt / 2)
                 .filter(x => !(groups.get(x.f.id + '|' + cycleOf(b.d))?.exact));
    if (c[0]) put(c[0], b, false);
  }
  const fixedOut = [...groups.values()].map(g => {
    const have = (paidNow || []).find(p => p.fixed_id === g.f.id && p.cycle_start === g.cs);
    return { ...g, paid_on: g.rows.reduce((a, b) => b.d > a ? b.d : a, ''), have: have?.amt ?? null, on: !have || have.amt !== g.amt };
  }).filter(g => g.have !== g.amt).sort((a, b) => a.cs < b.cs ? 1 : -1);
  pays = pays.filter(b => !taken.has(b));

  //  - 결제(−)와 그 취소(+)가 둘 다 있으면 둘 다 빼기(30일 안 같은 금액)
  const voided = [];
  for (const r of pays.filter(b => b.amt > 0)){
    const orig = pays.find(x => x.amt === -r.amt && !voided.includes(x) && x.d <= r.d && dayGap(x.d, r.d) <= 30);
    if (orig) voided.push(orig, r);
  }

  // 1) 결제: 앱에 없는 것 찾기 (같은 금액, 날짜 ±3일). 취소된 앱 기록도 짝으로 침
  const used = new Set();
  const mine = entries.filter(e => e.payer === me);
  const missing = [], matched = [], cancel = [];
  for (const b of voided.filter(x => x.amt < 0)){
    // 엑셀에선 취소된 결제인데 앱엔 '결제됨'으로 남아 있으면 → 취소 표시 후보
    const hit = mine.find(e => !used.has(e.id) && e.amt === -b.amt && dayGap(e.d, b.d) <= 3);
    if (hit){ used.add(hit.id); if (!hit.canceled) cancel.push({ b, e: hit }); }
  }
  for (const b of pays.filter(b => !voided.includes(b))){
    const amt = -b.amt;   // 결제는 음수 → 앱 금액(양수), 환불은 음수로
    const hit = mine.find(e => !used.has(e.id) && e.amt === amt && dayGap(e.d, b.d) <= 3);
    if (hit){ used.add(hit.id); matched.push({ b, e: hit, fill: !hit.place && b.place ? b.place.slice(0, 80) : null }); continue; }
    const cat = mapCat(b.big, b.small);
    const fx = fixed.find(f => Math.abs(f.amt - amt) <= Math.max(500, f.amt * .1) && ['주거','통신','공과금','구독','교통'].includes(cat));
    if (amt < 0){
      // 환불(+)만 있고 원래 결제는 엑셀 기간 밖 → 앱의 같은 금액 결제를 취소 표시, 없으면 환불 기록으로
      const orig = mine.find(e => !used.has(e.id) && !e.canceled && e.amt === -amt && e.d <= b.d && dayGap(e.d, b.d) <= 60);
      if (orig){ used.add(orig.id); cancel.push({ b, e: orig }); continue; }
    }
    missing.push({ b, amt, cat, on: !doubtful(b, cat) && !fx, note: amt < 0 ? '환불' : fx ? `고정비 '${fx.name}'와 비슷` : doubtful(b, cat) ? doubtNote(b) : '' });
  }

  // 2) 상대와 주고받은 송금 → 반반 '끝남'
  const pn = (partnerName || '').trim();
  const transfers = pn ? bank.filter(b => b.type === '이체' && b.place.includes(pn) && inRange(b)) : [];
  const open = entries.filter(e => e.split === 'half' && !e.settled && !e.canceled);
  const settled = new Set(), settle = [], loose = [];
  for (const t of transfers.sort((a, b) => a.d < b.d ? -1 : 1)){
    // +: 상대가 나에게 → 내가 결제한 반반 / −: 내가 상대에게 → 상대가 결제한 반반
    const payer = t.amt > 0 ? me : partner;
    const want = Math.abs(t.amt);
    const cands = open.filter(e => !settled.has(e.id) && e.payer === payer && Math.abs(e.amt / 2 - want) <= 5 && e.d <= t.d)
                      .sort((a, b) => dayGap(a.d, t.d) - dayGap(b.d, t.d));
    if (cands[0]){ settled.add(cands[0].id); settle.push({ t, e: cands[0] }); }
    else loose.push(t);
  }

  // 3) 월급: 급여 중 100만 원 이상 → 그 주기 월급
  const salary = [];
  for (const b of bank.filter(b => b.type === '수입' && b.big === '급여' && b.amt >= 1000000 && inRange(b))){
    const cs = cycleStartOf(b.d);
    const have = income.find(x => x.cycle_start === cs);
    if (!have || have.amt !== b.amt) salary.push({ b, cs, have: have?.amt ?? null, on: !have });
  }
  // 4) 월급 말고 들어온 돈
  //    전에 '시험 감독'·'보강비'로 넣은 곳과 같은 곳에서 들어오면 그 종류로 체크
  //    (뱅크샐러드가 '이체·저축'으로 잘못 나눈 것도). 보강비는 전에 받은 금액의 공통 단위(예: 14,000원)의 배수일 때만.
  //    그 밖 급여·기타수입·사업수입·용돈은 체크 없이 보여 줌. 가게·기관 이름은 코드에 적지 않고 기록에서 배운다.
  const extra = [];
  const norm = t => String(t).replace(/\(주\)|주식회사|\s/g, '');
  const gcd = (a, b) => b ? gcd(b, a % b) : a;
  const learn = kind => {
    const xs = (extras || []).filter(x => x.kind === kind && x.amt > 0);
    return { keys: [...new Set(xs.map(x => norm(x.place).slice(0, 6)))].filter(k => k.length >= 3), unit: xs.reduce((g, x) => gcd(g, x.amt), 0) };
  };
  const EXAM = learn('시험 감독'), BOGANG = learn('보강비');
  for (const b of bank.filter(b => (b.type === '수입' || b.type === '이체') && b.amt >= 10000 && inRange(b))){
    if (b.type === '수입' && (b.big === '금융수입' || (b.big === '급여' && b.amt >= 1000000))) continue;
    if ((extras || []).some(x => x.amt === b.amt && dayGap(x.d, b.d) <= 3)) continue;
    const p = norm(b.place);
    const bogang = BOGANG.keys.some(k => p.includes(k)) && BOGANG.unit > 0 && b.amt % BOGANG.unit === 0;
    const transit = /K-?패스|케이패스|대중교통캐시백|알뜰교통|기후동행/.test(p);   // 교통비 캐시백 (K-패스 적립금 등)
    const exam = !bogang && !transit && EXAM.keys.some(k => p.includes(k));
    if (!exam && !bogang && !transit && (b.type === '이체' || !['급여','기타수입','사업수입','용돈'].includes(b.big))) continue;
    extra.push({ b, kind: transit ? '교통비 캐시백' : bogang ? '보강비' : exam ? '시험 감독' : '기타 수입', on: exam || bogang || transit });
  }
  // 5) 엑셀 기간 안인데 엑셀에 짝이 없는 내 앱 기록 (현금·잘못 들어간 것 확인용)
  const orphan = mine.filter(e => !used.has(e.id) && !e.canceled && !e.fixed_id && e.d >= from && e.d <= to);
  return { missing, matched, settle, loose, salary, extra, cancel, dupBank, voided, fixedOut: fixedOut.filter(g => g.amt > 0), fixedTaken: taken.size, orphan };
}
