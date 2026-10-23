import {createServer} from 'node:http';
import {mkdirSync} from 'node:fs';
import {dirname} from 'node:path';
import {fileURLToPath} from 'node:url';
import {openDatabase} from './local-db.mjs';
import worker from './game-worker.mjs';
const dbPath=process.env.DB_PATH||fileURLToPath(new URL('./data/game.sqlite',import.meta.url));
mkdirSync(dirname(dbPath),{recursive:true});
const DB=openDatabase(dbPath);
const server=createServer(async(req,res)=>{
  try {
    const chunks=[];let size=0;
    for await(const c of req){size+=c.length;if(size>16000){res.writeHead(413,{'Content-Type':'application/json'});res.end(JSON.stringify({error:'Request is too large.'}));return;}chunks.push(c);}
    const protocol=req.headers['x-forwarded-proto']==='https'?'https':'http';
    const request=new Request(`${protocol}://${req.headers.host}${req.url}`,{method:req.method,headers:req.headers,...(!['GET','HEAD'].includes(req.method)?{body:Buffer.concat(chunks)}:{})});
    const result=await worker.fetch(request,{DB},{});
    res.writeHead(result.status,Object.fromEntries(result.headers));res.end(Buffer.from(await result.arrayBuffer()));
  } catch(error) {console.error('HTTP request failed',error.message);if(!res.headersSent)res.writeHead(500,{'Content-Type':'application/json'});res.end(JSON.stringify({error:'Server error. Please try again.'}));}
});
const port=Number(process.env.PORT||8787),host=process.env.HOST||(process.env.RENDER?'0.0.0.0':'127.0.0.1');
server.listen(port,host,()=>console.log(`Watershed Council is listening on ${host}:${port}`));
function stop(){server.close(()=>{DB.sqlite.close();process.exit(0);});setTimeout(()=>process.exit(0),8000).unref();}
process.on('SIGTERM',stop);process.on('SIGINT',stop);
