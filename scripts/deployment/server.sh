#!/usr/bin/env bash
# 专用于本项目；不升级 Docker、不重启其他容器、不自动恢复或降级数据库。
set -Eeuo pipefail
umask 077
ACTION=${1:?action required}
ROOT=${2:?deployment root required}
RELEASE=${3:?release required}
HTTP_BIND=${4:?IPv4 bind required}
HTTP_PORT=${5:?HTTP port required}
NETWORK=ntfs-production
API=ntfs-api
WEB=ntfs-web
NODE_IMAGE=node:24.21.0-alpine
WEB_IMAGE=nginx:1.30.6
MYSQL_IMAGE=docker.io/mysql:5.7.43
OWNER=next-time-for-sure
[[ "$ROOT" =~ ^/([A-Za-z0-9_-]+/)+next-time-for-sure$ ]] || exit 2
[[ "$RELEASE" =~ ^[0-9]{8}-[0-9]{6}-[a-f0-9]{6}$ ]] || exit 2
[[ "$HTTP_PORT" =~ ^[0-9]+$ ]] && (( HTTP_PORT > 0 && HTTP_PORT < 65536 )) || exit 2
[[ "$HTTP_BIND" =~ ^[0-9.]+$ ]] || exit 2
cd "$ROOT"
exec 9>"$ROOT/deployment.lock"
flock -n 9 || { echo 'Another deployment operation is running.' >&2; exit 1; }

fail() { echo "$*" >&2; exit 1; }

# 容器名固定，但所有破坏性动作必须同时匹配所有者标签。
owned() {
    [[ "$(docker inspect --format '{{index .Config.Labels "ntfs.owner"}}' "$1")" == "$OWNER" ]] || fail "Container name belongs to another application: $1"
}

exists() { docker inspect "$1" >/dev/null 2>&1; }

# 在真实网关验证旧缓存请求，防止固定归档时间造成跨版本首页误返回304。
check_web_cache() {
    local origin=$1 web_root=$2 legacy_etag modified path condition response asset asset_headers asset_etag
    legacy_etag=$(printf '"%x-%x"' "$(stat -c %Y "$web_root/index.html")" "$(stat -c %s "$web_root/index.html")")
    modified=$(LC_ALL=C date -u -d "@$(stat -c %Y "$web_root/index.html")" '+%a, %d %b %Y %H:%M:%S GMT')

    # 单独与同时发送两类旧校验头；所有SPA入口均须返回完整页面。
    for path in / /index.html /reports /weekly-plans /account; do
        for condition in etag modified both; do
            local headers=()
            if [[ "$condition" != modified ]]; then headers+=(-H "If-None-Match: $legacy_etag"); fi
            if [[ "$condition" != etag ]]; then headers+=(-H "If-Modified-Since: $modified"); fi
            response=$(curl -fsS --max-time 10 -D - "${headers[@]}" "$origin$path")
            printf '%s\n' "$response" | grep -q '^HTTP/1.1 200 ' || fail "Cached entry did not return 200: $path ($condition)"
            printf '%s\n' "$response" | grep -qi '^Cache-Control: no-store' || fail "Entry permits storage: $path"
            if printf '%s\n' "$response" | grep -qi '^ETag:'; then fail "Entry still exposes a timestamp ETag: $path"; fi
            printf '%s\n' "$response" | grep -q '<div id="root">' || fail "Entry body missing: $path"
        done
    done

    # 内容哈希资源继续长期缓存；缺失资源不得回退到HTML。
    asset=$(grep -oE '/assets/[^" ]+\.js' "$web_root/index.html" | head -n 1)
    [[ -n "$asset" ]] || fail 'No hashed JavaScript asset found.'
    asset_headers=$(curl -fsSI --max-time 10 "$origin$asset")
    printf '%s\n' "$asset_headers" | grep -qi '^Cache-Control: public, immutable' || fail 'Hashed asset lost immutable caching.'
    asset_etag=$(printf '%s\n' "$asset_headers" | sed -n 's/^[Ee][Tt][Aa][Gg]: //p' | tr -d '\r')
    [[ -n "$asset_etag" ]] || fail 'Hashed asset ETag missing.'
    [[ "$(curl -sS -o /dev/null -w '%{http_code}' --max-time 10 -H "If-None-Match: $asset_etag" "$origin$asset")" == 304 ]] || fail 'Unchanged hashed asset did not return 304.'
    [[ "$(curl -sS -o /dev/null -w '%{http_code}' --max-time 10 "$origin/assets/ntfs-cache-probe-missing.js")" == 404 ]] || fail 'Missing asset did not return 404.'
    echo 'PASS: 15 legacy-cache entry requests returned fresh HTML; hashed assets retained 304 and immutable caching; missing asset returned 404.'
}

