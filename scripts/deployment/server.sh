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
        # 复用应用初始化程序；凭据从容器复制到仅 root 可读目录后删除容器内副本。
        if [[ "${6:-}" == stdin ]]; then
            docker exec -i --user 0 "$API" node /app/apps/api/dist/identity/bootstrap.js --password-stdin
        else
            docker exec --user 0 "$API" node /app/apps/api/dist/identity/bootstrap.js
        fi
        docker cp "$API:/app/.bootstrap-credentials.local" "$ROOT/shared/.bootstrap-credentials.local"
        chmod 600 "$ROOT/shared/.bootstrap-credentials.local"
        docker exec --user 0 "$API" rm /app/.bootstrap-credentials.local
        echo "Initial credentials: $ROOT/shared/.bootstrap-credentials.local (not printed)."
        exit 0
        ;;
    validate|deploy) ;;
    *) fail 'Unknown action.' ;;
esac

DIRECTORY="$ROOT/releases/$RELEASE"
[[ -d "$DIRECTORY" ]] || fail 'Release directory missing.'
cd "$DIRECTORY"
sha256sum -c images.sha256
check_port
[[ $(df -Pk /var/lib/docker | awk 'NR==2 {print $4}') -gt 2097152 ]] || fail 'Docker filesystem needs at least 2 GiB free before deployment.'
docker load -i images.tar.gz
rm -f images.tar.gz

if [[ "$ACTION" == validate ]]; then
    # 临时网络与回环随机端口验证真实镜像；仅查询生产数据库，不执行迁移或业务写入。
    probe_network="ntfs-probe-$RELEASE"
    probe_api="ntfs-api-probe-$RELEASE"
    probe_web="ntfs-web-probe-$RELEASE"
    cleanup_probe() {
        docker rm -f "$probe_web" "$probe_api" >/dev/null 2>&1 || true
        docker network rm "$probe_network" >/dev/null 2>&1 || true
        docker rmi "ntfs-api:$RELEASE" "ntfs-web:$RELEASE" >/dev/null 2>&1 || true
        rm -f "$DIRECTORY/production.env" "$DIRECTORY/mysql.cnf" "$DIRECTORY/images.sha256"
        rmdir "$DIRECTORY" 2>/dev/null || true
    }
    trap cleanup_probe EXIT
    docker network create --label ntfs.owner="$OWNER" "$probe_network" >/dev/null
    docker run --rm --network "$probe_network" --memory 256m --env-file "$DIRECTORY/production.env" \
        -w /app/apps/api "ntfs-api:$RELEASE" node --input-type=module -e '
        import mysql from "mysql2/promise";
        const c=await mysql.createConnection({host:process.env.DB_HOST,port:Number(process.env.DB_PORT),user:process.env.DB_USERNAME,password:process.env.DB_PASSWORD,connectTimeout:10000});
        try { const [rows]=await c.query("SELECT VERSION() AS version"); console.log("API production dependencies and database connection OK",rows[0].version); } finally { await c.end(); }'
    docker run -d --name "$probe_api" --label ntfs.owner="$OWNER" --network "$probe_network" --network-alias ntfs-api \
        --memory 512m --security-opt no-new-privileges --cap-drop ALL --env-file "$DIRECTORY/production.env" \
        --log-driver json-file --log-opt max-size=5m --log-opt max-file=2 "ntfs-api:$RELEASE" >/dev/null
    docker run -d --name "$probe_web" --label ntfs.owner="$OWNER" --network "$probe_network" --memory 128m \
        -p 127.0.0.1::80 --log-driver json-file --log-opt max-size=5m --log-opt max-file=2 "ntfs-web:$RELEASE" >/dev/null
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
    "ntfs-api:$RELEASE" node apps/api/dist/database/cli.js migrate 2>&1 | tee "$DIRECTORY/migration.log"
if grep -qx 'Applied migrations: 0' "$DIRECTORY/migration.log"; then schema_unchanged=true; fi

if $old_api; then docker rename "$API" "$API-before-$RELEASE"; fi
if $old_web; then docker rename "$WEB" "$WEB-before-$RELEASE"; fi
new_api=true
docker run -d --name "$API" --label ntfs.owner="$OWNER" --label ntfs.release="$RELEASE" \
    --network "$NETWORK" --network-alias ntfs-api --restart unless-stopped --memory 512m \
    --security-opt no-new-privileges --cap-drop ALL --env-file "$DIRECTORY/production.env" \
    --log-driver json-file --log-opt max-size=10m --log-opt max-file=3 "ntfs-api:$RELEASE" >/dev/null

ready=false
for attempt in $(seq 1 24); do
    if [[ "$(docker inspect --format '{{.State.Health.Status}}' "$API")" == healthy ]]; then ready=true; break; fi
    sleep 5
done
$ready || { echo 'API readiness failed.' >&2; false; }

new_web=true
docker run -d --name "$WEB" --label ntfs.owner="$OWNER" --label ntfs.release="$RELEASE" \
    --network "$NETWORK" --restart unless-stopped --memory 128m \
    -p "$HTTP_BIND:$HTTP_PORT:80" --log-driver json-file --log-opt max-size=10m --log-opt max-file=3 "ntfs-web:$RELEASE" >/dev/null
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

# 成功后清理旧容器；镜像、配置、备份保留用于人工恢复，绝不执行全局 prune。
if $old_web; then docker rm "$WEB-before-$RELEASE" >/dev/null; fi
if $old_api; then docker rm "$API-before-$RELEASE" >/dev/null; fi
docker ps --filter label=ntfs.owner="$OWNER" --format '{{.Names}} {{.Status}} {{.Ports}}'
echo "Deployment ready: http://$HTTP_BIND:$HTTP_PORT"
