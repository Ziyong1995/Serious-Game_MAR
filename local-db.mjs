import {DatabaseSync} from 'node:sqlite';
import {readFileSync} from 'node:fs';
export function openDatabase(path) {
  const sqlite=new DatabaseSync(path);
  sqlite.exec('PRAGMA journal_mode=WAL; PRAGMA busy_timeout=5000;');
  sqlite.exec(readFileSync(new URL('./schema.sql',import.meta.url),'utf8').replace('CREATE TABLE rooms','CREATE TABLE IF NOT EXISTS rooms'));
  return {sqlite,prepare(sql){return {bind(...params){return {async first(){return sqlite.prepare(sql).get(...params)||null;},async run(){const r=sqlite.prepare(sql).run(...params);return {success:true,meta:{changes:r.changes}};}};}};}};
}