mysql_query() {
    docker run --rm --network bridge --memory 256m --log-driver json-file --log-opt max-size=5m --log-opt max-file=2 \
        -v "$1:/run/mysql.cnf:ro" "$MYSQL_IMAGE" mysql --defaults-extra-file=/run/mysql.cnf --connect-timeout=10 -N -e "$2"
}

check_port() {
    if exists "$WEB"; then owned "$WEB"; fi
    if ss -lnt | awk '{print $4}' | grep -Eq ":${HTTP_PORT}$"; then
        if ! exists "$WEB" || ! docker port "$WEB" 80/tcp | grep -Eq ":${HTTP_PORT}$"; then
            fail "Port $HTTP_PORT is already in use. Change HTTP_PORT in the local production configuration."
        fi
    fi
}

check_environment() {
    docker info >/dev/null 2>&1
    docker image inspect "$MYSQL_IMAGE" >/dev/null
    docker run --rm --network none --memory 256m "$NODE_IMAGE" node -e \
        'const {Worker}=require("node:worker_threads"); console.log(process.version); require("node:crypto").scrypt("probe","salt",64,(e)=>{if(e)throw e;console.log("crypto OK")});new Worker("",{eval:true}).on("exit",c=>{if(c)process.exit(c);console.log("worker OK")})'
    check_web="ntfs-nginx-check-$RELEASE"
    trap 'docker rm -f "$check_web" >/dev/null 2>&1 || true' EXIT
    docker run -d --name "$check_web" --label ntfs.owner="$OWNER" --network none --memory 128m \
        --log-driver json-file --log-opt max-size=5m --log-opt max-file=2 "$WEB_IMAGE" >/dev/null
    check_ready=false
    for attempt in $(seq 1 10); do
        if docker exec "$check_web" curl -fsS http://127.0.0.1/ >/dev/null 2>&1; then check_ready=true; break; fi
        sleep 1
    done
    $check_ready || fail 'Nginx failed its full HTTP compatibility check.'
    docker rm -f "$check_web" >/dev/null
    trap - EXIT
    echo 'Nginx HTTP compatibility OK'
    mysql_query "$ROOT/shared/mysql.cnf" "SELECT VERSION(), CURRENT_USER(); SELECT COUNT(*) FROM information_schema.SCHEMATA WHERE SCHEMA_NAME='next_time_for_sure';"
    check_port
    df -h "$ROOT" /var/lib/docker
    echo "Environment checked: http://${HTTP_BIND}:${HTTP_PORT}; no business service started by this check."
}

