"""本机编译并上传产物，通过基础镜像挂载部署；配置不进入产物或日志。"""
import argparse
import getpass
import gzip
import hashlib
import json
import os
import pathlib
import re
import shlex
import shutil
import subprocess
import sys
import tarfile
import tempfile
import time
import uuid

ROOT = pathlib.Path(__file__).resolve().parents[2]
sys.path.insert(0, str(ROOT / '.cache' / 'deploy-tools'))
import paramiko

NODE_IMAGE = 'node:24.21.0-alpine'
WEB_IMAGE = 'nginx:1.30.6'
REQUIRED = ['DEPLOY_HOST', 'DEPLOY_SSH_PORT', 'DEPLOY_USER', 'DEPLOY_PATH', 'HTTP_BIND', 'HTTP_PORT',
            'DB_HOST', 'DB_PORT', 'DB_USERNAME', 'DB_PASSWORD', 'DB_DATABASE', 'API_HOST', 'API_PORT', 'NODE_ENV']


def configuration(path):
    """解析字面量键值，拒绝换行和危险路径，不执行配置中的任何代码。"""
    values = {}
    for line in path.read_text(encoding='utf-8-sig').splitlines():
        if not line.strip() or line.lstrip().startswith('#'):
            continue
        key, separator, value = line.partition('=')
        if not separator or key in values or not re.fullmatch(r'[A-Z_]+', key):
            raise RuntimeError('Invalid or duplicate deployment configuration key')
        values[key] = value
    if any(not values.get(key) for key in REQUIRED):
        raise RuntimeError('Deployment configuration has missing required fields')
    if values['DB_DATABASE'] != 'next_time_for_sure' or values['NODE_ENV'] != 'production':
        raise RuntimeError('Only the dedicated production database/environment is allowed')
    if not re.fullmatch(r'/(?:[A-Za-z0-9_-]+/)+next-time-for-sure', values['DEPLOY_PATH']):
        raise RuntimeError('Deployment path must be an absolute path ending in /next-time-for-sure, without dot segments')
    if values['API_HOST'] != '0.0.0.0' or values['API_PORT'] != '3100':
        raise RuntimeError('Container API must bind 0.0.0.0:3100; it is not published on the host')
    for key in ['HTTP_PORT', 'DB_PORT', 'DEPLOY_SSH_PORT']:
        if not values[key].isdigit() or not 1 <= int(values[key]) <= 65535:
            raise RuntimeError('Invalid port: ' + key)
    if not re.fullmatch(r'[0-9.]+', values['HTTP_BIND']):
        raise RuntimeError('HTTP_BIND must be an IPv4 address')
    return values


def run(arguments, **kwargs):
    """原样传递参数并在首个失败处停止；不拼接本地 shell 命令。"""
    subprocess.run([str(value) for value in arguments], cwd=ROOT, check=True, **kwargs)


def pnpm(*arguments):
    run(['powershell.exe', '-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', ROOT / 'scripts/pnpm.ps1', *arguments])


def ensure_image(image):
    """优先使用已缓存镜像；Docker 拉取失败时通过本机 HTTPS 路径下载官方层。"""
    if subprocess.run(['docker', 'image', 'inspect', image], stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL).returncode == 0:
        return
    if subprocess.run(['docker', 'pull', image]).returncode == 0:
        return
    repository, tag = image.split(':')
    cache = ROOT / '.cache/deploy-downloads'
    archive = cache / (repository + '-' + tag + '.tar.gz')
    try:
        run([sys.executable, ROOT / 'scripts/deployment/fetch-image.py', repository, tag, archive])
        run(['docker', 'load', '-i', archive])
    finally:
        archive.unlink(missing_ok=True)


