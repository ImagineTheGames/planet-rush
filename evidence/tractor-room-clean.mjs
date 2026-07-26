import { chromium } from '@playwright/test';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { PNG } from 'pngjs';
const BASE = process.env.EVIDENCE_BASE_URL ?? 'http://localhost:4174';
const OUT = new URL('./images/', import.meta.url).pathname;
mkdirSync('/tmp/rm', { recursive: true });
const CX = 640, CY = 400;
function isGrey(r, g, b) { const mx = Math.max(r, g, b), mn = Math.min(r, g, b); return mx > 110 && mx < 215 && (mx - mn) < 28 && Math.abs(r - g) < 22 && Math.abs(g - b) < 30; }
function isOre(r, g, b) { return r > 190 && g > 150 && b < 100; }
function nearestRock(png) {
  const { width, height, data } = png; let best = null, bestD = 1e18;
  for (let y = 120; y < 720; y += 2) for (let x = 40; x < 1040; x += 2) { const i = (y*width+x)*4; if (!isGrey(data[i],data[i+1],data[i+2])) continue; const dx=x-CX,dy=y-CY,d=dx*dx+dy*dy; if (d<400) continue; if (d<bestD){bestD=d;best={x,y};} }
  if (!best) return null; let sx=0,sy=0,n=0;
  for (let y=Math.max(0,best.y-55);y<Math.min(height,best.y+55);y+=2) for (let x=Math.max(0,best.x-55);x<Math.min(width,best.x+55);x+=2){const i=(y*width+x)*4; if(isGrey(data[i],data[i+1],data[i+2])){sx+=x;sy+=y;n++;}}
  return { x:sx/n, y:sy/n, dist:Math.sqrt(bestD), n };
}
function freeChunk(png) {
  const { width, data } = png; let n=0,sx=0,sy=0;
  for (let y=160;y<660;y++) for (let x=140;x<1000;x++){const i=(y*width+x)*4; if(!isOre(data[i],data[i+1],data[i+2]))continue; const d=Math.hypot(x-CX,y-CY); if(d<48||d>140)continue; n++;sx+=x;sy+=y;}
  return n?{n,x:Math.round(sx/n),y:Math.round(sy/n),dist:Math.round(Math.hypot(sx/n-CX,sy/n-CY))}:{n:0};
}
function crop(src,out,x,y,w,h){const p=PNG.sync.read(readFileSync(src));x=Math.max(0,Math.min(x,p.width-w));y=Math.max(0,Math.min(y,p.height-h));const o=new PNG({width:w,height:h});for(let j=0;j<h;j++)for(let i=0;i<w;i++){const si=((y+j)*p.width+(x+i))*4,di=(j*w+i)*4;o.data[di]=p.data[si];o.data[di+1]=p.data[si+1];o.data[di+2]=p.data[si+2];o.data[di+3]=255;}writeFileSync(out,PNG.sync.write(o));}
function stitchH(paths,outPath,gap=8,bg=[12,14,18]){const imgs=paths.map(p=>PNG.sync.read(readFileSync(p)));const h=Math.max(...imgs.map(i=>i.height));const w=imgs.reduce((s,i)=>s+i.width,0)+gap*(imgs.length-1);const out=new PNG({width:w,height:h});for(let i=0;i<out.data.length;i+=4){out.data[i]=bg[0];out.data[i+1]=bg[1];out.data[i+2]=bg[2];out.data[i+3]=255;}let ox=0;for(const im of imgs){for(let y=0;y<im.height;y++)for(let x=0;x<im.width;x++){const si=(y*im.width+x)*4,di=(y*w+(ox+x))*4;out.data[di]=im.data[si];out.data[di+1]=im.data[si+1];out.data[di+2]=im.data[si+2];out.data[di+3]=255;}ox+=im.width+gap;}writeFileSync(outPath,PNG.sync.write(out));}