case "$ACTION" in
    prepare)
        docker load -i "$ROOT/runtime/runtime.tar"
        rm -f "$ROOT/runtime/runtime.tar"
        check_environment
        exit 0
        ;;
    check)
        check_environment
        docker ps --filter label=ntfs.owner="$OWNER" --format '{{.Names}} {{.Status}} {{.Ports}}'
        exit 0
        ;;
    initadmin)
        exists "$API" || fail 'Deploy the API first.'
        owned "$API"
        current=$(cat "$ROOT/current-release")
        [[ "$current" =~ ^[0-9]{8}-[0-9]{6}-[a-f0-9]{6}$ ]] || fail 'Invalid current release.'
        current_directory="$ROOT/releases/$current"
        dependency_id=$(cat "$current_directory/dependencies.id")
        [[ "$dependency_id" =~ ^[a-f0-9]{64}$ ]] || fail 'Invalid dependency identifier.'
        [[ ! -e "$ROOT/shared/.bootstrap-credentials.local" ]] || fail 'Initial credential file already exists.'
        mkdir -p "$ROOT/runtime/bootstrap"
        bootstrap_flags=()
        if [[ "${6:-}" == stdin ]]; then
            bootstrap_flags=(--password-stdin)
        fi
        # 独立的一次性容器只写凭据目录；运行中的 API 不获得该目录的挂载。
        docker run --rm -i --network "$NETWORK" --memory 512m --env-file "$current_directory/production.env" \
            -e BOOTSTRAP_CREDENTIALS_FILE=/run/bootstrap/.bootstrap-credentials.local \
            -v "$current_directory/app:/app:ro" \
            -v "$ROOT/dependencies/$dependency_id/api/node_modules:/app/apps/api/node_modules:ro" \
            -v "$ROOT/runtime/bootstrap:/run/bootstrap" -w /app "$NODE_IMAGE" \
            node apps/api/dist/identity/bootstrap.js "${bootstrap_flags[@]}"
        mv "$ROOT/runtime/bootstrap/.bootstrap-credentials.local" "$ROOT/shared/.bootstrap-credentials.local"
        chmod 600 "$ROOT/shared/.bootstrap-credentials.local"
        rmdir "$ROOT/runtime/bootstrap"
        echo "Initial credentials: $ROOT/shared/.bootstrap-credentials.local (not printed)."
        exit 0
        ;;
    validate|deploy) ;;
    *) fail 'Unknown action.' ;;
esac

DIRECTORY="$ROOT/releases/$RELEASE"
[[ -d "$DIRECTORY" ]] || fail 'Release directory missing.'
cd "$DIRECTORY"
sha256sum -c artifacts.sha256
check_port
docker image inspect "$NODE_IMAGE" "$WEB_IMAGE" "$MYSQL_IMAGE" >/dev/null
[[ $(df -Pk "$ROOT" | awk 'NR==2 {print $4}') -gt 1048576 ]] || fail 'Deployment filesystem needs at least 1 GiB free.'
dependency_id=$(cat dependencies.id)
[[ "$dependency_id" =~ ^[a-f0-9]{64}$ ]] || fail 'Invalid dependency identifier.'
DEPENDENCIES="$ROOT/dependencies/$dependency_id"
if [[ ! -f "$DEPENDENCIES/.ready" ]]; then
    [[ -f dependencies.tar.gz ]] || fail 'Missing dependency archive; upload it before deployment.'
    [[ "$(gzip -dc dependencies.tar.gz | sha256sum | awk '{print $1}')" == "$dependency_id" ]] || fail 'Dependency content checksum mismatch.'
    staging="$ROOT/dependencies/$dependency_id-$RELEASE"
    mkdir "$staging"
    tar -xzf dependencies.tar.gz -C "$staging"
    chmod -R a+rX "$staging"
    touch "$staging/.ready"
    mv "$staging" "$DEPENDENCIES"
fi
mkdir app
tar -xzf application.tar.gz -C app
chmod -R a+rX app
rm -f application.tar.gz dependencies.tar.gz
API_MOUNTS=(-v "$DIRECTORY/app:/app:ro" -v "$DEPENDENCIES/api/node_modules:/app/apps/api/node_modules:ro")
WEB_MOUNTS=(-v "$DIRECTORY/app/web:/usr/share/nginx/html:ro" -v "$DIRECTORY/app/nginx.conf:/etc/nginx/conf.d/default.conf:ro")
API_HEALTH="node -e \"fetch('http://127.0.0.1:3100/api/v1/health/ready',{signal:AbortSignal.timeout(5000)}).then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))\""

