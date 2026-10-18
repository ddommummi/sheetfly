const z=require('zlib'),fs=require('fs');
for (const f of process.argv.slice(2)) {
  const b=fs.readFileSync(f);
  const br=z.brotliCompressSync(b,{params:{[z.constants.BROTLI_PARAM_QUALITY]:11,[z.constants.BROTLI_PARAM_LGWIN]:24,[z.constants.BROTLI_PARAM_SIZE_HINT]:b.length}}).length;
  const gz=z.gzipSync(b,{level:9}).length;
  console.log(f.padEnd(34), 'raw',String(b.length).padStart(9),'gzip',String(gz).padStart(9),'brotli',String(br).padStart(9));
}