const b = await chromium.launch();
const ctx = await b.newContext({ viewport: { width: 1280, height: 800 }, deviceScaleFactor: 1 });
const p = await ctx.newPage();
const errs=[]; p.on('pageerror', e=>errs.push(String(e)));
await p.goto(BASE + '/?debug=1', { waitUntil: 'load' });
await p.waitForFunction(() => window.__planetRush?.viewport?.width > 0, undefined, { timeout: 25000 });
await p.waitForFunction(() => (window.__planetRush?.ticks ?? 0) >= 700, undefined, { timeout: 45000 });
await p.keyboard.press('KeyF');
const held=new Set();
const setKeys=async(want)=>{for(const k of held)if(!want.has(k)){await p.keyboard.up(k);held.delete(k);}for(const k of want)if(!held.has(k)){await p.keyboard.down(k);held.add(k);}};
const readSt=()=>p.evaluate(()=>{const pr=window.__planetRush;const ro=window.__oreDepositStage?.readout?.()??null;const hold=window.__oreHudStage?.hold?.()??null;return{cargo:ro?.cargo??null,full:hold?.full??null,filled:hold?.filled??null,beam:pr.beams.filter(x=>x.shooter===0).length};});

// Hover ~100px off a rock with a hold that still has ROOM; chip chunks and catch
// one mid-transit toward the ship (tractored in). Stop before the hold fills.
let firing=false, rock=null;
const shots=[]; const best={n:0};
for (let i=0;i<130;i++){
  const path=`/tmp/rm/r${String(i).padStart(3,'0')}.png`;
  await p.screenshot({ path });
  const png=PNG.sync.read(readFileSync(path));
  rock=nearestRock(png)??rock;
  const st=await readSt();
  const fc=freeChunk(png);
  shots.push({i,path,cargo:st.cargo,full:st.full,filled:st.filled,beam:st.beam,rockDist:rock?Math.round(rock.dist):null,fc});
  if (st.full) break; // keep ROOM only
  const want=new Set();
  if (rock){const d=rock.dist;
    if(d<90){if(rock.x<CX)want.add('KeyD');else want.add('KeyA');if(rock.y<CY)want.add('KeyS');else want.add('KeyW');}
    else if(d>120){if(rock.x<CX)want.add('KeyA');else want.add('KeyD');if(rock.y<CY)want.add('KeyW');else want.add('KeyS');}
  }
  await setKeys(want);
  if (i%5<3){if(!firing){await p.mouse.down();firing=true;}} else {if(firing){await p.mouse.up();firing=false;}}
  // good ROOM frame: room in hold (filled<2), a free chunk 50..115px out (in transit),
  // and the ship is carrying something (filled>=1) so the tell is unambiguous
  if (st.cargo!=null && st.cargo>0 && !st.full && fc.n>=4 && fc.dist>=50 && fc.dist<=118 && fc.n>best.n) Object.assign(best,{...shots[shots.length-1],score:fc.n});
  await p.waitForTimeout(40);
}
if(firing)await p.mouse.up(); await setKeys(new Set());

if (best.path){
  crop(best.path, OUT+'tractor-room-clean.png', CX-200, CY-150, 400, 300);
  console.log('BEST room frame:', JSON.stringify({i:best.i,cargo:best.cargo,filled:best.filled,full:best.full,beam:best.beam,rockDist:best.rockDist,freeChunk:best.fc}));
  // build the final side-by-side using the clean room + the clean stay-put crop
  const fs2 = OUT+'tractor-full-clean.png';
  try { stitchH([OUT+'tractor-room-clean.png', fs2], OUT+'tractor-rules-hold.png'); console.log('stitched tractor-rules-hold.png'); }
  catch(e){ console.log('stitch skipped:', String(e)); }
} else {
  console.log('no clean room frame; candidates:');
  for (const s of shots) if (s.cargo>0 && s.fc.n) console.log(`r${String(s.i).padStart(3,'0')} cargo=${s.cargo} filled=${s.filled} full=${s.full} rockDist=${s.rockDist} fc n=${s.fc.n} dist=${s.fc.dist}`);
}
console.log('errors', errs.slice(0,4));
await b.close();