if [[ "$ACTION" == validate ]]; then
    # 使用与正式部署一致的只读挂载验证产物，不执行业务迁移。
    probe_network="ntfs-probe-$RELEASE"
    probe_api="ntfs-api-probe-$RELEASE"
    probe_web="ntfs-web-probe-$RELEASE"
    cleanup_probe() {
        docker rm -f "$probe_web" "$probe_api" >/dev/null 2>&1 || true
        docker network rm "$probe_network" >/dev/null 2>&1 || true
        [[ "$DIRECTORY" == "$ROOT/releases/$RELEASE" ]] && rm -rf -- "$DIRECTORY"
    }
    trap cleanup_probe EXIT
    docker network create --label ntfs.owner="$OWNER" "$probe_network" >/dev/null
    docker run --rm --network "$probe_network" --memory 256m --env-file "$DIRECTORY/production.env" \
        "${API_MOUNTS[@]}" -w /app/apps/api "$NODE_IMAGE" node --input-type=module -e '
        import mysql from "mysql2/promise";
        const c=await mysql.createConnection({host:process.env.DB_HOST,port:Number(process.env.DB_PORT),user:process.env.DB_USERNAME,password:process.env.DB_PASSWORD,connectTimeout:10000});
        try { const [rows]=await c.query("SELECT VERSION() AS version"); console.log("API production dependencies and database connection OK",rows[0].version); } finally { await c.end(); }'
    docker run -d --name "$probe_api" --label ntfs.owner="$OWNER" --network "$probe_network" --network-alias ntfs-api \
        --memory 512m --security-opt no-new-privileges --cap-drop ALL --env-file "$DIRECTORY/production.env" \
        --user node "${API_MOUNTS[@]}" -w /app \
        --log-driver json-file --log-opt max-size=5m --log-opt max-file=2 "$NODE_IMAGE" node apps/api/dist/main.js >/dev/null
    docker run -d --name "$probe_web" --label ntfs.owner="$OWNER" --network "$probe_network" --memory 128m \
        "${WEB_MOUNTS[@]}" -p 127.0.0.1::80 --log-driver json-file --log-opt max-size=5m --log-opt max-file=2 "$WEB_IMAGE" >/dev/null
    probe_port=$(docker port "$probe_web" 80/tcp | awk -F: '{print $NF}')
    probe_ready=false
    for attempt in $(seq 1 24); do
        if [[ "$(docker inspect --format '{{.State.Running}}' "$probe_api")" != true || "$(docker inspect --format '{{.State.Running}}' "$probe_web")" != true ]]; then
            fail 'Validation container exited; inspect image compatibility before deploying.'
        fi
        if curl -fsS --max-time 5 "http://127.0.0.1:$probe_port/api/v1/health/live" >/dev/null 2>&1; then probe_ready=true; break; fi
        sleep 5
    done
    $probe_ready || fail 'Validation API did not become live.'
    curl -fsS --max-time 5 "http://127.0.0.1:$probe_port/" | grep -q '<div id="root">'
    curl -fsS --max-time 5 "http://127.0.0.1:$probe_port/account" | grep -q '<div id="root">'
    check_web_cache "http://127.0.0.1:$probe_port" "$DIRECTORY/app/web"
    readiness_code=$(curl -sS -o /dev/null -w '%{http_code}' --max-time 10 "http://127.0.0.1:$probe_port/api/v1/health/ready")
    [[ "$readiness_code" == 200 || "$readiness_code" == 503 ]] || fail 'Unexpected readiness response.'
    echo "PASS: API live, production dependencies, database query, Nginx proxy and SPA routes. Readiness HTTP $readiness_code (503 is expected before first migration)."
    exit 0
fi

# 上传的新配置在切换前单独存放。已有部署禁止悄悄更换数据库目标。
if exists "$API"; then
    owned "$API"
    for key in DB_HOST DB_PORT DB_DATABASE; do
        [[ "$(grep "^$key=" "$ROOT/shared/production.env")" == "$(grep "^$key=" production.env)" ]] || fail 'Changing the database target requires a separate migration procedure.'
    done