def pack_context(context, archive):
    """将 Windows junction 转为 Linux 相对符号链接，避免循环展开与打包外部文件。"""
    root = context.resolve()
    # 固定元数据，让相同内容的生产依赖可按摘要复用，不受编译时间影响。
    def normalize(entry):
        entry.mtime = 946684800
        entry.uid = entry.gid = 0
        entry.uname = entry.gname = ''
        return entry
    with tarfile.open(archive, 'w', dereference=False, format=tarfile.GNU_FORMAT) as output:
        def add(path):
            name = path.relative_to(root).as_posix()
            if path.is_symlink() or path.is_junction():
                target = path.resolve()
                # pnpm legacy deploy 留下包自身的 workspace 链接，改为当前导出包。
                if target == ROOT / 'apps/api':
                    target = root / 'api'
                if not target.is_relative_to(root):
                    raise RuntimeError('Deployment dependency links outside the isolated package')
                entry = tarfile.TarInfo(name)
                entry.type = tarfile.SYMTYPE
                entry.linkname = pathlib.Path(os.path.relpath(target, path.parent)).as_posix()
                entry.mode = 0o777
                output.addfile(normalize(entry))
            else:
                # 本地环境和私钥永不进入构建上下文，包括包目录下未来新增的配置。
                if path.name.startswith('.env') or path.name.endswith(('.local', '.pem', '.key', '.p12', '.pfx')) or path.name in ['.npmrc', '.git']:
                    return
                # 安装器元数据和 Windows CLI 包装器含临时绝对路径、时间戳；运行 API 不需要它们。
                if path.name in ['.modules.yaml', '.pnpm-workspace-state-v1.json'] or (path.name == '.bin' and path.parent.name == 'node_modules'):
                    return
                output.add(path, arcname=name, recursive=False, filter=normalize)
                if path.is_dir():
                    for child in sorted(path.iterdir()):
                        add(child)
        for child in sorted(root.iterdir()):
            add(child)


def build_artifacts(directory):
    """分离可复用生产依赖与版本产物；无需本机 Docker，不打包应用镜像。"""
    for package in ['@ntfs/contracts', '@ntfs/ui', '@ntfs/api', '@ntfs/web']:
        pnpm('--filter', package, 'build')
    context = directory / 'context'
    context.mkdir()
    api = context / 'api'
    pnpm('--filter', '@ntfs/api', '--prod', 'deploy', '--legacy', str(api))
    for item in api.iterdir():
        if item.name not in ['dist', 'node_modules', 'package.json']:
            if item.is_dir():
                shutil.rmtree(item)
            else:
                item.unlink()
    contracts_source = api / 'node_modules/@ntfs/contracts/src'
    if contracts_source.exists():
        resolved = contracts_source.resolve()
        if not resolved.is_relative_to(api.resolve()):
            raise RuntimeError('Workspace export must contain its own contracts package')
        shutil.rmtree(resolved)
    application = directory / 'application'
    runtime_api = application / 'apps/api'
    runtime_api.mkdir(parents=True)
    shutil.move(str(api / 'dist'), runtime_api / 'dist')
    shutil.move(str(api / 'package.json'), runtime_api / 'package.json')
    (runtime_api / 'node_modules').mkdir()
    shutil.copytree(ROOT / 'apps/web/dist', application / 'web')
    shutil.copyfile(ROOT / 'deploy/nginx.conf', application / 'nginx.conf')
    shutil.copyfile(ROOT / 'pnpm-workspace.yaml', application / 'pnpm-workspace.yaml')
    revision = subprocess.check_output(['git', 'rev-parse', 'HEAD'], cwd=ROOT, text=True).strip()
    dirty = bool(subprocess.check_output(['git', 'status', '--porcelain'], cwd=ROOT))
    version = json.loads((ROOT / 'package.json').read_text(encoding='utf-8'))['version']
    (application / 'source.json').write_text(json.dumps({'version': version, 'commit': revision, 'dirty': dirty}) + '\n', encoding='utf-8')

    archives = []
    dependency_id = None
    for name, source_directory in [('application', application), ('dependencies', context)]:
        raw = directory / (name + '.tar')
        pack_context(source_directory, raw)
        if name == 'dependencies':
            dependency_id = hashlib.sha256(raw.read_bytes()).hexdigest()
        result = directory / (name + '.tar.gz')
        with raw.open('rb') as source, gzip.open(result, 'wb', compresslevel=3) as destination:
            shutil.copyfileobj(source, destination)
        raw.unlink()
        archives.append(result)
    return archives, dependency_id


