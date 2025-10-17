/* Agrupa lecturas según bucketSize (minutos) y devuelve promedios */
export function bucketize(rows, bucketMin){
  if(!rows?.length) return [];

  const msBucket = bucketMin * 60_000;
  const map = new Map();

  rows.forEach(r=>{
    const epoch = Math.floor(Date.parse(r.recorded_at)/msBucket);
    if(!map.has(epoch)) map.set(epoch,{t:0,h:0,c:0});
    const b = map.get(epoch);
    b.t += +r.temperature; b.h += +r.humidity; b.c += 1;
  });

  return [...map.entries()].sort((a,b)=>a[0]-b[0]).map(([ep,b])=>({
    x: ep*msBucket,
    yT: +(b.t/b.c).toFixed(2),
    yH: +(b.h/b.c).toFixed(2)
  }));
}

/* Decide tamaño de bucket según rango (ms) */
export function pickBucketMinutes(rangeMs){
  const min = 60_000,  h = 60*min,  d = 24*h;

  if(rangeMs <= 7*d)      return 10;   // ≤ 7 días → 10 min
  if(rangeMs <= 30*d)     return 60;   // ≤ 30 días → 1 h
  if(rangeMs <= 180*d)    return 360;  // ≤ 6 meses → 6 h
  return 1_440;                       // > 6 meses → 1 día
}