fi
if exists "$WEB"; then owned "$WEB"; fi
version=$(mysql_query "$DIRECTORY/mysql.cnf" 'SELECT VERSION()')
[[ "$version" == 5.7.* ]] || fail 'Current migrations require MySQL 5.7.'
database_exists=$(mysql_query "$DIRECTORY/mysql.cnf" "SELECT COUNT(*) FROM information_schema.SCHEMATA WHERE SCHEMA_NAME='next_time_for_sure'")
if [[ "$database_exists" == 1 ]]; then
    baseline=$(mysql_query "$DIRECTORY/mysql.cnf" "SELECT metadata_value FROM next_time_for_sure.platform_metadata WHERE metadata_key='schema_baseline'")
    [[ "$baseline" == v2 || -f "$DIRECTORY/v2-cutover.json" ]] || fail 'V1 production requires reviewed V2 cutover material before deployment.'
fi

if docker network inspect "$NETWORK" >/dev/null 2>&1; then
    [[ "$(docker network inspect --format '{{index .Labels "ntfs.owner"}}' "$NETWORK")" == "$OWNER" ]] || fail 'Docker network name is owned by another application.'
else
    docker network create --label ntfs.owner="$OWNER" "$NETWORK" >/dev/null
fi

old_api=false
old_web=false
migration_started=false
schema_unchanged=false
new_api=false
new_web=false

recover() {
    result=$?
    trap - ERR
    set +e
    echo "Deployment failed; backup/release evidence is retained at $DIRECTORY" >&2
    # 只回收本次创建且所有者匹配的候选容器。
    if $new_web; then docker rm -f "$WEB" >/dev/null; fi
    if $new_api; then docker rm -f "$API" >/dev/null; fi
    if ! $migration_started || $schema_unchanged; then
        if exists "$API-before-$RELEASE"; then docker rename "$API-before-$RELEASE" "$API"; fi
        if exists "$WEB-before-$RELEASE"; then docker rename "$WEB-before-$RELEASE" "$WEB"; fi
        if $old_api; then docker start "$API" >/dev/null; fi
        if $old_web; then docker start "$WEB" >/dev/null; fi
        echo 'Previous containers restarted where present; verify readiness before resuming traffic.' >&2
    else
        echo 'Database migration ran or partially failed. Previous containers remain stopped; no automatic database downgrade. Review backup and migration log before recovery.' >&2
    fi
    exit "$result"
}
trap recover ERR

# 停止本项目写入后备份；其他项目容器与数据库完全不参与本次切换。
if exists "$WEB"; then old_web=true; docker stop -t 30 "$WEB" >/dev/null; fi
if exists "$API"; then old_api=true; docker stop -t 30 "$API" >/dev/null; fi
if [[ "$database_exists" == 1 ]]; then
    echo 'Backing up dedicated database before migrations...'
    docker run --rm --network bridge --memory 256m -v "$DIRECTORY/mysql.cnf:/run/mysql.cnf:ro" "$MYSQL_IMAGE" \
        mysqldump --defaults-extra-file=/run/mysql.cnf --single-transaction --routines --events --triggers \
        --hex-blob --set-gtid-purged=OFF --databases next_time_for_sure | gzip > "$ROOT/backups/$RELEASE.sql.gz.partial"
    gzip -t "$ROOT/backups/$RELEASE.sql.gz.partial"
    mv "$ROOT/backups/$RELEASE.sql.gz.partial" "$ROOT/backups/$RELEASE.sql.gz"
    sha256sum "$ROOT/backups/$RELEASE.sql.gz" > "$ROOT/backups/$RELEASE.sql.gz.sha256"
else
    echo 'First deployment: dedicated database does not exist yet.'
fi

migration_started=true
docker run --rm --network "$NETWORK" --memory 512m --env-file "$DIRECTORY/production.env" \
    "${API_MOUNTS[@]}" -w /app "$NODE_IMAGE" node apps/api/dist/database/cli.js migrate 2>&1 | tee "$DIRECTORY/migration.log"
if grep -qx 'Applied migrations: 0' "$DIRECTORY/migration.log"; then schema_unchanged=true; fi