def remote(client, command, private_input=None):
    """逐段读取两条流，长操作持续输出且避免 SSH 缓冲区死锁。"""
    channel = client.get_transport().open_session()
    channel.exec_command(command)
    if private_input is not None:
        channel.sendall(private_input.encode('utf-8'))
        channel.shutdown_write()
    deadline = time.monotonic() + 1800
    while True:
        for ready, receive, stream in [(channel.recv_ready, channel.recv, sys.stdout),
                                       (channel.recv_stderr_ready, channel.recv_stderr, sys.stderr)]:
            if ready():
                stream.write(receive(65536).decode('utf-8', errors='replace'))
                stream.flush()
        if channel.exit_status_ready() and not channel.recv_ready() and not channel.recv_stderr_ready():
            break
        if time.monotonic() > deadline:
            channel.close()
            raise RuntimeError('Remote operation timed out; inspect the server before retrying')
        time.sleep(0.1)
    if channel.recv_exit_status() != 0:
        raise RuntimeError('Remote operation failed')


def upload(sftp, local, target, mode=0o600):
    """先上传临时文件再改名，避免读取到半份配置或脚本。"""
    partial = target + '.upload-' + uuid.uuid4().hex[:8]
    try:
        last_report = 0
        def progress(transferred, total):
            nonlocal last_report
            if transferred - last_report >= 32 * 1024 * 1024:
                print('Upload: ' + str(transferred // (1024 * 1024)) + '/' + str(total // (1024 * 1024)) + ' MiB', flush=True)
                last_report = transferred
        sftp.put(str(local), partial, callback=progress)
        sftp.chmod(partial, mode)
        sftp.posix_rename(partial, target)
    finally:
        try:
            sftp.remove(partial)
        except FileNotFoundError:
            pass


def write_configs(directory, values):
    """生成不含 SSH 密码的容器环境文件和 MySQL 客户端配置。"""
    environment = directory / 'production.env'
    environment.write_text(''.join(key + '=' + value + '\n' for key, value in values.items()
                                   if key.startswith(('DB_', 'API_')) or key == 'NODE_ENV'), encoding='utf-8', newline='\n')
    def quote(value):
        return '"' + value.replace('\\', '\\\\').replace('"', '\\"') + '"'
    mysql = directory / 'mysql.cnf'
    mysql.write_text('[client]\n' + ''.join(key + '=' + quote(values[field]) + '\n' for key, field in
                     [('host', 'DB_HOST'), ('port', 'DB_PORT'), ('user', 'DB_USERNAME'), ('password', 'DB_PASSWORD')])
                     + 'default-character-set=utf8mb4\n', encoding='utf-8', newline='\n')


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('action', choices=['Prepare', 'Check', 'Validate', 'Deploy', 'InitAdmin'])
    parser.add_argument('--config', type=pathlib.Path, default=ROOT / '.deploy.production.local')
    parser.add_argument('--v2-cutover', type=pathlib.Path)
    args = parser.parse_args()
    if args.v2_cutover and args.action != 'Deploy':
        raise RuntimeError('V2 cutover is only valid for explicit deployment')
    cutover_input = args.v2_cutover.read_bytes() if args.v2_cutover else None
    if cutover_input:
        json.loads(cutover_input)
    values = configuration(args.config)
    base = values['DEPLOY_PATH']
    release = time.strftime('%Y%m%d-%H%M%S') + '-' + uuid.uuid4().hex[:6]
    cache = ROOT / '.cache/deployment'
    cache.mkdir(parents=True, exist_ok=True)
    client = paramiko.SSHClient()
    client.load_system_host_keys()
    # 未知或变化的主机密钥必须由标准 SSH 首次核验，绝不静默忽略变化。
    client.set_missing_host_key_policy(paramiko.RejectPolicy())
    password = values.get('DEPLOY_PASSWORD') or None
    if password is None and not os.environ.get('SSH_AUTH_SOCK'):
        password = getpass.getpass('SSH password (empty for key authentication): ') or None
    client.connect(values['DEPLOY_HOST'], port=int(values['DEPLOY_SSH_PORT']), username=values['DEPLOY_USER'],
                   password=password, timeout=15, auth_timeout=20)
    try:
        # 本机编译、依赖导出期间也保持 SSH 活跃，避免长时间无远端流量被网关断开。
        transport = client.get_transport()
        if transport is None:
            raise RuntimeError('SSH transport is unavailable after authentication')
        transport.set_keepalive(15)
        command = 'bash ' + shlex.quote(base + '/deploy.sh')
        command += ' ' + ' '.join(shlex.quote(value) for value in [args.action.lower(), base, release, values['HTTP_BIND'], values['HTTP_PORT']])
        if args.action in ['Check', 'InitAdmin']:
            initial_password = values.get('INITIAL_ADMIN_PASSWORD') if args.action == 'InitAdmin' else None
            if initial_password:
                command += ' stdin'
            remote(client, command, initial_password)
            if args.action == 'InitAdmin':
                with client.open_sftp() as sftp:
                    target = ROOT / '.deploy.production.account.local'
                    # 使用独立私有文件，不覆盖本地开发管理员的凭据。
                    with target.open('xb') as output, sftp.open(base + '/shared/.bootstrap-credentials.local', 'rb') as source:
                        shutil.copyfileobj(source, output)
                    target.chmod(0o600)
                print('Initial credentials saved to .deploy.production.account.local (not printed).')
            return
        if args.action == 'Prepare':
            run(['docker', 'info'], stdout=subprocess.DEVNULL, timeout=30)
            ensure_image(NODE_IMAGE)
            ensure_image(WEB_IMAGE)
        with tempfile.TemporaryDirectory(prefix='ntfs-', dir=cache) as scratch:
            directory = pathlib.Path(scratch)
            write_configs(directory, values)
            server_script = directory / 'server.sh'
            server_script.write_text((ROOT / 'scripts/deployment/server.sh').read_text(encoding='utf-8'), encoding='utf-8', newline='\n')
            remote(client, 'umask 077; mkdir -p ' + ' '.join(shlex.quote(base + suffix) for suffix in ['', '/shared', '/runtime', '/releases', '/backups', '/dependencies']))
            with client.open_sftp() as sftp:
                upload(sftp, server_script, base + '/deploy.sh', 0o700)
                if args.action == 'Prepare':
                    # 环境准备不可覆写已有线上凭据。
                    for name in ['production.env', 'mysql.cnf']:
                        try:
                            sftp.stat(base + '/shared/' + name)
                        except FileNotFoundError:
                            upload(sftp, directory / name, base + '/shared/' + name)
                    archive = directory / 'runtime.tar'
                    run(['docker', 'save', '-o', archive, NODE_IMAGE, WEB_IMAGE])
                    upload(sftp, archive, base + '/runtime/runtime.tar')
                else:
                    archives, dependency_id = build_artifacts(directory)
                    destination = base + '/releases/' + release
                    sftp.mkdir(destination, 0o700)
                    try:
                        sftp.stat(base + '/dependencies/' + dependency_id + '/.ready')
                        archives = archives[:1]
                        print('Production dependencies unchanged; reusing server cache.', flush=True)
                    except FileNotFoundError:
                        print('Uploading new production dependencies.', flush=True)
                    checksums = []
                    for archive in archives:
                        print('Uploading ' + archive.name + ': ' + str(round(archive.stat().st_size / 1048576, 2)) + ' MiB', flush=True)
                        upload(sftp, archive, destination + '/' + archive.name)
                        checksums.append(hashlib.sha256(archive.read_bytes()).hexdigest() + '  ' + archive.name + '\n')
                    (directory / 'artifacts.sha256').write_text(''.join(checksums), encoding='ascii', newline='\n')
                    (directory / 'dependencies.id').write_text(dependency_id + '\n', encoding='ascii', newline='\n')
                    for name in ['production.env', 'mysql.cnf', 'artifacts.sha256', 'dependencies.id']:
                        upload(sftp, directory / name, destination + '/' + name)
                    if cutover_input:
                        (directory / 'v2-cutover.json').write_bytes(cutover_input)
                        upload(sftp, directory / 'v2-cutover.json', destination + '/v2-cutover.json')
            remote(client, command)
    finally:
        client.close()


if __name__ == '__main__':
    try:
        main()
    except Exception as error:
        # 不输出参数/连接串/凭据；远端脚本已经报告可操作的失败阶段。
        print('Deployment stopped (' + type(error).__name__ + '). Check the preceding stage and server state.', file=sys.stderr)
        sys.exit(1)
