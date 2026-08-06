import { PNG } from 'pngjs';
import { readFileSync, writeFileSync } from 'node:fs';
const [,,src,dst,X,Y,W,H,S] = process.argv;
const p = PNG.sync.read(readFileSync(src));
const x=+X,y=+Y,w=+W,h=+H,s=+(S??1);
const out = new PNG({ width: w*s, height: h*s });
for (let j=0;j<h*s;j++) for (let i=0;i<w*s;i++){
  const si=((y+Math.floor(j/s))*p.width+(x+Math.floor(i/s)))*4, di=(j*(w*s)+i)*4;
  out.data[di]=p.data[si];out.data[di+1]=p.data[si+1];out.data[di+2]=p.data[si+2];out.data[di+3]=255;
}
writeFileSync(dst, PNG.sync.write(out));