if [[ -f "$DIRECTORY/v2-cutover.json" ]]; then
    [[ -s "$ROOT/backups/$RELEASE.sql.gz" ]] || fail 'V2 cutover requires a complete pre-migration backup.'
    schema_unchanged=false
    mkdir "$DIRECTORY/cutover-evidence"
    docker run --rm --network "$NETWORK" --memory 512m --env-file "$DIRECTORY/production.env" \
        "${API_MOUNTS[@]}" -v "$DIRECTORY/v2-cutover.json:/run/v2-input.json:ro" \
        -v "$ROOT/backups/$RELEASE.sql.gz:/run/v2-backup.sql.gz:ro" \
        -v "$DIRECTORY/cutover-evidence:/run/v2-evidence" -w /app "$NODE_IMAGE" \
        node apps/api/dist/database/v2-transition/cutover-cli.js --input /run/v2-input.json \
        --backup /run/v2-backup.sql.gz --evidence /run/v2-evidence/result.json 2>&1 | tee "$DIRECTORY/cutover.log"
fi

if $old_api; then docker rename "$API" "$API-before-$RELEASE"; fi
if $old_web; then docker rename "$WEB" "$WEB-before-$RELEASE"; fi
new_api=true
docker run -d --name "$API" --label ntfs.owner="$OWNER" --label ntfs.release="$RELEASE" \
    --network "$NETWORK" --network-alias ntfs-api --restart unless-stopped --memory 512m \
    --security-opt no-new-privileges --cap-drop ALL --env-file "$DIRECTORY/production.env" \
    --user node "${API_MOUNTS[@]}" -w /app \
    --health-cmd "$API_HEALTH" --health-interval 10s --health-timeout 6s --health-retries 6 \
    --log-driver json-file --log-opt max-size=10m --log-opt max-file=3 "$NODE_IMAGE" node apps/api/dist/main.js >/dev/null

ready=false
for attempt in $(seq 1 24); do
    if [[ "$(docker inspect --format '{{.State.Health.Status}}' "$API")" == healthy ]]; then ready=true; break; fi
    sleep 5
done
$ready || { echo 'API readiness failed.' >&2; false; }

new_web=true
docker run -d --name "$WEB" --label ntfs.owner="$OWNER" --label ntfs.release="$RELEASE" \
    --network "$NETWORK" --restart unless-stopped --memory 128m \
    "${WEB_MOUNTS[@]}" --health-cmd 'curl -fsS http://127.0.0.1/healthz || exit 1' --health-interval 10s --health-timeout 5s --health-retries 6 \
    -p "$HTTP_BIND:$HTTP_PORT:80" --log-driver json-file --log-opt max-size=10m --log-opt max-file=3 "$WEB_IMAGE" >/dev/null
ready=false
for attempt in $(seq 1 12); do
    if curl -fsS --max-time 6 "http://$HTTP_BIND:$HTTP_PORT/api/v1/health/ready" >/dev/null && \
       curl -fsS --max-time 6 "http://$HTTP_BIND:$HTTP_PORT/" >/dev/null; then ready=true; break; fi
    sleep 5
done
$ready || { echo 'Gateway readiness failed.' >&2; false; }
cp production.env "$ROOT/shared/production.env.next"
cp mysql.cnf "$ROOT/shared/mysql.cnf.next"
mv "$ROOT/shared/production.env.next" "$ROOT/shared/production.env"
mv "$ROOT/shared/mysql.cnf.next" "$ROOT/shared/mysql.cnf"
printf '%s\n' "$RELEASE" > "$ROOT/current-release"
trap - ERR

# 成功后清理旧容器；版本产物、配置与备份保留用于人工恢复，不删除共用依赖。
if $old_web; then docker rm "$WEB-before-$RELEASE" >/dev/null; fi
if $old_api; then docker rm "$API-before-$RELEASE" >/dev/null; fi
docker ps --filter label=ntfs.owner="$OWNER" --format '{{.Names}} {{.Status}} {{.Ports}}'
echo "Deployment ready: http://$HTTP_BIND:$HTTP_PORT"
