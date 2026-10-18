"""生产发布后只读业务回读；可用的管理员凭据仅用于登录、身份和退出，不修改业务。"""
import importlib.util
import pathlib
import json
import http.cookiejar
import urllib.request

ROOT = pathlib.Path(__file__).resolve().parents[2]
SPEC = importlib.util.spec_from_file_location('deployment', pathlib.Path(__file__).with_name('deploy.py'))
DEPLOY = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(DEPLOY)


def main():
    """复核源码版本、切换摘要、中文注释和公开入口；不打印凭据或业务正文。"""
    values = DEPLOY.configuration(ROOT / '.deploy.production.local')
    client = DEPLOY.paramiko.SSHClient()
    client.load_system_host_keys()
    client.set_missing_host_key_policy(DEPLOY.paramiko.RejectPolicy())
    client.connect(values['DEPLOY_HOST'], port=int(values['DEPLOY_SSH_PORT']), username=values['DEPLOY_USER'], password=values.get('DEPLOY_PASSWORD'), timeout=15)
    try:
        script = r'''
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {createDataSource} from './dist/database/data-source.js';
import {loadEnvironment} from './dist/config/environment.js';
import {conversionTargetHash} from './dist/database/v2-transition/convert.js';
const source=createDataSource(loadEnvironment()); await source.initialize();
try {
 const release=JSON.parse(fs.readFileSync('/app/source.json','utf8'));
 assert.equal(release.version,'2.0.0'); assert.equal(release.dirty,false);
 const metadata=await source.query('SELECT metadata_key,metadata_value FROM platform_metadata');
 const values=new Map(metadata.map(row=>[row.metadata_key,row.metadata_value]));
 assert.equal(values.get('schema_baseline'),'v2');
 assert.equal(await conversionTargetHash(source.manager),values.get('v2_conversion_target'));
 const migrations=await source.query('SELECT name FROM schema_migrations ORDER BY id'); assert.equal(migrations.length,23);
 const tables=['accounts','teams','projects','project_members','v2_tasks','v2_backlog','v2_arrangements','v2_task_events','v2_migration_map'];
 const counts={}; for(const table of tables) counts[table]=(await source.query(`SELECT COUNT(*) n FROM ${table}`))[0].n;
 const old=await source.query("SELECT TABLE_NAME FROM information_schema.TABLES WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME IN ('team_tasks','task_assignments','personal_items','weekly_publications','work_requests','notifications','work_groups')");assert.equal(old.length,0);
 const missing=await source.query("SELECT TABLE_NAME FROM information_schema.TABLES WHERE TABLE_SCHEMA=DATABASE() AND TABLE_COMMENT NOT REGEXP '[一-龥]' UNION ALL SELECT COLUMN_NAME FROM information_schema.COLUMNS WHERE TABLE_SCHEMA=DATABASE() AND COLUMN_COMMENT NOT REGEXP '[一-龥]'");assert.equal(missing.length,0);
 console.log(JSON.stringify({release,counts,migrations:migrations.length,conversionUnchanged:true,legacyTablesRemoved:true,chineseCommentsComplete:true}));
} finally {await source.destroy();}
'''
        DEPLOY.remote(client, "docker exec -i ntfs-api sh -c 'cd /app/apps/api && exec node --input-type=module'", script)
        DEPLOY.remote(client, "docker ps --filter label=ntfs.owner=next-time-for-sure --format '{{.Names}} {{.Status}}'")
        base = 'http://' + values['HTTP_BIND'] + ':' + values['HTTP_PORT']
        jar = http.cookiejar.CookieJar()
        opener = urllib.request.build_opener(urllib.request.ProxyHandler({}), urllib.request.HTTPCookieProcessor(jar))
        def request(path, data=None, csrf=None):
            headers = {'Origin': base, 'Content-Type': 'application/json'}
            if csrf:
                headers['X-CSRF-Token'] = csrf
            with opener.open(urllib.request.Request(base + path, data=None if data is None else json.dumps(data).encode(), headers=headers), timeout=15) as response:
                return response.status, response.read()
        for path in ['/', '/personal', '/projects', '/weekly', '/account', '/api/v1/health/live', '/api/v1/health/ready']:
            status, body = request(path)
            assert status == 200
            if not path.startswith('/api/'):
                assert b'<div id="root">' in body
            print('PASS HTTP ' + path, flush=True)
        if values.get('INITIAL_ADMIN_PASSWORD'):
            status, body = request('/api/v1/auth/login', {'loginName': 'admin', 'password': values['INITIAL_ADMIN_PASSWORD']})
            identity = json.loads(body)
            try:
                assert status == 200 and identity['isSuperAdmin']
                assert request('/api/v1/auth/me')[0] == 200
                print('PASS authenticated admin identity (no business writes).', flush=True)
            finally:
                assert request('/api/v1/auth/logout', {}, identity['csrfToken'])[0] == 204
    finally:
        client.close()


if __name__ == '__main__':
    try:
        main()
    except Exception as error:
        print('V2 verification stopped (' + type(error).__name__ + '); credentials and business text were not logged.')
        raise SystemExit(1) from None
